'use strict';

const crypto = require('node:crypto');

const CONTACT_CHANNELS = new Set(['email', 'whatsapp', 'phone', 'contact_form']);
const THREAD_CHANNELS = new Set(['email', 'whatsapp']);
const THREAD_STATES = new Set(['active', 'waiting_customer', 'waiting_internal', 'closed', 'unresolved']);
const MESSAGE_SOURCES = new Set(['email_message', 'crm_message', 'legacy_delivery']);
const DIRECTIONS = new Set(['inbound', 'outbound']);
const TASK_TYPES = new Set(['check_reply', 'review_reply', 'replace_contact', 'delivery_review', 'review_unresolved']);
const CONTACT_STATES = new Set(['active', 'revoked', 'unverified']);

function text(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeDomain(value) {
  let domain = text(value).toLowerCase();
  if (!domain) return '';
  if (domain.includes('@') && !domain.includes('/')) domain = domain.slice(domain.lastIndexOf('@') + 1);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(domain)) {
    try { domain = new URL(domain).hostname; } catch (_) { return ''; }
  }
  domain = domain.split(/[/?#]/, 1)[0].replace(/:\d+$/, '').replace(/^\.+|\.+$/g, '');
  return domain;
}

function normalizeAddress(value) {
  const address = text(value).replace(/^mailto:/i, '');
  return address.includes('@') ? address.toLowerCase() : address;
}

function requireValue(value, label) {
  const result = text(value);
  if (!result) throw new Error(`${label} required`);
  return result;
}

function requireMember(value, options, label) {
  const result = requireValue(value, label).toLowerCase();
  if (!options.has(result)) throw new Error(`valid ${label} required`);
  return result;
}

function iso(value, label) {
  const timestamp = Date.parse(text(value));
  if (!Number.isFinite(timestamp)) throw new Error(`valid ${label} required`);
  return new Date(timestamp).toISOString();
}

function json(value) {
  return JSON.stringify(value || {});
}

function lifecycleKey(eventType, sourceKind, sourceId, payload, supplied) {
  if (text(supplied)) return text(supplied);
  const fingerprint = crypto.createHash('sha256').update(json(payload)).digest('hex');
  return `matrix-ledger:${eventType}:${sourceKind}:${sourceId}:${fingerprint}`;
}

function contactView(row) {
  return {
    id: row.id,
    customerId: row.canonical_customer_id,
    channel: row.channel,
    address: row.address,
    role: row.role,
    sourceUrl: row.source_url,
    verifiedAt: row.verified_at,
    status: row.status,
    revokedReason: row.revoked_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function createMatrixLedgerStore({ db, clock = () => new Date() } = {}) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw new Error('database required');
  }

  function now() {
    const value = clock();
    const timestamp = value instanceof Date ? value.getTime() : Date.parse(String(value));
    if (!Number.isFinite(timestamp)) throw new Error('clock must return a valid date');
    return new Date(timestamp).toISOString();
  }

  function immediate(work) {
    return db.transaction(work).immediate();
  }

  function recordEvent(input) {
    const eventType = requireValue(input.eventType, 'event type');
    const sourceKind = requireValue(input.sourceKind, 'source kind');
    const sourceId = requireValue(input.sourceId, 'source id');
    const createdAt = input.createdAt || now();
    const idempotencyKey = lifecycleKey(
      eventType,
      sourceKind,
      sourceId,
      { before: input.before || {}, after: input.after || {} },
      input.idempotencyKey
    );
    db.prepare(`
      INSERT OR IGNORE INTO matrix_lifecycle_events (
        canonical_customer_id, event_type, source_kind, source_id, actor_user_id,
        before_json, after_json, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      Number(input.customerId), eventType, sourceKind, sourceId,
      input.actorUserId == null ? null : Number(input.actorUserId),
      json(input.before), json(input.after), idempotencyKey, createdAt
    );
  }

  function customerById(customerId) {
    const id = Number(customerId);
    if (!Number.isInteger(id) || id <= 0) throw new Error('customer id required');
    const customer = db.prepare('SELECT id, name, active, created_at, updated_at FROM customers WHERE id = ?').get(id);
    if (!customer) throw new Error('canonical customer not found');
    return customer;
  }

  function activeCanonicalCustomer(customerId) {
    const customer = customerById(customerId);
    if (!Number(customer.active)) throw new Error('canonical customer is inactive');
    return customer;
  }

  function establishCandidateLink(customerId, identity, createdAt) {
    const candidateId = text(identity.candidateId);
    if (!candidateId) return;
    db.prepare(`
      INSERT OR IGNORE INTO matrix_customer_links (
        canonical_customer_id, source_kind, source_id, normalized_domain, confidence, created_at
      ) VALUES (?, 'candidate', ?, ?, 'deterministic', ?)
    `).run(customerId, candidateId, normalizeDomain(identity.normalizedDomain), createdAt);
    const link = db.prepare(`
      SELECT canonical_customer_id FROM matrix_customer_links
      WHERE source_kind = 'candidate' AND source_id = ?
    `).get(candidateId);
    if (!link || Number(link.canonical_customer_id) !== Number(customerId)) {
      throw new Error('candidate link conflict');
    }
  }

  function uniqueCustomer(rows, error) {
    const ids = Array.from(new Set(rows.map(row => Number(row.canonical_customer_id)).filter(Number.isInteger)));
    if (ids.length > 1) throw new Error(error);
    return ids[0] || null;
  }

  function resolveCustomer(identity = {}) {
    return immediate(() => {
      const refs = [];
      if (text(identity.candidateId)) refs.push(['candidate', text(identity.candidateId)]);
      if (text(identity.customerId)) refs.push(['customer', text(identity.customerId)]);
      const linkedRows = refs.flatMap(([sourceKind, sourceId]) => db.prepare(`
        SELECT canonical_customer_id FROM matrix_customer_links
        WHERE source_kind = ? AND source_id = ?
      `).all(sourceKind, sourceId));
      let canonicalCustomerId = uniqueCustomer(linkedRows, 'customer source identity conflict');

      if (!canonicalCustomerId && identity.channel && identity.address) {
        const channel = requireMember(identity.channel, CONTACT_CHANNELS, 'contact channel');
        const address = requireValue(normalizeAddress(identity.address), 'contact address');
        canonicalCustomerId = uniqueCustomer(db.prepare(`
          SELECT canonical_customer_id FROM matrix_contacts
          WHERE channel = ? AND address = ? AND status = 'active'
        `).all(channel, address), 'customer contact identity conflict');
      }

      if (!canonicalCustomerId && text(identity.normalizedDomain)) {
        const domain = normalizeDomain(identity.normalizedDomain);
        if (!domain) throw new Error('valid normalized domain required');
        canonicalCustomerId = uniqueCustomer(db.prepare(`
          SELECT canonical_customer_id FROM matrix_customer_links
          WHERE normalized_domain = ? AND confidence IN ('deterministic', 'reviewed')
        `).all(domain), 'customer domain identity conflict');
      }

      if (!canonicalCustomerId && text(identity.customerId)) {
        canonicalCustomerId = customerById(identity.customerId).id;
        const sourceId = text(identity.customerId);
        db.prepare(`
          INSERT OR IGNORE INTO matrix_customer_links (
            canonical_customer_id, source_kind, source_id, normalized_domain, confidence, created_at
          ) VALUES (?, 'customer', ?, '', 'deterministic', ?)
        `).run(canonicalCustomerId, sourceId, now());
      }

      if (!canonicalCustomerId) {
        const candidateId = text(identity.candidateId);
        if (!candidateId) throw new Error('customer could not be resolved');
        const companyName = requireValue(identity.companyName, 'company name');
        const createdAt = now();
        const result = db.prepare(`
          INSERT INTO customers (name, active, created_at, updated_at)
          VALUES (?, 1, ?, ?)
        `).run(companyName, createdAt, createdAt);
        canonicalCustomerId = Number(result.lastInsertRowid);
        establishCandidateLink(canonicalCustomerId, identity, createdAt);
        recordEvent({
          customerId: canonicalCustomerId,
          eventType: 'customer_resolved',
          sourceKind: 'candidate',
          sourceId: candidateId,
          after: { canonical_customer_id: canonicalCustomerId },
          actorUserId: identity.actorUserId,
          createdAt
        });
      }

      activeCanonicalCustomer(canonicalCustomerId);
      establishCandidateLink(canonicalCustomerId, identity, now());
      return { canonical_customer_id: Number(canonicalCustomerId) };
    });
  }

  function upsertContact(input = {}) {
    return immediate(() => {
      const channel = requireMember(input.channel, CONTACT_CHANNELS, 'contact channel');
      const address = requireValue(normalizeAddress(input.address), 'contact address');
      const existing = db.prepare('SELECT * FROM matrix_contacts WHERE channel = ? AND address = ?').get(channel, address);
      if (existing && Number(existing.canonical_customer_id) !== Number(input.customerId)) {
        throw new Error('contact identity conflict');
      }
      const customer = customerById(input.customerId);
      const role = text(input.role);
      const sourceUrl = requireValue(input.sourceUrl, 'contact source url');
      const verifiedAt = iso(input.verifiedAt, 'contact verified timestamp');
      const status = requireMember(input.status || 'active', CONTACT_STATES, 'contact status');
      const revokedReason = status === 'revoked' ? text(input.revokedReason) : '';
      const createdAt = now();
      let row;
      if (existing) {
        if (Number(existing.canonical_customer_id) !== customer.id) throw new Error('contact identity conflict');
        if (existing.status === 'revoked' && status !== 'revoked') throw new Error('contact is revoked');
        db.prepare(`
          UPDATE matrix_contacts
          SET role = ?, source_url = ?, verified_at = ?, status = ?, revoked_reason = ?, updated_at = ?
          WHERE id = ?
        `).run(role, sourceUrl, verifiedAt, status, revokedReason, createdAt, existing.id);
        row = db.prepare('SELECT * FROM matrix_contacts WHERE id = ?').get(existing.id);
      } else {
        const result = db.prepare(`
          INSERT INTO matrix_contacts (
            canonical_customer_id, channel, address, role, source_url, verified_at, status,
            revoked_reason, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(customer.id, channel, address, role, sourceUrl, verifiedAt, status, revokedReason, createdAt, createdAt);
        row = db.prepare('SELECT * FROM matrix_contacts WHERE id = ?').get(Number(result.lastInsertRowid));
      }
      recordEvent({
        customerId: customer.id,
        eventType: status === 'revoked' ? 'contact_revoked' : 'contact_upserted',
        sourceKind: 'contact',
        sourceId: `${channel}:${address}`,
        before: existing && { status: existing.status },
        after: { id: row.id, status: row.status },
        actorUserId: input.actorUserId,
        createdAt
      });
      return contactView(row);
    });
  }

  function recordThreadMessage(input = {}) {
    return immediate(() => {
      const customer = customerById(input.customerId);
      const channel = requireMember(input.channel, THREAD_CHANNELS, 'thread channel');
      const conversationKey = requireValue(input.conversationKey, 'conversation key');
      const sourceKind = requireMember(input.sourceKind, MESSAGE_SOURCES, 'message source kind');
      const sourceId = requireValue(input.sourceId, 'message source id');
      const direction = requireMember(input.direction, DIRECTIONS, 'message direction');
      const classification = requireValue(input.classification, 'message classification');
      const messageId = text(input.messageId);
      const contentHash = text(input.contentHash);
      const occurredAt = iso(input.occurredAt, 'message timestamp');
      const createdAt = now();
      const existingMessage = db.prepare('SELECT * FROM matrix_thread_messages WHERE source_kind = ? AND source_id = ?').get(sourceKind, sourceId);
      if (existingMessage) {
        const existingThread = db.prepare('SELECT * FROM matrix_threads WHERE id = ?').get(existingMessage.thread_id);
        if (!existingThread
          || Number(existingThread.canonical_customer_id) !== customer.id
          || existingThread.channel !== channel
          || existingThread.conversation_key !== conversationKey
          || existingMessage.direction !== direction
          || existingMessage.classification !== classification
          || existingMessage.message_id !== messageId
          || existingMessage.content_hash !== contentHash
          || existingMessage.occurred_at !== occurredAt) {
          throw new Error('thread message identity conflict');
        }
        return { inserted: false, thread: existingThread, message: existingMessage };
      }
      let thread = db.prepare('SELECT * FROM matrix_threads WHERE channel = ? AND conversation_key = ?').get(channel, conversationKey);
      if (thread && Number(thread.canonical_customer_id) !== customer.id) throw new Error('thread identity conflict');
      if (!thread) {
        const result = db.prepare(`
          INSERT INTO matrix_threads (
            canonical_customer_id, channel, conversation_key, state, last_message_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(customer.id, channel, conversationKey, requireMember(input.state || 'active', THREAD_STATES, 'thread state'), occurredAt, createdAt, createdAt);
        thread = db.prepare('SELECT * FROM matrix_threads WHERE id = ?').get(Number(result.lastInsertRowid));
      } else if (!thread.last_message_at || occurredAt > thread.last_message_at) {
        db.prepare('UPDATE matrix_threads SET last_message_at = ?, updated_at = ? WHERE id = ?').run(occurredAt, createdAt, thread.id);
        thread = db.prepare('SELECT * FROM matrix_threads WHERE id = ?').get(thread.id);
      }
      const result = db.prepare(`
        INSERT INTO matrix_thread_messages (
          thread_id, source_kind, source_id, direction, classification, message_id, content_hash, occurred_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(thread.id, sourceKind, sourceId, direction, classification, messageId, contentHash, occurredAt, createdAt);
      const message = db.prepare('SELECT * FROM matrix_thread_messages WHERE id = ?').get(Number(result.lastInsertRowid));
      recordEvent({
        customerId: customer.id,
        eventType: 'thread_message_recorded',
        sourceKind,
        sourceId,
        after: { thread_id: thread.id, direction, classification },
        actorUserId: input.actorUserId,
        createdAt
      });
      return { inserted: true, thread, message };
    });
  }

  function createTask(input = {}) {
    return immediate(() => {
      const customer = customerById(input.customerId);
      const sourceKind = requireValue(input.sourceKind, 'task source kind');
      const sourceId = requireValue(input.sourceId, 'task source id');
      const taskType = requireMember(input.taskType, TASK_TYPES, 'task type');
      const existing = db.prepare(`
        SELECT * FROM matrix_tasks WHERE source_kind = ? AND source_id = ? AND task_type = ?
      `).get(sourceKind, sourceId, taskType);
      if (existing) {
        if (Number(existing.canonical_customer_id) !== customer.id) throw new Error('task identity conflict');
        return existing;
      }
      const createdAt = now();
      const result = db.prepare(`
        INSERT INTO matrix_tasks (
          canonical_customer_id, source_kind, source_id, task_type, due_at, state, priority,
          next_action, cancellation_reason, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, '', ?, ?)
      `).run(
        customer.id, sourceKind, sourceId, taskType, iso(input.dueAt, 'task due timestamp'),
        text(input.priority) || 'normal', text(input.nextAction), createdAt, createdAt
      );
      const task = db.prepare('SELECT * FROM matrix_tasks WHERE id = ?').get(Number(result.lastInsertRowid));
      recordEvent({
        customerId: customer.id,
        eventType: 'task_created',
        sourceKind,
        sourceId: `${sourceId}:${taskType}`,
        after: { id: task.id, state: task.state, due_at: task.due_at },
        actorUserId: input.actorUserId,
        createdAt
      });
      return task;
    });
  }

  function cancelTasks(input = {}) {
    return immediate(() => {
      const customer = customerById(input.customerId);
      const sourceKind = requireValue(input.sourceKind, 'task source kind');
      const sourceId = requireValue(input.sourceId, 'task source id');
      const reason = requireValue(input.reason, 'task cancellation reason');
      const taskType = text(input.taskType);
      if (taskType && !TASK_TYPES.has(taskType)) throw new Error('valid task type required');
      const tasks = db.prepare(`
        SELECT * FROM matrix_tasks
        WHERE canonical_customer_id = ? AND source_kind = ? AND source_id = ?
          AND state = 'pending' ${taskType ? 'AND task_type = ?' : ''}
      `).all(...(taskType ? [customer.id, sourceKind, sourceId, taskType] : [customer.id, sourceKind, sourceId]));
      const updatedAt = now();
      for (const task of tasks) {
        db.prepare(`
          UPDATE matrix_tasks
          SET state = 'cancelled', cancellation_reason = ?, updated_at = ?
          WHERE id = ? AND state = 'pending'
        `).run(reason, updatedAt, task.id);
        recordEvent({
          customerId: customer.id,
          eventType: 'task_cancelled',
          sourceKind,
          sourceId: `${sourceId}:${task.task_type}`,
          before: { id: task.id, state: task.state },
          after: { id: task.id, state: 'cancelled', cancellation_reason: reason },
          actorUserId: input.actorUserId,
          createdAt: updatedAt
        });
      }
      return { cancelled: tasks.length, tasks: tasks.map(task => ({ ...task, state: 'cancelled', cancellation_reason: reason, updated_at: updatedAt })) };
    });
  }

  function customerSnapshot(customerId) {
    const customer = customerById(customerId);
    return {
      customer,
      links: db.prepare(`
        SELECT source_kind, source_id, normalized_domain, confidence, created_at
        FROM matrix_customer_links WHERE canonical_customer_id = ? ORDER BY id
      `).all(customer.id),
      contacts: db.prepare(`
        SELECT id, channel, address, role, source_url, verified_at, status, revoked_reason, created_at, updated_at
        FROM matrix_contacts WHERE canonical_customer_id = ? ORDER BY id
      `).all(customer.id),
      threads: db.prepare(`
        SELECT id, channel, conversation_key, state, last_message_at, created_at, updated_at
        FROM matrix_threads WHERE canonical_customer_id = ? ORDER BY id
      `).all(customer.id),
      tasks: db.prepare(`
        SELECT id, source_kind, source_id, task_type, due_at, state, priority, next_action,
          cancellation_reason, created_at, updated_at
        FROM matrix_tasks WHERE canonical_customer_id = ? ORDER BY id
      `).all(customer.id),
      lifecycleEvents: db.prepare(`
        SELECT id, event_type, source_kind, source_id, actor_user_id, before_json, after_json, created_at
        FROM matrix_lifecycle_events WHERE canonical_customer_id = ? ORDER BY id
      `).all(customer.id)
    };
  }

  return { resolveCustomer, upsertContact, recordThreadMessage, createTask, cancelTasks, customerSnapshot };
}

module.exports = { createMatrixLedgerStore, normalizeDomain, normalizeAddress };

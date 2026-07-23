'use strict';

const crypto = require('node:crypto');

const CONFIRMATION_FIELDS = new Set([
  'actorUserId', 'bindingId', 'customerId', 'versionId', 'expectedContentHash',
  'confirmationText', 'chatId', 'cardEventId', 'idempotencyKey'
]);

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} required`);
  return number;
}

function token(value, label, maximum = 256) {
  const result = String(value || '').trim();
  if (!result || result.length > maximum || /[\r\n\0]/.test(result)) throw new Error(`${label} required`);
  return result;
}

function exactConfirmationInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('delivery confirmation input required');
  const unknown = Object.keys(value).find(key => !CONFIRMATION_FIELDS.has(key));
  if (unknown) throw new Error(`unknown delivery confirmation field: ${unknown}`);
  const expectedContentHash = token(value.expectedContentHash, 'expected content hash', 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedContentHash)) throw new Error('valid expected content hash required');
  return {
    actorUserId: positiveInteger(value.actorUserId, 'actor user id'),
    bindingId: positiveInteger(value.bindingId, 'binding id'),
    customerId: positiveInteger(value.customerId, 'customer id'),
    versionId: positiveInteger(value.versionId, 'version id'),
    expectedContentHash,
    confirmationText: String(value.confirmationText == null ? '' : value.confirmationText).trim(),
    chatId: token(value.chatId, 'chat id'),
    cardEventId: token(value.cardEventId, 'card event id'),
    idempotencyKey: token(value.idempotencyKey, 'idempotency key', 200)
  };
}

function jsonObject(value, label) {
  try {
    const parsed = JSON.parse(String(value || ''));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(label);
    return parsed;
  } catch (_) {
    throw new Error(`${label} invalid`);
  }
}

function attachmentManifest(value) {
  const parsed = JSON.parse(value || '[]');
  if (!Array.isArray(parsed)) throw new Error('attachment manifest invalid');
  return parsed;
}

function reasons(values) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function authoritativeResearch(value) {
  return {
    organization_domain: value?.organization_domain, recipient_email: value?.recipient_email, source_url: value?.source_url,
    country_code: value?.country_code, company: value?.company, categories: value?.categories, products: value?.products,
    entryProduct: value?.entryProduct, localizedRouteSet: value?.localizedRouteSet,
    evidenceIds: value?.evidenceIds, official_evidence: value?.official_evidence
  };
}

function createMatrixLedgerCommand({ db, reviewService, previewService, deliveryService, currentEvidence, clock = () => new Date() } = {}) {
  if (!db || typeof db.prepare !== 'function' || !reviewService || typeof reviewService.finalPreview !== 'function'
      || !previewService || typeof previewService.project !== 'function'
      || !deliveryService || typeof deliveryService.confirm !== 'function' || typeof currentEvidence !== 'function' || typeof clock !== 'function') {
    throw new Error('ledger command dependencies required');
  }

  function resolve(customerId, versionId) {
    const customer = db.prepare('SELECT id, name, active FROM customers WHERE id = ?').get(customerId);
    if (!customer) throw new Error('canonical customer not found');
    if (!Number(customer.active)) throw new Error('canonical customer is inactive');
    const version = db.prepare('SELECT * FROM matrix_stream_versions WHERE id = ?').get(versionId);
    if (!version) throw new Error('version not found');
    const workItem = db.prepare('SELECT * FROM matrix_work_items WHERE id = ?').get(version.work_item_id);
    if (!workItem) throw new Error('work item not found');
    const candidate = db.prepare(`
      SELECT 1 FROM matrix_customer_links
      WHERE canonical_customer_id = ? AND source_kind = 'candidate' AND source_id = ?
    `).get(customer.id, String(workItem.candidate_id));
    if (!candidate) throw new Error('canonical customer does not own version');
    const contact = db.prepare(`
      SELECT * FROM matrix_contacts
      WHERE canonical_customer_id = ? AND channel = 'email' AND lower(address) = lower(?)
      ORDER BY id ASC LIMIT 1
    `).get(customer.id, version.recipient_email);
    if (!contact) throw new Error('canonical contact not found');
    if (contact.status !== 'active') throw new Error('canonical contact is inactive');
    if (workItem.current_stream_version_id !== version.id) throw new Error('stale research or route readiness');
    return { customer, contact, version, workItem };
  }

  async function finalPreview(input = {}) {
    const actorUserId = positiveInteger(input.actorUserId, 'actor user id');
    const customerId = positiveInteger(input.customerId, 'customer id');
    const versionId = positiveInteger(input.versionId, 'version id');
    const resolved = resolve(customerId, versionId);
    const current = await currentEvidence({ customer: resolved.customer, contact: resolved.contact, workItem: resolved.workItem, version: resolved.version });
    if (!current || !current.sourceSnapshot
        || reviewService.canonicalJson(authoritativeResearch(current.sourceSnapshot))
          !== reviewService.canonicalJson(authoritativeResearch(jsonObject(resolved.version.source_snapshot_json, 'research snapshot')))) {
      throw new Error('official evidence changed');
    }
    const reviewGate = reviewService.finalPreview(db, { actorUserId, versionId });
    if (!reviewGate || reviewGate.version.work_item_id !== resolved.workItem.id) throw new Error('version not found');
    const snapshot = current.sourceSnapshot;
    const strategy = snapshot.strategy_match;
    const researchBlockers = !strategy || strategy.passed !== true
      || !Number.isFinite(Number(strategy.score)) || !Number.isFinite(Number(strategy.threshold))
      || Number(strategy.score) < Number(strategy.threshold) || (Array.isArray(strategy.blockers) && strategy.blockers.length)
      ? ['stale_research_or_route_readiness'] : [];
    const base = {
      ...reviewGate,
      allowed: reviewGate.allowed && researchBlockers.length === 0,
      reasons: reasons([...(reviewGate.reasons || []), ...researchBlockers]),
      canonicalCustomerIds: [resolved.customer.id]
    };
    const projected = await previewService.project(base);
    const blockers = reasons([
      ...(base.reasons || []),
      ...(projected.duplicate?.reasons || []),
      ...(projected.cooling?.reasons || []),
      ...(projected.quota?.reasons || []),
      ...(projected.readiness?.reasons || []),
      ...(projected.policy?.reasons || [])
    ]);
    const recipientDomain = String(resolved.version.recipient_email || '').trim().toLowerCase().split('@')[1] || '';
    const delivery = db.prepare(`
      SELECT j.state FROM matrix_stream_jobs j
      LEFT JOIN matrix_stream_versions prior ON prior.id = j.version_id
      WHERE j.state IN ('accepted', 'ambiguous')
        AND (lower(prior.recipient_email) = lower(?) OR lower(j.recipient_domain) = ?)
      ORDER BY j.id DESC LIMIT 1
    `).get(resolved.version.recipient_email, recipientDomain);
    if (delivery) blockers.push(`existing_${delivery.state}_delivery`);
    const normalizedBlockers = reasons(blockers);
    return Object.freeze({
      customer_id: resolved.customer.id,
      customer_name: resolved.customer.name,
      contact_id: resolved.contact.id,
      recipient: resolved.version.recipient_email,
      subject: resolved.version.subject,
      body_en: resolved.version.body_en,
      body_cn: resolved.version.body_cn,
      attachments: attachmentManifest(resolved.version.attachment_manifest_json),
      version_id: resolved.version.id,
      content_hash: resolved.version.content_hash,
      allowed: projected.allowed === true && normalizedBlockers.length === 0,
      blockers: normalizedBlockers
    });
  }

  async function confirmDelivery(value) {
    const input = exactConfirmationInput(value);
    const resolved = resolve(input.customerId, input.versionId);
    const requiredText = `确认发送 ${resolved.customer.name}`;
    if (input.confirmationText !== requiredText) throw new Error('exact confirmation required');
    if (input.expectedContentHash !== resolved.version.content_hash) throw new Error('content hash mismatch');
    const confirmationEventKey = `matrix-ledger-confirm:${crypto.createHash('sha256').update(input.idempotencyKey).digest('hex')}`;
    const confirmationEvent = db.prepare('SELECT after_json FROM matrix_lifecycle_events WHERE idempotency_key = ?').get(confirmationEventKey);
    let expectedWorkVersion = resolved.workItem.version;
    if (confirmationEvent) {
      try {
        const prior = jsonObject(confirmationEvent.after_json, 'stored delivery confirmation');
        expectedWorkVersion = positiveInteger(prior.expected_work_version, 'stored expected work version');
      } catch (_) {
        throw new Error('delivery confirmation idempotency conflict');
      }
    }
    const deliveryInput = {
      actorUserId: input.actorUserId,
      bindingId: input.bindingId,
      workItemId: resolved.workItem.id,
      versionId: resolved.version.id,
      expectedWorkVersion,
      expectedContentHash: input.expectedContentHash,
      chatId: input.chatId,
      cardEventId: input.cardEventId,
      idempotencyKey: input.idempotencyKey,
      canonicalCustomerId: resolved.customer.id
    };
    const replay = db.prepare('SELECT id FROM matrix_stream_jobs WHERE idempotency_key = ?').get(input.idempotencyKey);
    if (replay) return deliveryService.confirm(deliveryInput);
    const preview = await finalPreview({
      actorUserId: input.actorUserId,
      customerId: input.customerId,
      versionId: input.versionId
    });
    if (!preview.allowed) throw new Error(`final preview blocked: ${preview.blockers.join(',')}`);
    if (input.expectedContentHash !== preview.content_hash) throw new Error('content hash mismatch');
    const timestamp = clock();
    const at = timestamp instanceof Date ? timestamp.toISOString() : new Date(timestamp).toISOString();
    if (!Number.isFinite(Date.parse(at))) throw new Error('command clock invalid');
    db.transaction(() => {
      const existing = db.prepare('SELECT * FROM matrix_lifecycle_events WHERE idempotency_key = ?').get(confirmationEventKey);
      const before = { content_hash: input.expectedContentHash };
      const after = { confirmation_text: input.confirmationText, version_id: resolved.version.id, expected_work_version: expectedWorkVersion, chat_id: input.chatId, card_event_id: input.cardEventId };
      if (existing) {
        if (existing.canonical_customer_id !== resolved.customer.id || existing.event_type !== 'delivery_confirmed'
            || existing.source_kind !== 'matrix_stream_version' || existing.source_id !== String(resolved.version.id)
            || existing.actor_user_id !== input.actorUserId || reviewService.canonicalJson(jsonObject(existing.before_json, 'stored delivery confirmation')) !== reviewService.canonicalJson(before)
            || reviewService.canonicalJson(jsonObject(existing.after_json, 'stored delivery confirmation')) !== reviewService.canonicalJson(after)) {
          throw new Error('delivery confirmation idempotency conflict');
        }
        return;
      }
      db.prepare(`
        INSERT INTO matrix_lifecycle_events (
          canonical_customer_id, event_type, source_kind, source_id, actor_user_id,
          before_json, after_json, idempotency_key, created_at
        ) VALUES (?, 'delivery_confirmed', 'matrix_stream_version', ?, ?, ?, ?, ?, ?)
      `).run(
        resolved.customer.id, String(resolved.version.id), input.actorUserId,
        JSON.stringify(before), JSON.stringify(after),
        confirmationEventKey,
        at
      );
    }).immediate();
    return deliveryService.confirm(deliveryInput);
  }

  return { finalPreview, confirmDelivery };
}

module.exports = { createMatrixLedgerCommand };

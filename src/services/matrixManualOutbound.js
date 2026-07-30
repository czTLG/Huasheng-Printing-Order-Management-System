'use strict';

const crypto = require('node:crypto');
const { createMatrixLedgerStore } = require('./matrixLedgerStore');

const CHANNELS = new Set(['whatsapp']);

function text(value, maximum = 4000) {
  return String(value == null ? '' : value).trim().slice(0, maximum);
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} required`);
  return number;
}

function timestamp(value, label) {
  const parsed = Date.parse(text(value, 64));
  if (!Number.isFinite(parsed)) throw new Error(`valid ${label} required`);
  return new Date(parsed).toISOString();
}

function normalizeWhatsApp(value) {
  const normalized = text(value, 32).replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (!/^[1-9]\d{7,14}$/.test(normalized)) throw new Error('valid WhatsApp recipient required');
  return normalized;
}

function createMatrixManualOutbound({ db, clock = () => new Date() } = {}) {
  if (!db || typeof db.prepare !== 'function') throw new Error('database required');
  const ledger = createMatrixLedgerStore({ db, clock });

  function now() {
    const value = clock();
    const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value));
    if (!Number.isFinite(parsed)) throw new Error('clock must return a valid date');
    return new Date(parsed).toISOString();
  }

  function record(input = {}) {
    const actorUserId = positiveInteger(input.actorUserId, 'actor user id');
    const customerId = positiveInteger(input.customerId, 'customer id');
    const channel = text(input.channel, 24).toLowerCase();
    if (!CHANNELS.has(channel)) throw new Error('valid manual outbound channel required');
    const recipient = normalizeWhatsApp(input.recipient);
    const sourceUrl = text(input.sourceUrl, 1000);
    if (!/^https:\/\/[^\s]+$/i.test(sourceUrl)) throw new Error('valid official source URL required');
    const sentAt = timestamp(input.sentAt, 'sent timestamp');
    const messageText = text(input.messageText, 12000);
    if (!messageText) throw new Error('message text required');
    const idempotencyKey = text(input.idempotencyKey, 200);
    if (!idempotencyKey || /[\r\n\0]/.test(idempotencyKey)) throw new Error('idempotency key required');

    const customer = db.prepare('SELECT id, active FROM customers WHERE id = ?').get(customerId);
    if (!customer || !Number(customer.active)) throw new Error('canonical customer not found');

    const dedupeHash = crypto.createHash('sha256')
      .update(JSON.stringify({ customerId, channel, recipient, sentAt, messageText }), 'utf8')
      .digest('hex');
    const sourceMessageId = `manual:${idempotencyKey}`;
    let crmMessage = db.prepare(`
      SELECT * FROM crm_messages WHERE source_type = 'manual_whatsapp' AND source_message_id = ?
    `).get(sourceMessageId);
    if (crmMessage && (Number(crmMessage.customer_id) !== customerId
        || crmMessage.receiver_contact !== recipient
        || crmMessage.message_text !== messageText
        || crmMessage.received_at !== sentAt)) {
      throw new Error('idempotency request conflict');
    }

    ledger.upsertContact({
      customerId,
      channel,
      address: recipient,
      role: 'official_business_whatsapp',
      sourceUrl,
      verifiedAt: sentAt,
      status: 'active',
      actorUserId
    });

    if (!crmMessage) {
      const createdAt = now();
      const result = db.prepare(`
        INSERT INTO crm_messages (
          source_type, source_message_id, thread_id, customer_id, inquiry_id, direction,
          sender_name, sender_contact, receiver_contact, message_text, attachments_json,
          raw_payload_json, received_at, ai_status, dedupe_hash, created_at, updated_at,
          workflow_status
        ) VALUES (
          'manual_whatsapp', ?, ?, ?, NULL, 'outbound',
          'Gavin', '', ?, ?, '[]', ?, ?, 'recorded', ?, ?, ?, 'waiting_reply'
        )
      `).run(
        sourceMessageId,
        `whatsapp:${recipient}`,
        customerId,
        recipient,
        messageText,
        JSON.stringify({ channel, source_url: sourceUrl, idempotency_key: idempotencyKey }),
        sentAt,
        dedupeHash,
        createdAt,
        createdAt
      );
      crmMessage = db.prepare('SELECT * FROM crm_messages WHERE id = ?').get(Number(result.lastInsertRowid));
    }

    const contentHash = crypto.createHash('sha256').update(messageText, 'utf8').digest('hex');
    const thread = ledger.recordThreadMessage({
      customerId,
      channel,
      conversationKey: `whatsapp:${recipient}`,
      sourceKind: 'crm_message',
      sourceId: String(crmMessage.id),
      direction: 'outbound',
      classification: 'manual_initial_outreach',
      messageId: '',
      contentHash,
      occurredAt: sentAt,
      state: 'waiting_customer',
      actorUserId
    });

    const dueAt = new Date(Date.parse(sentAt) + (3 * 24 * 60 * 60 * 1000)).toISOString();
    const task = ledger.createTask({
      customerId,
      sourceKind: 'crm_message',
      sourceId: String(crmMessage.id),
      taskType: 'check_reply',
      dueAt,
      priority: 'high',
      nextAction: '检查 WhatsApp 回复；收到回复后提取规格、数量、图片和联系人。',
      actorUserId
    });
    const updatedAt = now();
    db.prepare(`
      UPDATE customers
      SET whatsapp = ?, stage = 'contacted', last_contact_at = ?, unreplied_since_at = ?,
          is_waiting_reply = 1, next_action = ?, next_followup_at = ?,
          next_followup_channel = 'whatsapp', next_followup_purpose = 'check_reply',
          followup_priority = 'high', updated_at = ?
      WHERE id = ?
    `).run(
      recipient,
      sentAt,
      sentAt,
      '检查 WhatsApp 回复；收到回复后整理规格并推进报价。',
      dueAt,
      updatedAt,
      customerId
    );

    return Object.freeze({
      recorded: thread.inserted,
      customer_id: customerId,
      communication_id: crmMessage.id,
      thread_id: thread.thread.id,
      state: 'waiting_customer',
      followup_task_id: task.id,
      followup_due_at: dueAt
    });
  }

  return { record };
}

module.exports = { createMatrixManualOutbound, normalizeWhatsApp };

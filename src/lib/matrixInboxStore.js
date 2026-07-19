'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_MESSAGE_BYTES = 60 * 1024 * 1024;
const MAX_ATTACHMENTS = 20;

function timestamp() {
  return new Date().toISOString();
}

function notificationUuid(emailMessageId) {
  const bytes = crypto.createHash('sha256')
    .update(`matrix-inbox\0${Number(emailMessageId)}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sanitizeFilename(value, fallback) {
  const base = path.basename(String(value || '').replace(/\\/g, '/'))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return (base || fallback).slice(0, 240);
}

function detectMime(content) {
  if (content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return 'image/jpeg';
  if (content.length >= 6 && ['GIF87a', 'GIF89a'].includes(content.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (content.length >= 12 && content.subarray(0, 4).toString('ascii') === 'RIFF' && content.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (content.length >= 5 && content.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  return 'application/octet-stream';
}

function isAllowedMime(value) {
  return ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'].includes(value);
}

function createAttachmentStore({ root, dbHandle }) {
  if (!root || !dbHandle) throw new Error('attachment root and database are required');
  const configuredRoot = path.resolve(root);
  fs.mkdirSync(configuredRoot, { recursive: true, mode: 0o700 });
  fs.chmodSync(configuredRoot, 0o700);
  const realRoot = fs.realpathSync(configuredRoot);

  function absoluteFor(storageKey) {
    const target = path.resolve(realRoot, String(storageKey || ''));
    if (!target.startsWith(`${realRoot}${path.sep}`)) throw new Error('attachment path escapes private root');
    return target;
  }

  function hydrate(row) {
    return {
      ...row,
      id: Number(row.id),
      email_message_id: Number(row.email_message_id),
      media_order: Number(row.media_order),
      file_size: Number(row.file_size),
      absolute_path: row.storage_key ? absoluteFor(row.storage_key) : ''
    };
  }

  function save({ emailMessageId, index, filename, contentType, content }) {
    const messageId = Number(emailMessageId);
    const mediaOrder = Number(index);
    if (!Number.isInteger(messageId) || messageId <= 0) throw new Error('valid email message id required');
    if (!Number.isInteger(mediaOrder) || mediaOrder < 0 || mediaOrder >= MAX_ATTACHMENTS) throw new Error('attachment index exceeds limit');
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content || '');
    if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error('attachment exceeds 20 MiB');
    const existing = dbHandle.prepare(`
      SELECT * FROM matrix_inbox_attachments
      WHERE email_message_id = ? AND media_order = ?
    `).get(messageId, mediaOrder);
    if (existing) return hydrate(existing);
    const aggregate = Number(dbHandle.prepare(`
      SELECT COALESCE(SUM(file_size), 0) total
      FROM matrix_inbox_attachments WHERE email_message_id = ?
    `).get(messageId)?.total || 0);
    if (aggregate + bytes.length > MAX_MESSAGE_BYTES) throw new Error('message attachments exceed 60 MiB');

    const declaredMime = String(contentType || 'application/octet-stream').toLowerCase();
    const detectedMime = detectMime(bytes);
    const allowed = isAllowedMime(detectedMime) && (declaredMime === detectedMime
      || (detectedMime === 'image/jpeg' && declaredMime === 'image/jpg'));
    const originalFileName = sanitizeFilename(filename, `attachment-${mediaOrder + 1}`);
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    const storageKey = allowed ? `${crypto.randomUUID()}/${mediaOrder}` : '';
    const state = allowed ? 'available' : 'quarantined';
    const reason = allowed ? '' : (isAllowedMime(detectedMime) ? 'declared MIME mismatch' : 'unsupported file type');
    let absolutePath = '';
    let directory = '';
    if (allowed) {
      absolutePath = absoluteFor(storageKey);
      directory = path.dirname(absolutePath);
      fs.mkdirSync(directory, { recursive: false, mode: 0o700 });
      fs.writeFileSync(absolutePath, bytes, { flag: 'wx', mode: 0o600 });
      fs.chmodSync(absolutePath, 0o600);
    }

    const ts = timestamp();
    try {
      const result = dbHandle.prepare(`
        INSERT INTO matrix_inbox_attachments (
          email_message_id, media_order, original_file_name, storage_key,
          detected_mime_type, declared_mime_type, file_size, sha256,
          availability_state, quarantine_reason, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        messageId, mediaOrder, originalFileName, storageKey, detectedMime,
        declaredMime, bytes.length, digest, state, reason, ts, ts
      );
      return hydrate(dbHandle.prepare('SELECT * FROM matrix_inbox_attachments WHERE id = ?').get(result.lastInsertRowid));
    } catch (error) {
      if (absolutePath) {
        try { fs.unlinkSync(absolutePath); } catch (_) {}
        try { fs.rmdirSync(directory); } catch (_) {}
      }
      throw error;
    }
  }

  return { root: realRoot, save, absoluteFor };
}

function enqueueInboxJob(dbHandle, emailMessageId) {
  const messageId = Number(emailMessageId);
  if (!Number.isInteger(messageId) || messageId <= 0) throw new Error('valid email message id required');
  const message = dbHandle.prepare('SELECT id, direction FROM email_messages WHERE id = ?').get(messageId);
  if (!message) throw new Error('email message not found');
  if (message.direction !== 'inbound') throw new Error('only inbound email may be enqueued');
  const existing = dbHandle.prepare('SELECT id, notification_uuid FROM matrix_inbox_jobs WHERE email_message_id = ?').get(messageId);
  if (existing) return { id: Number(existing.id), notification_uuid: existing.notification_uuid, inserted: false };
  const ts = timestamp();
  const uuid = notificationUuid(messageId);
  const result = dbHandle.prepare(`
    INSERT INTO matrix_inbox_jobs (
      email_message_id, notification_uuid, created_at, updated_at
    ) VALUES (?, ?, ?, ?)
  `).run(messageId, uuid, ts, ts);
  return { id: Number(result.lastInsertRowid), notification_uuid: uuid, inserted: true };
}

module.exports = {
  MAX_ATTACHMENT_BYTES,
  MAX_MESSAGE_BYTES,
  MAX_ATTACHMENTS,
  createAttachmentStore,
  enqueueInboxJob,
  notificationUuid,
  sanitizeFilename,
  detectMime
};

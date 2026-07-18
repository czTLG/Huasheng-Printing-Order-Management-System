const crypto = require('node:crypto');

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${name} must be a positive integer`);
  return number;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeBody(value) {
  return String(value || '').replace(/\r\n?/g, '\n').trim();
}

function contentHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify({
    recipient: normalizeEmail(value.recipientEmail),
    source: String(value.recipientSourceUrl),
    subject: String(value.subject).trim(),
    body_en: normalizeBody(value.bodyEn),
    body_cn: normalizeBody(value.bodyCn)
  })).digest('hex');
}

function validateRecipient(input, nowValue = new Date()) {
  const recipient = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const email = normalizeEmail(recipient.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('valid recipient email required');
  let sourceUrl;
  try {
    sourceUrl = new URL(String(recipient.sourceUrl || ''));
  } catch (_) {
    throw new Error('recipient source must be a valid HTTPS URL');
  }
  if (sourceUrl.protocol !== 'https:') throw new Error('recipient source must use HTTPS');
  if (recipient.kind !== 'public_company') throw new Error('recipient must be a public-company address');

  const verifiedAtMs = Date.parse(String(recipient.verifiedAt || ''));
  const nowMs = nowValue instanceof Date ? nowValue.getTime() : Date.parse(String(nowValue));
  if (!Number.isFinite(verifiedAtMs) || !Number.isFinite(nowMs)) throw new Error('valid recipient verification timestamp required');
  if (verifiedAtMs > nowMs) throw new Error('recipient verification timestamp is in the future');
  const configuredDays = Number(process.env.MATRIX_RECIPIENT_MAX_AGE_DAYS || 180);
  const maxAgeDays = Number.isFinite(configuredDays) && configuredDays > 0 ? configuredDays : 180;
  if (nowMs - verifiedAtMs > maxAgeDays * 86400000) throw new Error('recipient verification is stale');

  return {
    email,
    sourceUrl: sourceUrl.toString(),
    verifiedAt: new Date(verifiedAtMs).toISOString(),
    kind: 'public_company'
  };
}

function requiredText(value, name) {
  const text = normalizeBody(value);
  if (!text) throw new Error(`${name} required`);
  return text;
}

function requiredKey(value) {
  const key = String(value || '').trim();
  if (!key) throw new Error('idempotency key required');
  return key;
}

function timestamp() {
  return new Date().toISOString();
}

function versionById(db, versionId) {
  return db.prepare('SELECT * FROM matrix_stream_versions WHERE id = ?').get(versionId) || null;
}

function validateStoredRecipient(version) {
  return validateRecipient({
    email: version.recipient_email,
    sourceUrl: version.recipient_source_url,
    verifiedAt: version.recipient_verified_at,
    kind: 'public_company'
  });
}

function ownedWorkItem(db, workItemId, actorUserId, expectedWorkVersion) {
  const actor = db.prepare('SELECT id, status FROM users WHERE id = ?').get(actorUserId);
  if (!actor || actor.status !== 'active') throw new Error('actor is not active');
  const item = db.prepare('SELECT * FROM matrix_work_items WHERE id = ?').get(workItemId);
  if (!item || item.owner_user_id !== actorUserId) throw new Error('not authorized');
  if (item.stage === 'suppressed' || item.stream_state === 'suppressed') throw new Error('work item is suppressed');
  if (item.version !== expectedWorkVersion) throw new Error('stale work version');
  return item;
}

function replay(db, idempotencyKey, actorUserId) {
  const event = db.prepare('SELECT * FROM matrix_stream_events WHERE idempotency_key = ?').get(idempotencyKey);
  if (!event) return null;
  if (event.actor_user_id !== actorUserId) throw new Error('not authorized');
  const after = JSON.parse(event.after_json || '{}');
  const version = versionById(db, after.version_id || event.version_id);
  if (!version) throw new Error('recorded version not found');
  return version;
}

function addEvent(db, { workItemId, versionId, actorUserId, action, idempotencyKey, contentHash: hash, before, after, at }) {
  db.prepare(`
    INSERT INTO matrix_stream_events (
      work_item_id, version_id, actor_user_id, action, idempotency_key,
      content_hash, before_json, after_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    workItemId, versionId, actorUserId, action, idempotencyKey, hash,
    JSON.stringify(before || {}), JSON.stringify(after || {}), at
  );
}

function createInitialVersion(db, input = {}) {
  const actorUserId = positiveInteger(input.actorUserId, 'actor user id');
  const workItemId = positiveInteger(input.workItemId, 'work item id');
  const expectedWorkVersion = positiveInteger(input.expectedWorkVersion, 'expected work version');
  const idempotencyKey = requiredKey(input.idempotencyKey);
  const transaction = db.transaction(() => {
    const previous = replay(db, idempotencyKey, actorUserId);
    if (previous) return previous;
    ownedWorkItem(db, workItemId, actorUserId, expectedWorkVersion);
    const recipient = validateRecipient(input.recipient);
    const subject = requiredText(input.subject, 'subject');
    const bodyEn = requiredText(input.bodyEn, 'English body');
    const bodyCn = requiredText(input.bodyCn, 'Chinese body');
    const sourceSnapshot = input.sourceSnapshot && typeof input.sourceSnapshot === 'object' && !Array.isArray(input.sourceSnapshot)
      ? input.sourceSnapshot : {};
    const hash = contentHash({
      recipientEmail: recipient.email,
      recipientSourceUrl: recipient.sourceUrl,
      subject,
      bodyEn,
      bodyCn
    });
    const at = timestamp();
    const inserted = db.prepare(`
      INSERT INTO matrix_stream_versions (
        work_item_id, revision, recipient_email, recipient_source_url, recipient_verified_at,
        subject, body_en, body_cn, strategy_summary, source_snapshot_json, content_hash,
        status, created_by, created_at, updated_at
      ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)
    `).run(
      workItemId, recipient.email, recipient.sourceUrl, recipient.verifiedAt,
      subject, bodyEn, bodyCn, String(input.strategySummary || '').trim(), JSON.stringify(sourceSnapshot),
      hash, actorUserId, at, at
    );
    const versionId = Number(inserted.lastInsertRowid);
    const updated = db.prepare(`
      UPDATE matrix_work_items
      SET stage = 'draft_pending', stream_state = 'draft_pending', current_stream_version_id = ?,
          version = version + 1, updated_at = ?
      WHERE id = ? AND owner_user_id = ? AND version = ?
    `).run(versionId, at, workItemId, actorUserId, expectedWorkVersion);
    if (updated.changes !== 1) throw new Error('stale work version');
    const result = versionById(db, versionId);
    addEvent(db, {
      workItemId, versionId, actorUserId, action: 'created', idempotencyKey,
      contentHash: hash, before: {}, after: { version_id: versionId, revision: 1, status: result.status }, at
    });
    return result;
  });
  return transaction.immediate();
}

function approveVersion(db, input = {}) {
  const actorUserId = positiveInteger(input.actorUserId, 'actor user id');
  const workItemId = positiveInteger(input.workItemId, 'work item id');
  const versionId = positiveInteger(input.versionId, 'version id');
  const expectedWorkVersion = positiveInteger(input.expectedWorkVersion, 'expected work version');
  const idempotencyKey = requiredKey(input.idempotencyKey);
  const expectedContentHash = String(input.expectedContentHash || '').trim();
  if (!expectedContentHash) throw new Error('expected content hash required');
  const transaction = db.transaction(() => {
    const previous = replay(db, idempotencyKey, actorUserId);
    if (previous) return previous;
    ownedWorkItem(db, workItemId, actorUserId, expectedWorkVersion);
    const version = versionById(db, versionId);
    if (!version || version.work_item_id !== workItemId) throw new Error('version not found');
    if (version.status !== 'draft') throw new Error('version is not a draft');
    if (version.content_hash !== expectedContentHash) throw new Error('content hash mismatch');
    validateStoredRecipient(version);
    const at = timestamp();
    const changed = db.prepare(`
      UPDATE matrix_stream_versions
      SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ?
      WHERE id = ? AND work_item_id = ? AND status = 'draft' AND content_hash = ?
    `).run(actorUserId, at, at, versionId, workItemId, expectedContentHash);
    if (changed.changes !== 1) throw new Error('version approval conflict');
    const updated = db.prepare(`
      UPDATE matrix_work_items
      SET stage = 'review_pending', stream_state = 'approved', current_stream_version_id = ?,
          version = version + 1, updated_at = ?
      WHERE id = ? AND owner_user_id = ? AND version = ?
    `).run(versionId, at, workItemId, actorUserId, expectedWorkVersion);
    if (updated.changes !== 1) throw new Error('stale work version');
    const result = versionById(db, versionId);
    addEvent(db, {
      workItemId, versionId, actorUserId, action: 'approved', idempotencyKey,
      contentHash: result.content_hash, before: { status: version.status },
      after: { version_id: versionId, revision: result.revision, status: result.status }, at
    });
    return result;
  });
  return transaction.immediate();
}

function reviseVersion(db, input = {}) {
  const actorUserId = positiveInteger(input.actorUserId, 'actor user id');
  const workItemId = positiveInteger(input.workItemId, 'work item id');
  const baseVersionId = positiveInteger(input.baseVersionId, 'base version id');
  const expectedWorkVersion = positiveInteger(input.expectedWorkVersion, 'expected work version');
  const idempotencyKey = requiredKey(input.idempotencyKey);
  const transaction = db.transaction(() => {
    const previous = replay(db, idempotencyKey, actorUserId);
    if (previous) return previous;
    ownedWorkItem(db, workItemId, actorUserId, expectedWorkVersion);
    const base = versionById(db, baseVersionId);
    if (!base || base.work_item_id !== workItemId) throw new Error('base version not found');
    if (!['draft', 'approved'].includes(base.status)) throw new Error('base version cannot be revised');
    validateStoredRecipient(base);
    const subject = requiredText(input.subject, 'subject');
    const bodyEn = requiredText(input.bodyEn, 'English body');
    const bodyCn = requiredText(input.bodyCn, 'Chinese body');
    const hash = contentHash({
      recipientEmail: base.recipient_email,
      recipientSourceUrl: base.recipient_source_url,
      subject,
      bodyEn,
      bodyCn
    });
    const at = timestamp();
    const nextRevision = Number(db.prepare(
      'SELECT COALESCE(MAX(revision), 0) + 1 AS revision FROM matrix_stream_versions WHERE work_item_id = ?'
    ).get(workItemId).revision);
    db.prepare(`
      UPDATE matrix_stream_versions SET status = 'superseded', updated_at = ?
      WHERE id = ? AND status IN ('draft', 'approved')
    `).run(at, baseVersionId);
    const inserted = db.prepare(`
      INSERT INTO matrix_stream_versions (
        work_item_id, revision, recipient_email, recipient_source_url, recipient_verified_at,
        subject, body_en, body_cn, strategy_summary, source_snapshot_json, content_hash,
        status, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)
    `).run(
      workItemId, nextRevision, base.recipient_email, base.recipient_source_url, base.recipient_verified_at,
      subject, bodyEn, bodyCn, base.strategy_summary, base.source_snapshot_json, hash, actorUserId, at, at
    );
    const versionId = Number(inserted.lastInsertRowid);
    const updated = db.prepare(`
      UPDATE matrix_work_items
      SET stage = 'draft_pending', stream_state = 'draft_pending', current_stream_version_id = ?,
          version = version + 1, updated_at = ?
      WHERE id = ? AND owner_user_id = ? AND version = ?
    `).run(versionId, at, workItemId, actorUserId, expectedWorkVersion);
    if (updated.changes !== 1) throw new Error('stale work version');
    const result = versionById(db, versionId);
    addEvent(db, {
      workItemId, versionId, actorUserId, action: 'revised', idempotencyKey,
      contentHash: hash, before: { version_id: base.id, revision: base.revision, status: base.status },
      after: { version_id: versionId, revision: result.revision, status: result.status }, at
    });
    return result;
  });
  return transaction.immediate();
}

function getVersion(db, input = {}) {
  const actorUserId = positiveInteger(input.actorUserId, 'actor user id');
  const versionId = positiveInteger(input.versionId, 'version id');
  const version = versionById(db, versionId);
  if (!version) return null;
  const item = db.prepare('SELECT owner_user_id FROM matrix_work_items WHERE id = ?').get(version.work_item_id);
  if (!item || item.owner_user_id !== actorUserId) throw new Error('not authorized');
  const actor = db.prepare('SELECT status FROM users WHERE id = ?').get(actorUserId);
  if (!actor || actor.status !== 'active') throw new Error('actor is not active');
  return version;
}

module.exports = {
  contentHash,
  createInitialVersion,
  reviseVersion,
  approveVersion,
  getVersion,
  validateRecipient
};

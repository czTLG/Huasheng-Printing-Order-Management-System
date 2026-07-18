const crypto = require('node:crypto');
const net = require('node:net');
const { domainToASCII } = require('node:url');

const MULTI_LABEL_PUBLIC_SUFFIXES = new Set([
  'ac.uk', 'co.uk', 'gov.uk', 'ltd.uk', 'me.uk', 'net.uk', 'nhs.uk', 'org.uk', 'plc.uk', 'police.uk', 'sch.uk',
  'ac.cn', 'com.cn', 'edu.cn', 'gov.cn', 'net.cn', 'org.cn',
  'asn.au', 'com.au', 'edu.au', 'gov.au', 'id.au', 'net.au', 'org.au',
  'ac.jp', 'co.jp', 'go.jp', 'ne.jp', 'or.jp',
  'ac.kr', 'co.kr', 'go.kr', 'ne.kr', 'or.kr', 'pe.kr', 're.kr',
  'ac.nz', 'co.nz', 'govt.nz', 'net.nz', 'org.nz', 'school.nz',
  'com.br', 'net.br', 'org.br', 'com.hk', 'net.hk', 'org.hk',
  'com.mx', 'com.sg', 'com.tw', 'co.in', 'firm.in', 'gen.in', 'ind.in', 'net.in', 'org.in',
  'appspot.com', 'cloudfront.net', 'github.io', 'netlify.app', 'pages.dev', 'vercel.app'
]);
const COMMON_CC_REGISTRY_LABELS = new Set(['ac', 'asn', 'co', 'com', 'edu', 'firm', 'gen', 'go', 'gov', 'id', 'ind', 'ltd', 'me', 'ne', 'net', 'or', 'org', 'pe', 'plc', 're', 'school']);
const VALID_GENERIC_TLDS = new Set([
  'aero', 'ai', 'app', 'asia', 'biz', 'blog', 'cloud', 'club', 'com', 'company', 'coop', 'dev', 'digital',
  'edu', 'email', 'gov', 'info', 'int', 'io', 'live', 'me', 'mil', 'mobi', 'museum', 'name', 'net', 'news',
  'online', 'org', 'pro', 'shop', 'site', 'solutions', 'space', 'store', 'tech', 'test', 'top', 'travel', 'tv',
  'vip', 'website', 'world', 'xyz'
]);

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

function requestFingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
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

function normalizedHostname(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/\.$/, '');
  const ascii = domainToASCII(raw);
  if (!ascii || net.isIP(ascii)) return null;
  const labels = ascii.split('.');
  if (labels.some(label => !label || label.length > 63 || !/^[a-z0-9-]+$/.test(label) || label.startsWith('-') || label.endsWith('-'))) return null;
  return ascii;
}

function registrableDomain(value) {
  const hostname = normalizedHostname(value);
  if (!hostname) return null;
  const labels = hostname.split('.');
  if (labels.length < 2) return null;
  const topLevel = labels.at(-1);
  if (topLevel.length !== 2 && !VALID_GENERIC_TLDS.has(topLevel)) return null;
  let suffixLabels = 1;
  for (const suffix of MULTI_LABEL_PUBLIC_SUFFIXES) {
    if (hostname === suffix || hostname.endsWith(`.${suffix}`)) {
      suffixLabels = Math.max(suffixLabels, suffix.split('.').length);
    }
  }
  const last = topLevel;
  const secondLast = labels.at(-2);
  if (last.length === 2 && COMMON_CC_REGISTRY_LABELS.has(secondLast)) suffixLabels = Math.max(suffixLabels, 2);
  if (labels.length <= suffixLabels) return null;
  return labels.slice(-(suffixLabels + 1)).join('.');
}

function checkedRecipientEvidence(db, { workItemId, recipient, evidenceId } = {}) {
  const normalized = validateRecipient(recipient);
  const rows = evidenceId
    ? [db.prepare('SELECT * FROM matrix_stream_recipient_evidence WHERE id = ?').get(evidenceId)].filter(Boolean)
    : db.prepare(`
      SELECT * FROM matrix_stream_recipient_evidence
      WHERE work_item_id = ? AND lower(recipient_email) = ? AND status = 'active'
      ORDER BY id DESC
    `).all(workItemId, normalized.email);
  const evidence = rows.find(row => {
    if (row.work_item_id !== workItemId || row.status !== 'active') return false;
    let evidenceSource;
    try {
      evidenceSource = new URL(row.source_url);
    } catch (_) {
      return false;
    }
    const emailDomain = normalized.email.split('@')[1];
    const verifiedAt = Date.parse(row.verified_at);
    const organizationDomain = normalizedHostname(row.organization_domain);
    const organizationRegistrable = registrableDomain(organizationDomain);
    return normalizeEmail(row.recipient_email) === normalized.email
      && evidenceSource.toString() === normalized.sourceUrl
      && new Date(verifiedAt).toISOString() === normalized.verifiedAt
      && organizationRegistrable !== null
      && organizationDomain === organizationRegistrable
      && registrableDomain(emailDomain) === organizationRegistrable
      && registrableDomain(evidenceSource.hostname) === organizationRegistrable;
  });
  if (!evidence) throw new Error('trusted recipient evidence binding required');
  let snapshot;
  try {
    snapshot = JSON.parse(evidence.snapshot_json);
  } catch (_) {
    throw new Error('trusted recipient evidence snapshot invalid');
  }
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
      || String(snapshot.organization_domain || '').toLowerCase() !== String(evidence.organization_domain).toLowerCase()
      || normalizeEmail(snapshot.recipient_email) !== normalized.email
      || String(snapshot.source_url || '') !== normalized.sourceUrl) {
    throw new Error('trusted recipient evidence snapshot binding invalid');
  }
  return { recipient: normalized, evidence, snapshot };
}

function validateStoredRecipient(db, version) {
  return checkedRecipientEvidence(db, {
    workItemId: version.work_item_id,
    evidenceId: version.recipient_evidence_id,
    recipient: {
    email: version.recipient_email,
    sourceUrl: version.recipient_source_url,
    verifiedAt: version.recipient_verified_at,
    kind: 'public_company'
    }
  });
}

function activeOwnedWorkItem(db, workItemId, actorUserId) {
  const actor = db.prepare('SELECT id, status FROM users WHERE id = ?').get(actorUserId);
  if (!actor || actor.status !== 'active') throw new Error('actor is not active');
  const item = db.prepare('SELECT * FROM matrix_work_items WHERE id = ?').get(workItemId);
  if (!item || item.owner_user_id !== actorUserId) throw new Error('not authorized');
  if (item.stage === 'suppressed' || item.stream_state === 'suppressed') throw new Error('work item is suppressed');
  return item;
}

function ownedWorkItem(db, workItemId, actorUserId, expectedWorkVersion) {
  const item = activeOwnedWorkItem(db, workItemId, actorUserId);
  if (item.version !== expectedWorkVersion) throw new Error('stale work version');
  return item;
}

function replay(db, { idempotencyKey, actorUserId, workItemId, action, fingerprint }) {
  const event = db.prepare('SELECT * FROM matrix_stream_events WHERE idempotency_key = ?').get(idempotencyKey);
  if (!event) return null;
  activeOwnedWorkItem(db, workItemId, actorUserId);
  if (event.actor_user_id !== actorUserId || event.work_item_id !== workItemId
      || event.action !== action || event.request_fingerprint !== fingerprint) {
    throw new Error('idempotency request fingerprint or scope mismatch');
  }
  const after = JSON.parse(event.after_json || '{}');
  const version = versionById(db, after.version_id || event.version_id);
  if (!version || version.work_item_id !== workItemId) throw new Error('recorded version scope mismatch');
  validateStoredRecipient(db, version);
  const recorded = after.response && typeof after.response === 'object' && !Array.isArray(after.response)
    ? after.response
    : { ...version, ...(after.status ? { status: after.status } : {}) };
  return { ...recorded, current_status: version.status };
}

function addEvent(db, { workItemId, versionId, actorUserId, action, idempotencyKey, fingerprint, contentHash: hash, before, after, at }) {
  db.prepare(`
    INSERT INTO matrix_stream_events (
      work_item_id, version_id, actor_user_id, action, idempotency_key,
      request_fingerprint, content_hash, before_json, after_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    workItemId, versionId, actorUserId, action, idempotencyKey, fingerprint, hash,
    JSON.stringify(before || {}), JSON.stringify(after || {}), at
  );
}

function createInitialVersion(db, input = {}) {
  const actorUserId = positiveInteger(input.actorUserId, 'actor user id');
  const workItemId = positiveInteger(input.workItemId, 'work item id');
  const expectedWorkVersion = positiveInteger(input.expectedWorkVersion, 'expected work version');
  const idempotencyKey = requiredKey(input.idempotencyKey);
  const normalizedRecipient = validateRecipient(input.recipient);
  const subject = requiredText(input.subject, 'subject');
  const bodyEn = requiredText(input.bodyEn, 'English body');
  const bodyCn = requiredText(input.bodyCn, 'Chinese body');
  const strategySummary = String(input.strategySummary || '').trim();
  const sourceSnapshotInput = input.sourceSnapshot && typeof input.sourceSnapshot === 'object' && !Array.isArray(input.sourceSnapshot)
    ? input.sourceSnapshot : {};
  const fingerprint = requestFingerprint({
    action: 'created', actorUserId, workItemId, expectedWorkVersion,
    recipient: normalizedRecipient, subject, bodyEn, bodyCn, strategySummary, sourceSnapshot: sourceSnapshotInput
  });
  const transaction = db.transaction(() => {
    const previous = replay(db, { idempotencyKey, actorUserId, workItemId, action: 'created', fingerprint });
    if (previous) return previous;
    ownedWorkItem(db, workItemId, actorUserId, expectedWorkVersion);
    const evidenceBinding = checkedRecipientEvidence(db, { workItemId, recipient: normalizedRecipient });
    const recipient = evidenceBinding.recipient;
    const sourceSnapshot = evidenceBinding.snapshot;
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
        work_item_id, recipient_evidence_id, revision, recipient_email, recipient_source_url, recipient_verified_at,
        subject, body_en, body_cn, strategy_summary, source_snapshot_json, content_hash,
        status, created_by, created_at, updated_at
      ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)
    `).run(
      workItemId, evidenceBinding.evidence.id, recipient.email, recipient.sourceUrl, recipient.verifiedAt,
      subject, bodyEn, bodyCn, strategySummary, JSON.stringify(sourceSnapshot),
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
      workItemId, versionId, actorUserId, action: 'created', idempotencyKey, fingerprint,
      contentHash: hash, before: {}, after: { version_id: versionId, revision: 1, status: result.status, response: result }, at
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
  const fingerprint = requestFingerprint({
    action: 'approved', actorUserId, workItemId, versionId, expectedWorkVersion, expectedContentHash
  });
  const transaction = db.transaction(() => {
    const previous = replay(db, { idempotencyKey, actorUserId, workItemId, action: 'approved', fingerprint });
    if (previous) return previous;
    ownedWorkItem(db, workItemId, actorUserId, expectedWorkVersion);
    const version = versionById(db, versionId);
    if (!version || version.work_item_id !== workItemId) throw new Error('version not found');
    if (version.status !== 'draft') throw new Error('version is not a draft');
    const canonicalHash = contentHash({
      recipientEmail: version.recipient_email,
      recipientSourceUrl: version.recipient_source_url,
      subject: version.subject,
      bodyEn: version.body_en,
      bodyCn: version.body_cn
    });
    if (version.content_hash !== canonicalHash || expectedContentHash !== canonicalHash) throw new Error('content hash mismatch');
    validateStoredRecipient(db, version);
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
      workItemId, versionId, actorUserId, action: 'approved', idempotencyKey, fingerprint,
      contentHash: result.content_hash, before: { status: version.status },
      after: { version_id: versionId, revision: result.revision, status: result.status, response: result }, at
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
  const subject = requiredText(input.subject, 'subject');
  const bodyEn = requiredText(input.bodyEn, 'English body');
  const bodyCn = requiredText(input.bodyCn, 'Chinese body');
  const fingerprint = requestFingerprint({
    action: 'revised', actorUserId, workItemId, baseVersionId, expectedWorkVersion, subject, bodyEn, bodyCn
  });
  const transaction = db.transaction(() => {
    const previous = replay(db, { idempotencyKey, actorUserId, workItemId, action: 'revised', fingerprint });
    if (previous) return previous;
    ownedWorkItem(db, workItemId, actorUserId, expectedWorkVersion);
    const base = versionById(db, baseVersionId);
    if (!base || base.work_item_id !== workItemId) throw new Error('base version not found');
    if (!['draft', 'approved'].includes(base.status)) throw new Error('base version cannot be revised');
    validateStoredRecipient(db, base);
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
        work_item_id, recipient_evidence_id, revision, recipient_email, recipient_source_url, recipient_verified_at,
        subject, body_en, body_cn, strategy_summary, source_snapshot_json, content_hash,
        status, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)
    `).run(
      workItemId, base.recipient_evidence_id, nextRevision, base.recipient_email, base.recipient_source_url, base.recipient_verified_at,
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
      workItemId, versionId, actorUserId, action: 'revised', idempotencyKey, fingerprint,
      contentHash: hash, before: { version_id: base.id, revision: base.revision, status: base.status },
      after: { version_id: versionId, revision: result.revision, status: result.status, response: result }, at
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

'use strict';

const crypto = require('node:crypto');

function positive(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} required`);
  return number;
}

function required(value, label) {
  const result = String(value == null ? '' : value).trim();
  if (!result) throw new Error(`${label} required`);
  return result;
}

function normalizedEmail(value) {
  return required(value, 'candidate recipient').toLowerCase();
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function createMatrixIntakeBridge({
  db,
  store,
  reviewService,
  prepareCandidate,
  clock = () => new Date()
} = {}) {
  if (!db || !store || !reviewService || typeof prepareCandidate !== 'function') throw new Error('intake bridge dependencies required');

  async function create(input = {}) {
    const attachments = Array.isArray(input.attachmentManifest) ? input.attachmentManifest : [];
    if (attachments.length) throw new Error('attachments are not supported in the first intake release');
    const actorUserId = positive(input.actorUserId, 'actor user id');
    const candidate = input.candidate || {};
    const candidateId = positive(candidate.id, 'candidate id');
    const companyName = required(candidate.company_name, 'company name');
    const normalizedDomain = required(candidate.normalized_domain, 'normalized domain').toLowerCase();
    const idempotencyKey = required(input.idempotencyKey, 'idempotency key');
    const subject = required(input.subject, 'subject');
    const bodyEn = required(input.bodyEn, 'English body');
    const bodyCn = required(input.bodyCn, 'Chinese body');
    const strategySummary = String(input.strategySummary || '').trim();
    const prepared = await prepareCandidate(candidate);
    const recipient = prepared?.recipient || {};
    if (normalizedEmail(candidate.public_email) !== normalizedEmail(recipient.email)
        || required(candidate.contact_url, 'candidate contact source') !== required(recipient.sourceUrl, 'recipient source')
        || normalizedDomain !== required(prepared.organizationDomain, 'organization domain').toLowerCase()) {
      throw new Error('candidate recipient mismatch');
    }
    const sourceSnapshot = prepared.sourceSnapshot;
    if (!sourceSnapshot || typeof sourceSnapshot !== 'object' || Array.isArray(sourceSnapshot)) throw new Error('source snapshot required');
    const request = {
      actorUserId, candidateId, companyName, normalizedDomain,
      recipient, subject, bodyEn, bodyCn, strategySummary, sourceSnapshot,
      attachmentManifest: [], idempotencyKey
    };
    const requestFingerprint = fingerprint(request);
    const atValue = clock();
    const at = new Date(atValue instanceof Date ? atValue.getTime() : Date.parse(String(atValue))).toISOString();

    const transaction = db.transaction(() => {
      const prior = db.prepare('SELECT * FROM matrix_intake_requests WHERE idempotency_key = ?').get(idempotencyKey);
      if (prior) {
        if (prior.request_fingerprint !== requestFingerprint
            || Number(prior.actor_user_id) !== actorUserId
            || Number(prior.candidate_id) !== candidateId) throw new Error('intake idempotency conflict');
        return { ...JSON.parse(prior.response_json), resolution: 'replayed' };
      }

      const resolved = store.resolveCustomer({
        candidateId,
        companyName,
        normalizedDomain,
        channel: 'email',
        address: recipient.email,
        actorUserId
      });
      const customerId = Number(resolved.canonical_customer_id);
      store.upsertContact({
        customerId,
        channel: 'email',
        address: recipient.email,
        role: candidate.contact_role || 'public company',
        sourceUrl: recipient.sourceUrl,
        verifiedAt: recipient.verifiedAt,
        status: 'active',
        actorUserId
      });

      let workItem = db.prepare('SELECT * FROM matrix_work_items WHERE candidate_id = ?').get(candidateId);
      if (workItem && Number(workItem.owner_user_id) !== actorUserId) throw new Error('work item ownership conflict');
      if (workItem?.current_stream_version_id) throw new Error('candidate already has a draft');
      if (!workItem) {
        const inserted = db.prepare(`
          INSERT INTO matrix_work_items (
            candidate_id,stage,owner_user_id,current_summary,next_action,version,created_at,updated_at
          ) VALUES (?,'selected',?,'','Review exact intake draft',1,?,?)
        `).run(candidateId, actorUserId, at, at);
        workItem = db.prepare('SELECT * FROM matrix_work_items WHERE id = ?').get(Number(inserted.lastInsertRowid));
      }

      db.prepare(`
        INSERT OR IGNORE INTO matrix_stream_recipient_evidence (
          work_item_id,organization_domain,recipient_email,source_url,verified_at,
          snapshot_json,status,created_by,created_at
        ) VALUES (?,?,?,?,?,?,'active',?,?)
      `).run(
        workItem.id, normalizedDomain, normalizedEmail(recipient.email), recipient.sourceUrl,
        recipient.verifiedAt, JSON.stringify(sourceSnapshot), actorUserId, at
      );

      const version = reviewService.createInitialVersion(db, {
        actorUserId,
        workItemId: workItem.id,
        expectedWorkVersion: workItem.version,
        recipient,
        subject,
        bodyEn,
        bodyCn,
        strategySummary,
        sourceSnapshot,
        idempotencyKey: `version:${idempotencyKey}`
      });
      const current = db.prepare('SELECT version FROM matrix_work_items WHERE id = ?').get(workItem.id);
      const response = {
        customer_id: customerId,
        work_item_id: workItem.id,
        work_item_version: Number(current.version),
        version_id: Number(version.id),
        content_hash: version.content_hash,
        status: version.status,
        resolution: 'inserted'
      };
      db.prepare(`
        INSERT INTO matrix_intake_requests (
          idempotency_key,request_fingerprint,candidate_id,actor_user_id,response_json,created_at
        ) VALUES (?,?,?,?,?,?)
      `).run(idempotencyKey, requestFingerprint, candidateId, actorUserId, JSON.stringify(response), at);
      return response;
    });
    return transaction.immediate();
  }

  return { create };
}

module.exports = { createMatrixIntakeBridge };

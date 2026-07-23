'use strict';

const crypto = require('node:crypto');

const MATCH_RULES = [
  'explicit_source_id',
  'exact_official_email',
  'verified_domain_and_company',
  'exact_subject_and_body_hash',
  'message_reference_chain',
  'protected_explicit_mapping'
];
const ZERO_COUNTS = Object.freeze({ imported: 0, matched: 0, unresolved: 0, skipped: 0, conflicts: 0 });
const BLOCKED_HISTORY_STATES = new Set(['bounced', 'suppressed', 'stale']);

function text(value) { return String(value == null ? '' : value).trim(); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stable(value[key]);
    return result;
  }, {});
  return value;
}
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
function safeProvenance(input = {}) {
  const provenance = input.provenance && typeof input.provenance === 'object' ? input.provenance : {};
  return {
    sourcePath: text(provenance.sourcePath || input.sourcePath),
    bodyHash: text(provenance.bodyHash || input.bodyHash || input.contentHash),
    attachmentHashes: Array.isArray(provenance.attachmentHashes) ? provenance.attachmentHashes.map(text).filter(Boolean) : []
  };
}

function createMatrixLedgerMigration({ db, candidateDb, store, clock = () => new Date() } = {}) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') throw new Error('database required');
  if (!candidateDb || typeof candidateDb.prepare !== 'function') throw new Error('candidate database required');
  if (!store || typeof store.resolveCustomer !== 'function') throw new Error('ledger store required');

  function now() {
    const value = clock();
    const timestamp = value instanceof Date ? value.getTime() : Date.parse(String(value));
    if (!Number.isFinite(timestamp)) throw new Error('clock must return a valid date');
    return new Date(timestamp).toISOString();
  }
  function sourceFingerprint(record) {
    return hash({ sourceKind: text(record.sourceKind), sourceId: text(record.sourceId), occurredAt: text(record.occurredAt), companyName: text(record.companyName), evidence: record.evidence || {}, provenance: safeProvenance(record) });
  }
  function linkedCustomers(sourceKind, sourceId) {
    if (!text(sourceKind) || !text(sourceId)) return [];
    return db.prepare('SELECT canonical_customer_id FROM matrix_customer_links WHERE source_kind = ? AND source_id = ?')
      .all(text(sourceKind), text(sourceId)).map(row => Number(row.canonical_customer_id));
  }
  function blockedHistory(record) {
    const state = text(record.deliveryState || record.historyState || record.state).toLowerCase();
    return Boolean(record.suppressed || record.stale || BLOCKED_HISTORY_STATES.has(state));
  }
  function match(record) {
    const evidence = record.evidence || {};
    const hits = [];
    const add = (rule, ids) => ids.forEach(id => hits.push({ rule, id }));
    const explicit = evidence.explicitSourceId || {};
    add('explicit_source_id', linkedCustomers(explicit.kind, explicit.id));
    const email = text(evidence.officialEmail).toLowerCase();
    if (email) add('exact_official_email', db.prepare("SELECT canonical_customer_id FROM matrix_contacts WHERE channel = 'email' AND address = ? AND status = 'active'").all(email).map(row => Number(row.canonical_customer_id)));
    const domain = text(evidence.verifiedDomain).toLowerCase();
    const companyName = text(evidence.companyName || record.companyName);
    if (domain && companyName) add('verified_domain_and_company', db.prepare(`SELECT l.canonical_customer_id FROM matrix_customer_links l JOIN customers c ON c.id = l.canonical_customer_id WHERE l.normalized_domain = ? AND lower(c.name) = lower(?) AND c.active = 1`).all(domain, companyName).map(row => Number(row.canonical_customer_id)));
    const draft = evidence.exactSubjectAndBodyHash || {};
    if (text(draft.subject) && text(draft.bodyHash)) add('exact_subject_and_body_hash', linkedCustomers('protected_mapping', `draft:${text(draft.subject)}:${text(draft.bodyHash)}`));
    const references = Array.isArray(evidence.messageReferenceChain) ? [...new Set(evidence.messageReferenceChain.map(text).filter(Boolean))] : [];
    if (references.length) {
      const referenceMatches = references.map(reference => linkedCustomers('protected_mapping', `message:${reference}`));
      if (referenceMatches.every(ids => ids.length)) add('message_reference_chain', referenceMatches.flat());
    }
    if (text(evidence.protectedExplicitMapping)) add('protected_explicit_mapping', linkedCustomers('protected_mapping', evidence.protectedExplicitMapping));
    const ids = [...new Set(hits.map(hit => hit.id))];
    if (ids.length > 1) return { resolution: 'conflict', reasonCode: 'conflicting_deterministic_evidence', customerId: null, rules: hits.map(hit => hit.rule) };
    if (blockedHistory(record)) return { resolution: 'unresolved', reasonCode: 'historical_delivery_not_eligible', customerId: null, rules: hits.map(hit => hit.rule) };
    if (ids.length === 1) return { resolution: 'matched', reasonCode: hits.find(hit => hit.id === ids[0]).rule, customerId: ids[0], rules: hits.map(hit => hit.rule) };
    if (text(evidence.candidateId) && companyName) return { resolution: 'imported', reasonCode: 'new_candidate_identity', customerId: null, rules: [] };
    return { resolution: 'unresolved', reasonCode: 'insufficient_deterministic_evidence', customerId: null, rules: [] };
  }
  function sourceRecords(sources = {}) {
    if (Array.isArray(sources)) return sources;
    if (!sources || typeof sources !== 'object') throw new Error('sources.records required');
    const records = Array.isArray(sources.records) ? [...sources.records] : [];
    if (text(sources.candidateQuery)) {
      const query = text(sources.candidateQuery);
      if (!/^select\s/i.test(query) || /;/.test(query)) throw new Error('candidate query must be a single SELECT');
      for (const row of candidateDb.prepare(query).all()) records.push(row.record_json ? JSON.parse(row.record_json) : row);
    }
    if (!records.length && !Array.isArray(sources.records) && !text(sources.candidateQuery)) throw new Error('sources.records required');
    return records;
  }
  function scan(sources = {}) {
    const records = sourceRecords(sources);
    const duplicateKeys = new Set();
    const seenKeys = new Set();
    for (const record of records) {
      const key = `${text(record.sourceKind)}\u0000${text(record.sourceId)}`;
      if (seenKeys.has(key)) duplicateKeys.add(key);
      seenKeys.add(key);
    }
    const counts = { ...ZERO_COUNTS };
    const entries = records.map(record => {
      const sourceKind = text(record.sourceKind);
      const sourceId = text(record.sourceId);
      if (!sourceKind || !sourceId) throw new Error('source kind and source id required');
      const fingerprint = sourceFingerprint(record);
      const duplicate = duplicateKeys.has(`${sourceKind}\u0000${sourceId}`);
      const seen = !duplicate && db.prepare('SELECT id FROM matrix_migration_records WHERE source_kind = ? AND source_id = ? AND source_fingerprint = ?').get(sourceKind, sourceId, fingerprint);
      const resolution = duplicate
        ? { resolution: 'conflict', reasonCode: 'duplicate_input_source', customerId: null, rules: [] }
        : seen ? { resolution: 'skipped', reasonCode: 'already_migrated', customerId: null, rules: [] }
          : match(record);
      counts[resolution.resolution === 'conflict' ? 'conflicts' : resolution.resolution] += 1;
      return { record, sourceKind, sourceId, fingerprint, provenance: safeProvenance(record), duplicate, ...resolution };
    });
    return { ...counts, entries, counts, fingerprints: entries.map(entry => entry.fingerprint), sourceFingerprint: hash(entries.map(entry => entry.fingerprint)) };
  }
  function requireInsert(result, label) {
    if (!result || result.changes !== 1) throw new Error(`${label} insert conflict`);
  }
  function apply(plan, { actorUserId, idempotencyKey } = {}) {
    if (!plan || !Array.isArray(plan.entries) || !plan.counts) throw new Error('migration plan required');
    const key = text(idempotencyKey);
    if (!key) throw new Error('idempotency key required');
    if (plan.entries.some(entry => entry.duplicate)) throw new Error('duplicate source identity in migration plan');
    return db.transaction(() => {
      const previous = db.prepare('SELECT counts_json FROM matrix_migration_runs WHERE idempotency_key = ?').get(key);
      if (previous) return JSON.parse(previous.counts_json);
      const startedAt = now();
      const run = db.prepare(`INSERT INTO matrix_migration_runs (idempotency_key, mode, source_fingerprint, counts_json, started_at, finished_at) VALUES (?, 'apply', ?, ?, ?, ?)`)
        .run(key, plan.sourceFingerprint, JSON.stringify({ ...ZERO_COUNTS, counts: ZERO_COUNTS, fingerprints: [] }), startedAt, startedAt);
      requireInsert(run, 'migration run');
      const runId = Number(run.lastInsertRowid);
      const counts = { ...ZERO_COUNTS };
      const fingerprints = [];
      for (const entry of plan.entries) {
        let customerId = entry.customerId;
        if (entry.resolution === 'imported') {
          const identity = entry.record.evidence || {};
          customerId = store.resolveCustomer({ candidateId: text(identity.candidateId || entry.sourceId), companyName: text(identity.companyName || entry.record.companyName), normalizedDomain: text(identity.verifiedDomain), actorUserId }).canonical_customer_id;
        }
        const countKey = entry.resolution === 'conflict' ? 'conflicts' : entry.resolution;
        counts[countKey] += 1;
        fingerprints.push(entry.fingerprint);
        if (entry.resolution === 'skipped') continue;
        requireInsert(db.prepare(`INSERT INTO matrix_migration_records (run_id, source_kind, source_id, source_fingerprint, resolution, canonical_customer_id, reason_code, provenance_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(runId, entry.sourceKind, entry.sourceId, entry.fingerprint, entry.resolution, customerId, entry.reasonCode, JSON.stringify(entry.provenance), now()), 'migration record');
        if (entry.resolution === 'unresolved' || entry.resolution === 'conflict') {
          requireInsert(db.prepare(`INSERT INTO matrix_unresolved_records (source_kind, source_id, source_fingerprint, reason_code, review_payload_json, state, resolved_customer_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`)
            .run(entry.sourceKind, entry.sourceId, entry.fingerprint, entry.reasonCode, JSON.stringify({ sourceKind: entry.sourceKind, sourceId: entry.sourceId, rules: entry.rules, provenance: entry.provenance }), now(), now()), 'unresolved record');
        }
      }
      const result = { ...counts, counts, fingerprints };
      const updated = db.prepare('UPDATE matrix_migration_runs SET counts_json = ?, finished_at = ? WHERE id = ?').run(JSON.stringify(result), now(), runId);
      if (!updated || updated.changes !== 1) throw new Error('migration run update conflict');
      return result;
    }).immediate();
  }
  return { scan, apply };
}

module.exports = { createMatrixLedgerMigration, MATCH_RULES };

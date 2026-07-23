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

function text(value) {
  return String(value == null ? '' : value).trim();
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stable(value[key]);
    return result;
  }, {});
  return value;
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function safeProvenance(input = {}) {
  const provenance = input.provenance && typeof input.provenance === 'object' ? input.provenance : {};
  return {
    sourcePath: text(provenance.sourcePath || input.sourcePath),
    bodyHash: text(provenance.bodyHash || input.bodyHash || input.contentHash),
    attachmentHashes: Array.isArray(provenance.attachmentHashes) ? provenance.attachmentHashes.map(text).filter(Boolean) : []
  };
}

function createMatrixLedgerMigration({ db, candidateDb, store, clock = () => new Date() } = {}) {
  if (!db || typeof db.prepare !== 'function') throw new Error('database required');
  if (!candidateDb || typeof candidateDb.prepare !== 'function') throw new Error('candidate database required');
  if (!store || typeof store.resolveCustomer !== 'function') throw new Error('ledger store required');

  function now() {
    const value = clock();
    const timestamp = value instanceof Date ? value.getTime() : Date.parse(String(value));
    if (!Number.isFinite(timestamp)) throw new Error('clock must return a valid date');
    return new Date(timestamp).toISOString();
  }

  function sourceFingerprint(record) {
    return hash({
      sourceKind: text(record.sourceKind),
      sourceId: text(record.sourceId),
      occurredAt: text(record.occurredAt),
      companyName: text(record.companyName),
      evidence: record.evidence || {},
      provenance: safeProvenance(record)
    });
  }

  function linkedCustomers(sourceKind, sourceId) {
    if (!text(sourceKind) || !text(sourceId)) return [];
    return db.prepare(`
      SELECT canonical_customer_id FROM matrix_customer_links
      WHERE source_kind = ? AND source_id = ?
    `).all(text(sourceKind), text(sourceId)).map(row => Number(row.canonical_customer_id));
  }

  function match(record) {
    const evidence = record.evidence || {};
    const hits = [];
    const add = (rule, ids) => ids.forEach(id => hits.push({ rule, id }));
    const explicit = evidence.explicitSourceId || {};
    add('explicit_source_id', linkedCustomers(explicit.kind, explicit.id));
    const officialEmail = text(evidence.officialEmail).toLowerCase();
    if (officialEmail) add('exact_official_email', db.prepare(`
      SELECT canonical_customer_id FROM matrix_contacts
      WHERE channel = 'email' AND address = ? AND status = 'active'
    `).all(officialEmail).map(row => Number(row.canonical_customer_id)));
    const domain = text(evidence.verifiedDomain).toLowerCase();
    const companyName = text(evidence.companyName || record.companyName);
    if (domain && companyName) add('verified_domain_and_company', db.prepare(`
      SELECT l.canonical_customer_id FROM matrix_customer_links l
      JOIN customers c ON c.id = l.canonical_customer_id
      WHERE l.normalized_domain = ? AND lower(c.name) = lower(?) AND c.active = 1
    `).all(domain, companyName).map(row => Number(row.canonical_customer_id)));
    const protectedId = text(evidence.protectedMappingId);
    const exactDraft = evidence.exactSubjectAndBodyHash || {};
    const draftSubject = text(exactDraft.subject);
    const draftBodyHash = text(exactDraft.bodyHash);
    if (draftSubject && draftBodyHash) {
      add('exact_subject_and_body_hash', linkedCustomers('protected_mapping', `draft:${draftSubject}:${draftBodyHash}`));
    }
    if (protectedId && Array.isArray(evidence.messageReferenceChain) && evidence.messageReferenceChain.length) {
      add('message_reference_chain', linkedCustomers('protected_mapping', protectedId));
    }
    if (text(evidence.protectedExplicitMapping)) add('protected_explicit_mapping', linkedCustomers('protected_mapping', evidence.protectedExplicitMapping));
    const ids = [...new Set(hits.map(hit => hit.id))];
    if (ids.length > 1) return { resolution: 'conflict', reasonCode: 'conflicting_deterministic_evidence', customerId: null, rules: hits.map(hit => hit.rule) };
    if (ids.length === 1) return { resolution: 'matched', reasonCode: hits.find(hit => hit.id === ids[0]).rule, customerId: ids[0], rules: hits.map(hit => hit.rule) };
    const candidateId = text(evidence.candidateId);
    if (candidateId && companyName) return { resolution: 'imported', reasonCode: 'new_candidate_identity', customerId: null, rules: [] };
    return { resolution: 'unresolved', reasonCode: 'insufficient_deterministic_evidence', customerId: null, rules: [] };
  }

  function scan(sources = {}) {
    const records = Array.isArray(sources) ? sources : sources.records;
    if (!Array.isArray(records)) throw new Error('sources.records required');
    const counts = { ...ZERO_COUNTS };
    const entries = records.map(record => {
      const sourceKind = text(record.sourceKind);
      const sourceId = text(record.sourceId);
      if (!sourceKind || !sourceId) throw new Error('source kind and source id required');
      const fingerprint = sourceFingerprint(record);
      const seen = db.prepare(`
        SELECT id FROM matrix_migration_records
        WHERE source_kind = ? AND source_id = ? AND source_fingerprint = ?
      `).get(sourceKind, sourceId, fingerprint);
      const resolution = seen ? { resolution: 'skipped', reasonCode: 'already_migrated', customerId: null, rules: [] } : match(record);
      counts[resolution.resolution === 'conflict' ? 'conflicts' : resolution.resolution] += 1;
      return { record, sourceKind, sourceId, fingerprint, provenance: safeProvenance(record), ...resolution };
    });
    return {
      ...counts,
      entries,
      counts,
      fingerprints: entries.map(entry => entry.fingerprint),
      sourceFingerprint: hash(entries.map(entry => entry.fingerprint))
    };
  }

  function apply(plan, { actorUserId, idempotencyKey } = {}) {
    if (!plan || !Array.isArray(plan.entries) || !plan.counts) throw new Error('migration plan required');
    const key = text(idempotencyKey);
    if (!key) throw new Error('idempotency key required');
    const previous = db.prepare('SELECT counts_json FROM matrix_migration_runs WHERE idempotency_key = ?').get(key);
    if (previous) return JSON.parse(previous.counts_json);
    const startedAt = now();
    const run = db.prepare(`
      INSERT INTO matrix_migration_runs (idempotency_key, mode, source_fingerprint, counts_json, started_at, finished_at)
      VALUES (?, 'apply', ?, ?, ?, ?)
    `).run(key, plan.sourceFingerprint, JSON.stringify({ counts: ZERO_COUNTS, fingerprints: [] }), startedAt, startedAt);
    const runId = Number(run.lastInsertRowid);
    const counts = { ...ZERO_COUNTS };
    const fingerprints = [];
    for (const entry of plan.entries) {
      let customerId = entry.customerId;
      if (entry.resolution === 'imported') {
        const identity = entry.record.evidence || {};
        customerId = store.resolveCustomer({
          candidateId: text(identity.candidateId || entry.sourceId),
          companyName: text(identity.companyName || entry.record.companyName),
          normalizedDomain: text(identity.verifiedDomain),
          actorUserId
        }).canonical_customer_id;
      }
      const resolution = entry.resolution;
      const countKey = resolution === 'conflict' ? 'conflicts' : resolution;
      counts[countKey] += 1;
      fingerprints.push(entry.fingerprint);
      db.prepare(`
        INSERT OR IGNORE INTO matrix_migration_records (
          run_id, source_kind, source_id, source_fingerprint, resolution, canonical_customer_id,
          reason_code, provenance_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(runId, entry.sourceKind, entry.sourceId, entry.fingerprint, resolution, customerId, entry.reasonCode, JSON.stringify(entry.provenance), now());
      if (resolution === 'unresolved' || resolution === 'conflict') {
        db.prepare(`
          INSERT OR IGNORE INTO matrix_unresolved_records (
            source_kind, source_id, source_fingerprint, reason_code, review_payload_json,
            state, resolved_customer_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, ?)
        `).run(entry.sourceKind, entry.sourceId, entry.fingerprint, entry.reasonCode, JSON.stringify({
          sourceKind: entry.sourceKind, sourceId: entry.sourceId, rules: entry.rules, provenance: entry.provenance
        }), now(), now());
      }
    }
    const result = { ...counts, counts, fingerprints };
    db.prepare('UPDATE matrix_migration_runs SET counts_json = ?, finished_at = ? WHERE id = ?').run(JSON.stringify(result), now(), runId);
    return result;
  }

  return { scan, apply };
}

module.exports = { createMatrixLedgerMigration, MATCH_RULES };

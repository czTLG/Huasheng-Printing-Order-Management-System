'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { saveDossier, getDossier, ensureResearchSchema } = require('../src/services/matrixResearchLedger');

const TOP_LEVEL_FIELDS = new Set(['candidate_id', 'checked_at', 'reviewer', 'sources', 'facts', 'content_gaps', 'unanswered_questions']);
const SOURCE_FIELDS = new Set(['role', 'source_url', 'source_type', 'page_title', 'checked_at', 'excerpt', 'fingerprint']);
const FACT_FIELDS = new Set(['field', 'value', 'confidence', 'source_url', 'public_copy']);
const GAP_FIELDS = new Set(['concern', 'outcome', 'note']);
const GAP_OUTCOMES = new Set(['existing_ready', 'public_gap', 'internal_note', 'blocked']);

function exactFields(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const unknown = Object.keys(value).find(key => !allowed.has(key));
  if (unknown) throw new Error(`unknown ${label} field: ${unknown}`);
  return value;
}

function cleanText(value, label, maximum = 2000) {
  const text = String(value || '').trim();
  if (!text || text.length > maximum || /\0/.test(text)) throw new Error(`${label} required`);
  return text;
}

function prospectPattern(name) {
  const words = String(name || '').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const meaningful = words.filter(word => word.length >= 3 && !['company', 'limited', 'ltd', 'joint', 'stock'].includes(word));
  return meaningful.length ? new RegExp(meaningful.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*'), 'iu') : null;
}

function validateDossierDocument(document, { candidateCompanyName = '' } = {}) {
  const input = exactFields(document, TOP_LEVEL_FIELDS, 'dossier');
  if (!Array.isArray(input.sources) || !input.sources.length) throw new Error('dossier sources required');
  if (!Array.isArray(input.facts)) throw new Error('dossier facts required');
  if (!Array.isArray(input.content_gaps)) throw new Error('dossier content_gaps required');
  if (!Array.isArray(input.unanswered_questions)) throw new Error('dossier unanswered_questions required');
  const sources = input.sources.map(source => ({ ...exactFields(source, SOURCE_FIELDS, 'source') }));
  const facts = input.facts.map(fact => ({ ...exactFields(fact, FACT_FIELDS, 'fact') }));
  const namePattern = prospectPattern(candidateCompanyName);
  for (const fact of facts) {
    if (fact.public_copy === true && namePattern?.test(String(fact.value || ''))) {
      throw new Error('prospect name is not allowed in public copy');
    }
  }
  const contentGaps = input.content_gaps.map(raw => {
    const gap = exactFields(raw, GAP_FIELDS, 'content gap');
    const outcome = cleanText(gap.outcome, 'content gap outcome', 40);
    if (!GAP_OUTCOMES.has(outcome)) throw new Error('invalid content gap outcome');
    return {
      concern: cleanText(gap.concern, 'content gap concern', 500),
      outcome,
      note: cleanText(gap.note, 'content gap note', 2000)
    };
  });
  const unansweredQuestions = input.unanswered_questions.map(question => cleanText(question, 'unanswered question', 1000));
  return { ...input, sources, facts, content_gaps: contentGaps, unanswered_questions: unansweredQuestions };
}

function importDossierDocument(db, document, options = {}) {
  const validated = validateDossierDocument(document, options);
  return saveDossier(db, validated);
}

function verifyCohort(db, candidateIds) {
  ensureResearchSchema(db);
  return candidateIds.map(value => {
    const candidateId = Number(value);
    if (!Number.isInteger(candidateId) || candidateId < 1) throw new Error('cohort candidate id must be a positive integer');
    const dossier = getDossier(db, candidateId);
    return dossier
      ? { candidate_id: candidateId, status: dossier.status, blockers: dossier.blockers }
      : { candidate_id: candidateId, status: 'missing', blockers: ['dossier_missing'] };
  });
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function main() {
  const dbPath = path.resolve(argument('--db') || process.env.DB_PATH || 'data/app.db');
  const db = new Database(dbPath);
  try {
    const cohort = argument('--verify-cohort');
    if (cohort) {
      console.log(JSON.stringify(verifyCohort(db, cohort.split(',').map(Number)), null, 2));
      return;
    }
    const inputPath = argument('--input');
    const candidateDbPath = path.resolve(argument('--candidate-db') || process.env.MATRIX_STREAM_DB_PATH || 'data/matrix-stream.db');
    if (!inputPath) throw new Error('--input required');
    const document = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
    const candidateDb = new Database(candidateDbPath, { readonly: true });
    let candidate;
    try { candidate = candidateDb.prepare('SELECT company_name FROM cache_records WHERE id = ?').get(document.candidate_id); }
    finally { candidateDb.close(); }
    if (!candidate) throw new Error('candidate not found');
    console.log(JSON.stringify(importDossierDocument(db, document, { candidateCompanyName: candidate.company_name }), null, 2));
  } finally {
    db.close();
  }
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { validateDossierDocument, importDossierDocument, verifyCohort };

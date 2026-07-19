#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sourceLines, applyAiTriageResult } = require('../src/services/matrixInboxAi');

function main() {
  const inputPath = path.resolve(process.argv[2] || '');
  if (!inputPath || !fs.existsSync(inputPath)) throw new Error('private input file required');
  const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const dictionary = payload.dictionary && typeof payload.dictionary === 'object' ? payload.dictionary : {};
  const { db, initDb } = require('../src/db');
  const originalLog = console.log;
  console.log = () => {};
  try { initDb(); } finally { console.log = originalLog; }
  const results = [];
  db.transaction(() => {
    for (const item of Array.isArray(payload.items) ? payload.items : []) {
      const emailId = Number(item.email_message_id);
      const row = db.prepare(`SELECT em.cleaned_text, em.text_body, j.id AS job_id FROM email_messages em JOIN matrix_inbox_jobs j ON j.email_message_id = em.id WHERE em.id = ?`).get(emailId);
      if (!row) throw new Error('email job not found');
      const lines = sourceLines(row.cleaned_text || row.text_body || '');
      const translations = lines.map(line => String(dictionary[line] || '').trim());
      if (translations.some(line => !line)) throw new Error('translation dictionary incomplete');
      const result = applyAiTriageResult(db, row.job_id, {
        message_class: item.message_class,
        subject_cn: item.subject_cn,
        line_translation_cn: translations,
        full_translation_cn: translations.join('\n'),
        summary_cn: item.summary_cn,
        extracted: item.extracted || {},
        missing_information: item.missing_information || [],
        quote_required: item.quote_required === true,
        quote_readiness: item.quote_readiness,
        suggested_next_action_cn: item.suggested_next_action_cn
      }, { release: false, source: 'human_verified', saveThread: false });
      results.push({ email_message_id: emailId, job_id: result.job_id, state: result.workflow_state });
    }
  })();
  process.stdout.write(`${JSON.stringify({ ok: true, applied: results.length, results })}\n`);
}

try { main(); }
catch (_) {
  process.stdout.write(`${JSON.stringify({ ok: false, code: 'MATRIX_LOCAL_ANALYSIS_FAILED' })}\n`);
  process.exitCode = 1;
}

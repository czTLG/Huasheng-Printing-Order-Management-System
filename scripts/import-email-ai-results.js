const { db, initDb, now, audit } = require('../src/db');

function text(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function safeJson(value) {
  try { return JSON.stringify(value); } catch (_) { return '{}'; }
}

function parseArgs(argv) {
  const args = { pending: false, limit: 10, id: 0 };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === '--pending') { args.pending = true; continue; }
    if (key === '--limit' && next) { args.limit = Number(next) || 10; i += 1; continue; }
    if (key === '--id' && next) { args.id = Number(next) || 0; i += 1; continue; }
  }
  return args;
}

function insertSuggestion(run, suggestionType, extracted, summary, confidence, matchedCustomerId = null, matchedInquiryId = null, rawInput = '') {
  const ts = now();
  const result = db.prepare(`
    INSERT INTO crm_import_suggestions (
      source_type, source_id, suggestion_type, status, confidence, matched_customer_id, matched_inquiry_id,
      extracted_json, suggested_updates_json, risk_flags, summary, raw_input, created_at, updated_at
    ) VALUES ('email_ai_analysis', ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    run.id,
    suggestionType,
    text(confidence || 'low'),
    matchedCustomerId,
    matchedInquiryId,
    safeJson(extracted),
    safeJson(extracted),
    safeJson(extracted?.risk_flags || []),
    text(summary),
    text(rawInput).slice(0, 4000),
    ts,
    ts
  );
  audit({
    role: 'system',
    userName: 'system',
    action: 'crm_import_suggestion_created_from_ai_analysis',
    resourceType: 'crm_import_suggestion',
    resourceId: result.lastInsertRowid,
    detail: JSON.stringify({
      run_id: run.id,
      run_code: run.run_code,
      suggestion_type: suggestionType
    })
  });
  return Number(result.lastInsertRowid);
}

function main() {
  initDb();
  const args = parseArgs(process.argv);
  let runs = [];
  if (args.id > 0) {
    const row = db.prepare(`SELECT * FROM email_ai_analysis_runs WHERE id = ?`).get(args.id);
    if (row) runs = [row];
  } else if (args.pending) {
    runs = db.prepare(`
      SELECT * FROM email_ai_analysis_runs
      WHERE status = 'completed'
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `).all(args.limit);
  }

  const imported = [];
  for (const run of runs) {
    const payload = JSON.parse(run.result_json || '{}');
    const createdIds = [];
    if (payload.customer_profile && Object.values(payload.customer_profile).some((value) => value !== null && value !== '' && value !== 'low')) {
      createdIds.push(insertSuggestion(run, 'customer_profile', payload.customer_profile, `AI 邮件解读客户档案：${text(payload.customer_profile.company_name || payload.customer_profile.contact_person || run.scope_key)}`, payload.customer_profile.confidence || 'low', null, null, run.input_summary));
    }
    if (Array.isArray(payload.communications)) {
      payload.communications.forEach((item, index) => {
        createdIds.push(insertSuggestion(run, 'communication_log', item, `AI 邮件解读沟通记录 ${index + 1}：${text(item.summary || run.scope_key)}`, 'medium', null, null, run.input_summary));
      });
    }
    if (Array.isArray(payload.inquiries)) {
      payload.inquiries.forEach((item, index) => {
        createdIds.push(insertSuggestion(run, 'inquiry', item, `AI 邮件解读询盘 ${index + 1}：${text(item.inquiry_title || run.scope_key)}`, item.confidence || 'low', null, null, run.input_summary));
      });
    }
    if (Array.isArray(payload.specifications)) {
      payload.specifications.forEach((item, index) => {
        createdIds.push(insertSuggestion(run, 'specification', item, `AI 邮件解读规格 ${index + 1}：${text(item.material_structure_text || item.bag_type || run.scope_key)}`, item.confidence || 'low', null, null, run.input_summary));
      });
    }
    if (Array.isArray(payload.quotation_drafts)) {
      payload.quotation_drafts.forEach((item, index) => {
        createdIds.push(insertSuggestion(run, 'quotation_draft', item, `AI 邮件解读报价线索 ${index + 1}：${text(item.trade_term || item.unit_price || run.scope_key)}`, item.confidence || 'low', null, null, run.input_summary));
      });
    }
    db.prepare(`UPDATE email_ai_analysis_runs SET status = 'imported', updated_at = ?, finished_at = COALESCE(finished_at, ?) WHERE id = ?`).run(now(), now(), run.id);
    audit({
      role: 'system',
      userName: 'system',
      action: 'import_email_ai_analysis_result',
      resourceType: 'email_ai_analysis_run',
      resourceId: run.id,
      detail: JSON.stringify({
        run_id: run.id,
        run_code: run.run_code,
        created_suggestion_ids: createdIds
      })
    });
    imported.push({ id: run.id, run_code: run.run_code, created_suggestion_ids: createdIds });
  }

  console.log(JSON.stringify({ ok: true, imported_runs: imported }, null, 2));
}

main();

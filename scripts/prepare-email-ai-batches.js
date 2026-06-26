const fs = require('fs');
const path = require('path');
const { db, initDb, now } = require('../src/db');
const { analyzeEmailScreening, cleanBody } = require('../src/lib/emailCrmParser');

function text(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function parseArgs(argv) {
  const args = { limit: 10, highValueOnly: false, contact: '', conversationKey: '' };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === '--limit' && next) { args.limit = Number(next) || 10; i += 1; continue; }
    if (key === '--contact' && next) { args.contact = text(next).toLowerCase(); i += 1; continue; }
    if (key === '--conversation-key' && next) { args.conversationKey = text(next); i += 1; continue; }
    if (key === '--high-value-only') { args.highValueOnly = true; }
  }
  return args;
}

function makeRunCode(id) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 12);
  return `EAR-${stamp}-${String(id).padStart(4, '0')}`;
}

function safeJson(value) {
  try { return JSON.stringify(value); } catch (_) { return '[]'; }
}

function groupRows(rows, args) {
  const groups = new Map();
  for (const row of rows) {
    const screening = analyzeEmailScreening(row);
    if (screening.noise_level === 'high' || screening.business_relevance === 'irrelevant') continue;
    if (args.highValueOnly && !(screening.business_relevance === 'high' || screening.detected_signals.has_quote || screening.detected_signals.has_inquiry)) continue;
    const scopeType = args.contact ? 'contact_email' : args.conversationKey ? 'conversation' : (row.conversation_key ? 'conversation' : 'contact_email');
    const scopeKey = args.contact || args.conversationKey || text(row.conversation_key || row.contact_email || row.from_email || `email-${row.id}`);
    const current = groups.get(scopeKey) || { scopeType, scopeKey, rows: [], score: 0 };
    current.rows.push({ ...row, screening });
    current.score += screening.business_relevance === 'high' ? 3 : screening.business_relevance === 'medium' ? 2 : 1;
    if (screening.detected_signals.has_quote) current.score += 2;
    if (screening.detected_signals.has_inquiry) current.score += 2;
    groups.set(scopeKey, current);
  }
  return [...groups.values()].sort((a, b) => b.score - a.score).slice(0, args.limit);
}

function promptForGroup(group) {
  const emails = group.rows
    .sort((a, b) => String(a.received_at || a.created_at).localeCompare(String(b.received_at || b.created_at)))
    .map((row) => {
      const screening = row.screening || analyzeEmailScreening(row);
      return `## Email ${row.id}
Date: ${text(row.received_at || row.sent_at || row.created_at)}
Direction: ${text(row.direction)}
From: ${text(row.from_name || row.from_email)}
To: ${text(row.to_emails)}
Subject: ${text(row.subject || '(no subject)')}
Conversation Key: ${text(row.conversation_key)}
Noise Level: ${screening.noise_level}
Business Relevance: ${screening.business_relevance}
Detected Signals: ${safeJson(screening.detected_signals)}
Parser Hints: ${safeJson(screening.hints)}

Cleaned Text:
${cleanBody(row)}
`;
    }).join('\n');

  return `# CRM Email Thread Analysis Task

You are reading a foreign trade email thread for CRM extraction.

## Safety boundaries

- Do not treat the rule parser as final truth.
- Do not treat a contact person name as company_name without evidence.
- Personal email addresses must not be used to infer company_name by themselves.
- company_name must come from email body, signature, website/domain evidence, legal suffixes, or repeated context.
- Do not invent missing fields.
- Use null when uncertain.
- quotation_drafts are only pending hints, not formal quotations.
- Do not create formal quotations.
- Evidence must refer to email ids from this prompt.
- Output JSON only.

## Scope

scope_type: ${group.scopeType}
scope_key: ${group.scopeKey}

## Output JSON schema

{
  "customer_profile": {
    "company_name": null,
    "contact_person": null,
    "email": null,
    "whatsapp": null,
    "phone": null,
    "country": null,
    "city": null,
    "website": null,
    "customer_summary": null,
    "next_action": null,
    "confidence": "low",
    "evidence": []
  },
  "communications": [
    {
      "summary": "",
      "direction": "",
      "email_id": null,
      "date": "",
      "key_points": []
    }
  ],
  "inquiries": [
    {
      "inquiry_title": "",
      "product_type": "",
      "packaging_type": "",
      "quantity": "",
      "destination_country": "",
      "destination_port": "",
      "trade_term_requested": "",
      "customer_questions": [],
      "missing_info": [],
      "next_action": "",
      "confidence": "low",
      "evidence": []
    }
  ],
  "specifications": [
    {
      "bag_type": "",
      "film_type": "",
      "size": "",
      "material_structure_text": "",
      "layers": [],
      "thickness_total": "",
      "printing_colors": "",
      "surface_finish": "",
      "special_features": [],
      "notes": "",
      "confidence": "low",
      "evidence": []
    }
  ],
  "quotation_drafts": [
    {
      "quoted_by_us": null,
      "quote_currency": "",
      "quote_unit": "",
      "trade_term": "",
      "unit_price": "",
      "total_amount": "",
      "quantity": "",
      "tooling_fee": "",
      "freight_cost": "",
      "clearance_cost": "",
      "payment_terms": "",
      "lead_time": "",
      "validity_date": "",
      "remarks": "",
      "confidence": "low",
      "evidence": []
    }
  ],
  "risk_flags": [],
  "recommended_apply_order": [
    "customer_profile",
    "communication_log",
    "inquiry",
    "specification",
    "quotation_draft"
  ]
}

## Email thread context

${emails}
`;
}

function main() {
  initDb();
  const args = parseArgs(process.argv);
  const promptDir = path.join(__dirname, '..', 'data', 'email-ai-prompts');
  fs.mkdirSync(promptDir, { recursive: true });

  let where = `WHERE 1=1`;
  const params = [];
  if (args.contact) {
    where += ` AND (LOWER(COALESCE(contact_email,'')) = ? OR LOWER(COALESCE(from_email,'')) = ? OR LOWER(COALESCE(to_emails,'')) LIKE ?)`;
    params.push(args.contact, args.contact, `%${args.contact}%`);
  }
  if (args.conversationKey) {
    where += ` AND COALESCE(conversation_key,'') = ?`;
    params.push(args.conversationKey);
  }
  const rows = db.prepare(`
    SELECT *
    FROM email_messages
    ${where}
    ORDER BY COALESCE(received_at, created_at) DESC, id DESC
    LIMIT 500
  `).all(...params);

  const groups = groupRows(rows, args);
  const created = [];
  for (const group of groups) {
    const ts = now();
    const insert = db.prepare(`
      INSERT INTO email_ai_analysis_runs (
        run_code, scope_type, scope_key, status, model_provider, input_email_ids_json,
        input_summary, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, 'pending', 'codex_cli', ?, ?, ?, ?, ?)
    `).run(null, group.scopeType, group.scopeKey, safeJson(group.rows.map((row) => row.id)), `${group.rows.length} emails grouped by ${group.scopeKey}`, 'system', ts, ts);
    const runId = Number(insert.lastInsertRowid);
    const runCode = makeRunCode(runId);
    const promptPath = path.join(promptDir, `${runCode}.md`);
    fs.writeFileSync(promptPath, promptForGroup(group), 'utf8');
    db.prepare(`
      UPDATE email_ai_analysis_runs
      SET run_code = ?, status = 'prompt_ready', prompt_path = ?, input_summary = ?, updated_at = ?
      WHERE id = ?
    `).run(runCode, promptPath, `${group.rows.length} emails grouped by ${group.scopeKey}`, now(), runId);
    created.push({
      id: runId,
      run_code: runCode,
      scope_type: group.scopeType,
      scope_key: group.scopeKey,
      prompt_path: promptPath,
      input_email_ids: group.rows.map((row) => row.id),
      manual_command: `codex exec --input ${promptPath} > data/email-ai-outputs/${runCode}.json`
    });
  }

  console.log(JSON.stringify({ ok: true, total_source_rows: rows.length, prepared_runs: created.length, runs: created }, null, 2));
}

main();

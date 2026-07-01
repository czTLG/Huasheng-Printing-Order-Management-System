const express = require('express');
const { db, now, audit } = require('../db');
const { allowRoles } = require('../middleware/auth');
const { validateImapConfig, syncMailbox } = require('../lib/imapSync');
const { createSuggestionsFromEmail } = require('../lib/emailCrmParser');
const { evaluateQuoteReadiness, normalizeCrmStage } = require('../lib/quoteReadiness');

const router = express.Router();
const CRM_ROLES = ['super_admin', 'foreign_trade_crm_admin'];
const COSTING_ROLES = ['super_admin', 'foreign_trade_crm_admin', 'costing_user'];
const FREIGHT_ROLES = ['super_admin', 'foreign_trade_crm_admin', 'freight_user'];

function roleAllowed(req, roles) {
  return !!req.user && roles.includes(req.user.role);
}

router.use((req, res, next) => {
  const isCostingReadOrUpdate = req.path.startsWith('/costing-requests') || /\/costing-prefill$/.test(req.path);
  const isCreateCostingRequest = req.method === 'POST' && /^\/inquiries\/\d+\/costing-requests$/.test(req.path);
  const isFreightAccess = req.path.startsWith('/freight-quotes') || /^\/inquiries\/\d+\/freight-quotes$/.test(req.path);
  const isCreateFreightQuote = req.method === 'POST' && /^\/inquiries\/\d+\/freight-quotes$/.test(req.path);
  const roles = isCostingReadOrUpdate && !isCreateCostingRequest
    ? COSTING_ROLES
    : (isFreightAccess && !isCreateFreightQuote ? FREIGHT_ROLES : CRM_ROLES);
  if (!roleAllowed(req, roles)) {
    return res.status(403).json({ error: '无权限访问该功能', yourRole: req.user?.role || null, need: roles });
  }
  next();
});

function idParam(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

function text(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function intFlag(value) {
  return value === true || value === 1 || value === '1' ? 1 : 0;
}

function jsonDetail(value) {
  try {
    return JSON.stringify(value);
  } catch (_) {
    return '{}';
  }
}

function handleError(res, err, fallback = 'CRM 操作失败') {
  console.warn('[crm]', err?.message || err);
  return res.status(400).json({ ok: false, error: fallback });
}

function parseJsonObject(value, fallback = {}) {
  if (!text(value)) return fallback;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function tableExists(name) {
  return !!db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name);
}

function crmAudit(req, action, resourceType, resourceId, detail = {}) {
  audit({
    role: req.user.role,
    userName: req.user.userName,
    action,
    resourceType,
    resourceId,
    detail: typeof detail === 'string' ? detail : jsonDetail(detail)
  });
}

function customerDisplaySelect(prefix = 'c') {
  return `
    ${prefix}.*,
    COALESCE(NULLIF(${prefix}.company_name, ''), NULLIF(${prefix}.name, ''), NULLIF(${prefix}.contact_person, ''), '未命名客户') AS display_name
  `;
}

function getCustomer(id) {
  return db.prepare(`SELECT ${customerDisplaySelect('c')} FROM customers c WHERE c.id = ?`).get(id);
}

function changesFrom(oldRow, body, fields) {
  return fields
    .filter((field) => Object.prototype.hasOwnProperty.call(body, field))
    .map((field) => ({
      field,
      oldValue: oldRow ? oldRow[field] ?? '' : '',
      newValue: body[field] ?? ''
    }))
    .filter((item) => String(item.oldValue ?? '') !== String(item.newValue ?? ''));
}

function updateByFields(table, id, body, fields) {
  const present = fields.filter((field) => Object.prototype.hasOwnProperty.call(body, field));
  if (!present.length) return { changed: false };
  const sets = present.map((field) => `${field} = ?`);
  const values = present.map((field) => body[field] === undefined ? null : body[field]);
  sets.push('updated_at = ?');
  values.push(now(), id);
  db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return { changed: true };
}

const CUSTOMER_FIELDS = [
  'customer_code', 'company_name', 'country', 'city', 'contact_person', 'email', 'whatsapp',
  'source_channel', 'priority', 'stage', 'owner_id', 'ai_summary', 'risk_notes', 'next_action',
  'next_followup_at', 'next_followup_purpose', 'next_followup_channel', 'followup_priority',
  'last_contact_at', 'last_reply_at', 'last_outbound_email_at', 'unreplied_since_at',
  'is_waiting_reply', 'is_invalid', 'invalid_reason',
  'contact', 'phone', 'default_bag_type', 'default_spec',
  'default_use_case', 'default_roller', 'notes', 'website', 'customer_type', 'industry',
  'main_product', 'business_background', 'company_size_note', 'buyer_authenticity_note',
  'source_notes', 'customer_summary', 'priority_reason'
];

function getLatestResearchNote(customerId) {
  return db.prepare(`
    SELECT *
    FROM customer_research_notes
    WHERE customer_id = ? AND status != 'archived'
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `).get(customerId) || null;
}

function getCustomerOverview(customerId) {
  const latestCosting = db.prepare(`
    SELECT id, costing_request_code, status, urgency, updated_at
    FROM costing_requests
    WHERE customer_id = ?
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `).get(customerId) || null;
  const latestFreight = db.prepare(`
    SELECT id, freight_quote_code, status, is_current, updated_at
    FROM freight_quotes
    WHERE customer_id = ?
    ORDER BY is_current DESC, updated_at DESC, id DESC
    LIMIT 1
  `).get(customerId) || null;
  const summary = db.prepare(`
    SELECT
      SUM(CASE WHEN status IN ('pending', 'in_progress', 'revision_needed') THEN 1 ELSE 0 END) AS pending_costing_count,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_costing_count
    FROM costing_requests
    WHERE customer_id = ?
  `).get(customerId) || {};
  const freightCount = db.prepare(`
    SELECT COUNT(*) AS total_count
    FROM freight_quotes
    WHERE customer_id = ?
  `).get(customerId) || {};
  const selectedFreight = db.prepare(`
    SELECT id, freight_quote_code, total_freight_cost, valid_until, status
    FROM freight_quotes
    WHERE customer_id = ? AND is_current = 1
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `).get(customerId) || null;
  const pendingImportSuggestions = db.prepare(`
    SELECT COUNT(*) AS total_count
    FROM crm_import_suggestions cis
    INNER JOIN email_messages em ON em.id = cis.source_id AND cis.source_type = 'email'
    WHERE em.matched_customer_id = ? AND cis.status IN ('pending', 'needs_review')
  `).get(customerId) || {};
  return {
    latestCosting,
    latestFreight,
    selectedFreight,
    pending_costing_count: Number(summary.pending_costing_count || 0),
    completed_costing_count: Number(summary.completed_costing_count || 0),
    freight_quote_count: Number(freightCount.total_count || 0),
    pending_import_suggestion_count: Number(pendingImportSuggestions.total_count || 0),
  };
}

function getCustomerImportSuggestions(customerId) {
  return db.prepare(`
    SELECT
      cis.*,
      em.subject AS source_email_subject,
      em.received_at AS source_email_received_at,
      em.conversation_key AS source_email_conversation_key
    FROM crm_import_suggestions cis
    LEFT JOIN email_messages em ON em.id = cis.source_id AND cis.source_type = 'email'
    WHERE cis.matched_customer_id = ?
    ORDER BY cis.updated_at DESC, cis.id DESC
    LIMIT 100
  `).all(customerId);
}

function getCustomerEmailConversations(customerId) {
  return db.prepare(`
    SELECT
      COALESCE(conversation_key, '') AS conversation_key,
      COUNT(*) AS message_count,
      MAX(COALESCE(received_at, created_at)) AS latest_at,
      MAX(subject) AS latest_subject,
      MAX(direction) AS latest_direction,
      MAX(from_email) AS latest_from_email,
      MAX(from_name) AS latest_from_name,
      MAX(SUBSTR(COALESCE(cleaned_text, text_body, ''), 1, 240)) AS latest_preview
    FROM email_messages
    WHERE matched_customer_id = ?
    GROUP BY COALESCE(conversation_key, '')
    ORDER BY latest_at DESC, message_count DESC
    LIMIT 50
  `).all(customerId);
}

function priorityRank(priority) {
  return { A: 1, B: 2, C: 3, D: 4 }[text(priority || 'D').toUpperCase()] || 4;
}

function compactCustomerName(row) {
  return text(row.customer_display_name || row.display_name || row.company_name || row.name || row.contact_person) || '未命名客户';
}

function safeParsedJson(value) {
  const parsed = parseJsonObject(value, {});
  return parsed && typeof parsed === 'object' ? parsed : {};
}

const QUOTE_AI_SPEC_FIELDS = [
  'size',
  'size_width',
  'size_height',
  'gusset_size',
  'material_structure_text',
  'thickness_total',
  'printing_colors',
  'surface_finish',
  'zipper_required',
  'spout_required',
  'valve_required',
  'tear_notch_required',
  'window_required',
  'artwork_status',
  'shelf_life_requirement',
  'high_barrier_required',
  'retort_required',
  'frozen_required',
  'filling_weight',
  'roll_width',
  'repeat_length',
  'quantity',
  'core_id',
  'max_roll_diameter',
  'max_roll_weight',
  'packing_machine_type',
  'machine_direction',
  'eye_mark_required',
  'heat_seal_requirement',
  'barrier_requirement',
  'cof_requirement',
  'sample_image_status',
  'WVTR',
  'OTR',
  'residual_solvent',
  'grammage'
];

function candidateValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => candidateValue(item)).filter(Boolean).join(' · ');
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }
  const textValue = text(value);
  return textValue || '';
}

function pickCandidateFields(source = {}) {
  const picked = {};
  QUOTE_AI_SPEC_FIELDS.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(source, field)) return;
    const value = source[field];
    const normalized = candidateValue(value);
    if (normalized) picked[field] = value;
  });
  return picked;
}

function formatEvidenceSummary(row) {
  return text(
    row.source_email_subject
    || row.source_email_received_at
    || row.source_ai_run_code
    || row.summary
    || row.source_type
  );
}

function getPendingSpecificationSuggestionsForInquiry(inquiry) {
  if (!inquiry) return [];
  const customerId = Number(inquiry.customer_id || 0) || 0;
  const inquiryId = Number(inquiry.id || 0) || 0;
  if (!customerId && !inquiryId) return [];
  return db.prepare(`
    SELECT
      cis.*,
      em.subject AS source_email_subject,
      em.received_at AS source_email_received_at,
      ar.run_code AS source_ai_run_code
    FROM crm_import_suggestions cis
    LEFT JOIN email_messages em ON em.id = cis.source_id AND cis.source_type = 'email'
    LEFT JOIN email_ai_analysis_runs ar ON ar.id = cis.source_id AND cis.source_type = 'email_ai_analysis'
    WHERE cis.status = 'pending'
      AND cis.suggestion_type = 'specification'
      AND (
        cis.matched_inquiry_id = ?
        OR cis.matched_customer_id = ?
        OR (cis.source_type = 'email' AND em.matched_customer_id = ?)
      )
    ORDER BY cis.updated_at DESC, cis.id DESC
    LIMIT 40
  `).all(inquiryId, customerId, customerId);
}

function buildQuoteReadinessHints(inquiry, readiness) {
  const suggestions = getPendingSpecificationSuggestionsForInquiry(inquiry);
  const fieldCandidateMap = {};
  const pendingAiCandidates = suggestions.map((row) => {
    const extracted = safeParsedJson(row.suggested_updates_json || row.extracted_json || '{}');
    const candidateFields = pickCandidateFields(extracted);
    const normalizedCandidateFields = {};
    Object.entries(candidateFields).forEach(([field, value]) => {
      const normalizedValue = candidateValue(value);
      if (!normalizedValue) return;
      normalizedCandidateFields[field] = value;
      if (!fieldCandidateMap[field]) fieldCandidateMap[field] = [];
      fieldCandidateMap[field].push({
        suggestion_id: Number(row.id),
        value,
        confidence: text(row.confidence || extracted.confidence || 'low') || 'low',
        source_type: row.source_type,
        source_id: Number(row.source_id || 0) || null,
        email_ai_analysis_run_id: row.source_type === 'email_ai_analysis' ? Number(row.source_id || 0) || null : null,
        matched_customer_id: row.matched_customer_id ? Number(row.matched_customer_id) : null,
        matched_inquiry_id: row.matched_inquiry_id ? Number(row.matched_inquiry_id) : null,
        created_at: row.created_at || null,
        evidence_summary: formatEvidenceSummary(row)
      });
    });
    return {
      suggestion_id: Number(row.id),
      suggestion_type: row.suggestion_type,
      confidence: text(row.confidence || extracted.confidence || 'low') || 'low',
      summary: text(row.summary || extracted.summary || ''),
      source_type: row.source_type,
      source_id: Number(row.source_id || 0) || null,
      email_ai_analysis_run_id: row.source_type === 'email_ai_analysis' ? Number(row.source_id || 0) || null : null,
      matched_customer_id: row.matched_customer_id ? Number(row.matched_customer_id) : null,
      matched_inquiry_id: row.matched_inquiry_id ? Number(row.matched_inquiry_id) : null,
      candidate_fields: normalizedCandidateFields,
      evidence_summary: formatEvidenceSummary(row),
      created_at: row.created_at || null
    };
  });

  const missingRequired = Array.isArray(readiness?.missing_required_fields) ? readiness.missing_required_fields : [];
  const suggestedApplyActions = [];
  const seen = new Set();
  pendingAiCandidates.forEach((candidate) => {
    const candidateFieldNames = Object.keys(candidate.candidate_fields || {});
    const matchedMissingFields = missingRequired.filter((field) => candidateFieldNames.includes(field));
    if (!matchedMissingFields.length) return;
    if (seen.has(candidate.suggestion_id)) return;
    seen.add(candidate.suggestion_id);
    suggestedApplyActions.push({
      action_type: 'review_specification_suggestion',
      suggestion_id: candidate.suggestion_id,
      label: `Review pending AI specification for ${matchedMissingFields.join(' / ')}`
    });
  });

  return {
    has_pending_specification_suggestion: pendingAiCandidates.length > 0,
    pending_ai_candidates: pendingAiCandidates,
    field_candidate_map: fieldCandidateMap,
    suggested_apply_actions: suggestedApplyActions
  };
}

function getCurrentSpecificationForInquiry(inquiry) {
  if (!inquiry) return null;
  const latestSpecId = Number(inquiry.latest_specification_id || 0);
  if (latestSpecId) {
    const current = getSpecification(latestSpecId);
    if (current) return current;
  }
  const row = db.prepare(`
    SELECT id
    FROM inquiry_specifications
    WHERE inquiry_id = ?
    ORDER BY is_current DESC, version_no DESC, id DESC
    LIMIT 1
  `).get(Number(inquiry.id || 0));
  return row ? getSpecification(Number(row.id)) : null;
}

function persistQuoteReadiness(inquiryId, readiness) {
  if (!inquiryId || !readiness) return;
  db.prepare(`
    UPDATE inquiries
    SET quote_readiness_status = ?, quote_readiness_score = ?, quote_readiness_color = ?,
        quote_missing_fields_json = ?, quote_readiness_warnings_json = ?, quote_next_action = ?,
        quote_readiness_updated_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    readiness.status || 'blocked',
    Number(readiness.score || 0),
    readiness.color || 'red',
    JSON.stringify(readiness.missing_required_fields || []),
    JSON.stringify(readiness.warnings || []),
    readiness.next_action || '',
    now(),
    now(),
    inquiryId
  );
}

function recalculateQuoteReadiness(inquiryOrId, specification = null) {
  const inquiry = typeof inquiryOrId === 'object' ? inquiryOrId : getInquiry(Number(inquiryOrId || 0));
  if (!inquiry) return null;
  const currentSpecification = specification || getCurrentSpecificationForInquiry(inquiry);
  const readiness = evaluateQuoteReadiness(inquiry, currentSpecification || {});
  persistQuoteReadiness(Number(inquiry.id || inquiryOrId), readiness);
  return { inquiry, specification: currentSpecification, readiness, hints: buildQuoteReadinessHints(inquiry, readiness) };
}

function withQuoteReadiness(inquiry) {
  if (!inquiry) return inquiry;
  const currentSpecification = getCurrentSpecificationForInquiry(inquiry);
  const readiness = evaluateQuoteReadiness(inquiry, currentSpecification || {});
  const hints = buildQuoteReadinessHints(inquiry, readiness);
  return {
    ...inquiry,
    quote_readiness: readiness,
    quote_readiness_status: readiness.status,
    quote_readiness_score: readiness.score,
    quote_readiness_color: readiness.color,
    quote_missing_fields_json: JSON.stringify(readiness.missing_required_fields || []),
    quote_readiness_warnings_json: JSON.stringify(readiness.warnings || []),
    quote_next_action: readiness.next_action,
    pending_ai_candidates: hints.pending_ai_candidates,
    field_candidate_map: hints.field_candidate_map,
    has_pending_specification_suggestion: hints.has_pending_specification_suggestion,
    suggested_apply_actions: hints.suggested_apply_actions,
  };
}

router.get('/dashboard', (req, res) => {
  try {
    const today = now().slice(0, 10);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const countOne = (sql, params = []) => {
      const row = db.prepare(sql).get(...params) || {};
      return Number(row.total || 0);
    };

    const suggestionCounts = db.prepare(`
      SELECT suggestion_type, COUNT(*) AS total
      FROM crm_import_suggestions
      WHERE status IN ('pending', 'needs_review')
      GROUP BY suggestion_type
    `).all().reduce((acc, row) => {
      acc[row.suggestion_type || 'unknown'] = Number(row.total || 0);
      return acc;
    }, {});

    const summary = {
      total_customers: countOne(`SELECT COUNT(*) AS total FROM customers WHERE COALESCE(active, 1) = 1`),
      new_customers_7d: countOne(`SELECT COUNT(*) AS total FROM customers WHERE COALESCE(active, 1) = 1 AND COALESCE(created_at, '') >= ?`, [sevenDaysAgo]),
      priority_a_customers: countOne(`SELECT COUNT(*) AS total FROM customers WHERE COALESCE(active, 1) = 1 AND priority = 'A'`),
      pending_import_suggestions: countOne(`SELECT COUNT(*) AS total FROM crm_import_suggestions WHERE status IN ('pending', 'needs_review')`),
      pending_customer_profile_suggestions: suggestionCounts.customer_profile || 0,
      pending_inquiry_suggestions: suggestionCounts.inquiry || 0,
      pending_specification_suggestions: suggestionCounts.specification || 0,
      pending_quotation_drafts: suggestionCounts.quotation_draft || 0,
      pending_costing_requests: countOne(`SELECT COUNT(*) AS total FROM costing_requests WHERE status IN ('pending', 'in_progress', 'revision_needed')`),
      pending_freight_quotes: countOne(`SELECT COUNT(*) AS total FROM freight_quotes WHERE status IN ('draft', 'requested', 'received')`),
      overdue_followups: countOne(`
        SELECT COUNT(*) AS total
        FROM customers
        WHERE COALESCE(active, 1) = 1
          AND COALESCE(is_invalid, 0) = 0
          AND COALESCE(next_followup_at, '') != ''
          AND SUBSTR(next_followup_at, 1, 10) <= ?
      `, [today]),
      waiting_reply_customers: countOne(`
        SELECT COUNT(DISTINCT c.id) AS total
        FROM customers c
        WHERE COALESCE(c.active, 1) = 1
          AND COALESCE(c.is_invalid, 0) = 0
          AND (
            COALESCE(c.is_waiting_reply, 0) = 1
            OR EXISTS (
              SELECT 1
              FROM email_messages outm
              WHERE outm.matched_customer_id = c.id
                AND outm.direction = 'outbound'
                AND NOT EXISTS (
                  SELECT 1
                  FROM email_messages inm
                  WHERE inm.matched_customer_id = c.id
                    AND inm.direction = 'inbound'
                    AND COALESCE(inm.received_at, inm.created_at, '') > COALESCE(outm.received_at, outm.created_at, '')
                )
            )
          )
      `),
      recent_email_count_7d: countOne(`SELECT COUNT(*) AS total FROM email_messages WHERE COALESCE(received_at, created_at, '') >= ?`, [sevenDaysAgo])
    };

    const pendingSuggestions = db.prepare(`
      SELECT
        cis.id, cis.suggestion_type, cis.status, cis.confidence, cis.summary, cis.risk_flags,
        cis.matched_customer_id, cis.matched_inquiry_id, cis.created_at, cis.updated_at,
        cis.extracted_json, cis.suggested_updates_json,
        em.subject AS source_email_subject,
        em.from_email AS source_email_from,
        em.direction AS source_email_direction,
        em.received_at AS source_email_received_at,
        ${customerDisplaySelect('c').replace('c.*,\n', '')},
        i.inquiry_title
      FROM crm_import_suggestions cis
      LEFT JOIN email_messages em ON em.id = cis.source_id AND cis.source_type = 'email'
      LEFT JOIN customers c ON c.id = COALESCE(cis.matched_customer_id, em.matched_customer_id)
      LEFT JOIN inquiries i ON i.id = cis.matched_inquiry_id
      WHERE cis.status IN ('pending', 'needs_review')
      ORDER BY
        CASE cis.suggestion_type
          WHEN 'customer_profile' THEN 1
          WHEN 'inquiry' THEN 2
          WHEN 'specification' THEN 3
          WHEN 'quotation_draft' THEN 4
          ELSE 5
        END,
        COALESCE(cis.updated_at, cis.created_at) DESC,
        cis.id DESC
      LIMIT 30
    `).all().map((row) => ({
      id: row.id,
      suggestion_type: row.suggestion_type,
      status: row.status,
      confidence: row.confidence,
      summary: row.summary,
      risk_flags: row.risk_flags,
      matched_customer_id: row.matched_customer_id,
      matched_inquiry_id: row.matched_inquiry_id,
      customer_display_name: compactCustomerName(row),
      inquiry_title: row.inquiry_title,
      source_email_subject: row.source_email_subject,
      source_email_from: row.source_email_from,
      source_email_direction: row.source_email_direction,
      source_email_received_at: row.source_email_received_at,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));

    const quotationDrafts = db.prepare(`
      SELECT
        cis.id, cis.confidence, cis.summary, cis.risk_flags, cis.matched_customer_id,
        cis.matched_inquiry_id, cis.extracted_json, cis.suggested_updates_json,
        cis.created_at, cis.updated_at,
        em.subject AS source_email_subject,
        em.direction AS source_email_direction,
        em.received_at AS source_email_received_at,
        ${customerDisplaySelect('c').replace('c.*,\n', '')},
        i.inquiry_title
      FROM crm_import_suggestions cis
      LEFT JOIN email_messages em ON em.id = cis.source_id AND cis.source_type = 'email'
      LEFT JOIN customers c ON c.id = COALESCE(cis.matched_customer_id, em.matched_customer_id)
      LEFT JOIN inquiries i ON i.id = cis.matched_inquiry_id
      WHERE cis.status IN ('pending', 'needs_review') AND cis.suggestion_type = 'quotation_draft'
      ORDER BY COALESCE(cis.updated_at, cis.created_at) DESC, cis.id DESC
      LIMIT 20
    `).all().map((row) => {
      const extracted = safeParsedJson(row.suggested_updates_json || row.extracted_json);
      return {
        id: row.id,
        confidence: row.confidence || extracted.confidence || '',
        summary: row.summary,
        customer_id: row.matched_customer_id,
        customer_display_name: compactCustomerName(row),
        inquiry_id: row.matched_inquiry_id,
        inquiry_title: row.inquiry_title,
        trade_term: extracted.trade_term || '',
        unit_price: extracted.unit_price || extracted.exw_price || extracted.fob_price || extracted.cif_price || extracted.ddp_price || '',
        total_amount: extracted.total_amount || '',
        quantity: extracted.quantity || '',
        quote_currency: extracted.quote_currency || '',
        quoted_by_us: extracted.quoted_by_us,
        payment_terms: extracted.payment_terms || '',
        lead_time: extracted.lead_time || '',
        source_email_subject: row.source_email_subject,
        source_email_direction: row.source_email_direction,
        source_email_received_at: row.source_email_received_at,
        created_at: row.created_at,
        updated_at: row.updated_at
      };
    });

    const priorityCustomers = db.prepare(`
      SELECT
        ${customerDisplaySelect('c')},
        i.inquiry_title AS latest_inquiry_title,
        i.status AS latest_inquiry_status,
        i.product_type AS latest_product_type,
        (
          SELECT COUNT(*) FROM costing_requests cr
          WHERE cr.customer_id = c.id AND cr.status IN ('pending', 'in_progress', 'revision_needed')
        ) AS pending_costing_count,
        (
          SELECT COUNT(*) FROM freight_quotes fq
          WHERE fq.customer_id = c.id AND fq.status IN ('draft', 'requested', 'received')
        ) AS pending_freight_count,
        (
          SELECT COUNT(*) FROM crm_import_suggestions cis
          WHERE cis.matched_customer_id = c.id AND cis.status IN ('pending', 'needs_review')
        ) AS pending_import_suggestion_count
      FROM customers c
      LEFT JOIN inquiries i ON i.id = c.latest_inquiry_id
      WHERE COALESCE(c.active, 1) = 1 AND COALESCE(c.is_invalid, 0) = 0 AND c.priority = 'A'
      ORDER BY COALESCE(c.next_followup_at, '9999-12-31 23:59:59') ASC,
               COALESCE(c.last_contact_at, c.updated_at, c.created_at) DESC,
               c.id DESC
      LIMIT 12
    `).all();

    const pendingCosting = db.prepare(`
      SELECT
        cr.id, cr.costing_request_code, cr.status, cr.urgency, cr.assigned_to, cr.due_at,
        cr.created_at, cr.updated_at,
        c.id AS customer_id,
        COALESCE(NULLIF(c.company_name, ''), NULLIF(c.name, ''), NULLIF(c.contact_person, ''), '未命名客户') AS customer_display_name,
        c.priority AS customer_priority,
        i.id AS inquiry_id, i.inquiry_title, i.product_type, i.quantity
      FROM costing_requests cr
      LEFT JOIN customers c ON c.id = cr.customer_id
      LEFT JOIN inquiries i ON i.id = cr.inquiry_id
      WHERE cr.status IN ('pending', 'in_progress', 'revision_needed')
      ORDER BY CASE cr.urgency WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,
               COALESCE(cr.due_at, '9999-12-31 23:59:59') ASC,
               cr.updated_at DESC,
               cr.id DESC
      LIMIT 15
    `).all();

    const pendingFreight = db.prepare(`
      SELECT
        fq.id, fq.freight_quote_code, fq.status, fq.shipping_mode, fq.forwarder_name,
        fq.destination_country, fq.destination_port, fq.total_freight_cost, fq.currency,
        fq.assigned_to, fq.valid_until, fq.created_at, fq.updated_at,
        c.id AS customer_id,
        COALESCE(NULLIF(c.company_name, ''), NULLIF(c.name, ''), NULLIF(c.contact_person, ''), '未命名客户') AS customer_display_name,
        c.priority AS customer_priority,
        i.id AS inquiry_id, i.inquiry_title, i.product_type, i.quantity
      FROM freight_quotes fq
      LEFT JOIN customers c ON c.id = fq.customer_id
      LEFT JOIN inquiries i ON i.id = fq.inquiry_id
      WHERE fq.status IN ('draft', 'requested', 'received')
      ORDER BY COALESCE(fq.valid_until, '9999-12-31') ASC,
               fq.updated_at DESC,
               fq.id DESC
      LIMIT 15
    `).all();

    const recentActiveCustomers = db.prepare(`
      SELECT
        ${customerDisplaySelect('c')},
        i.inquiry_title AS latest_inquiry_title,
        i.status AS latest_inquiry_status,
        (
          SELECT MAX(COALESCE(em.received_at, em.created_at))
          FROM email_messages em
          WHERE em.matched_customer_id = c.id
        ) AS latest_email_at,
        (
          SELECT subject
          FROM email_messages em
          WHERE em.matched_customer_id = c.id
          ORDER BY COALESCE(em.received_at, em.created_at) DESC, em.id DESC
          LIMIT 1
        ) AS latest_email_subject
      FROM customers c
      LEFT JOIN inquiries i ON i.id = c.latest_inquiry_id
      WHERE COALESCE(c.active, 1) = 1 AND COALESCE(c.is_invalid, 0) = 0
      ORDER BY COALESCE(latest_email_at, c.last_contact_at, c.updated_at, c.created_at) DESC, c.id DESC
      LIMIT 12
    `).all();

    const readinessCandidates = db.prepare(`
      SELECT
        i.*,
        COALESCE(NULLIF(c.company_name, ''), NULLIF(c.name, ''), NULLIF(c.contact_person, ''), '未命名客户') AS customer_display_name,
        c.priority AS customer_priority,
        c.next_followup_at AS customer_next_followup_at,
        c.last_contact_at AS customer_last_contact_at
      FROM inquiries i
      LEFT JOIN customers c ON c.id = i.customer_id
      WHERE COALESCE(c.active, 1) = 1
      ORDER BY i.updated_at DESC, i.id DESC
      LIMIT 80
    `).all();

    const readinessStats = { blocked: 0, need_customer_info: 0, technical_check: 0, ready: 0, boss_check: 0, partial: 0 };
    const readinessTasks = [];
    readinessCandidates.forEach((row) => {
      const currentSpecification = getCurrentSpecificationForInquiry(row);
      const readiness = evaluateQuoteReadiness(row, currentSpecification || {});
      const hints = buildQuoteReadinessHints(row, readiness);
      if (Object.prototype.hasOwnProperty.call(readinessStats, readiness.status)) {
        readinessStats[readiness.status] += 1;
      }
      const isTaskStatus = ['blocked', 'need_customer_info', 'technical_check'].includes(readiness.status);
      const isReadyWaitingCosting = readiness.status === 'ready' && Number(row.costing_required || 0) !== 1 && !Number(row.latest_cost_sheet_id || 0) && !Number(row.latest_quote_id || 0);
      if (!isTaskStatus && !isReadyWaitingCosting) return;
      const hasAiCandidate = readiness.status === 'blocked' && hints.has_pending_specification_suggestion && Object.keys(hints.field_candidate_map || {}).some((field) => (readiness.missing_required_fields || []).includes(field));
      readinessTasks.push({
        task_type: hasAiCandidate ? 'quote_readiness_pending_ai_candidate' : `quote_readiness_${readiness.status}`,
        title: hasAiCandidate ? '审核 AI 候选规格' : (readiness.status === 'ready' ? '待推进核价' : '检查报价资料完整度'),
        customer_id: row.customer_id || null,
        customer_name: row.customer_display_name,
        related_id: row.id,
        priority: hasAiCandidate ? 'A' : readiness.status === 'blocked' ? 'A' : row.customer_priority === 'A' ? 'A' : 'B',
        due_at: row.customer_next_followup_at || row.customer_last_contact_at || row.updated_at || '',
        reason: hasAiCandidate
          ? `${row.inquiry_title || '询盘'} 缺少正式资料，但 AI 已提取候选字段，建议审核规格建议`
          : readiness.status === 'ready'
            ? `${row.inquiry_title || '询盘'} 资料已完整，尚未发起核价`
            : `${row.inquiry_title || '询盘'} · ${readiness.next_action || '请补齐报价资料'}`,
        action_label: hasAiCandidate ? '查看 AI 候选' : (readiness.status === 'ready' ? '发起核价' : '查看资料完整度'),
        quote_readiness: { ...readiness, ...hints }
      });
    });

    const todayTasks = [];
    pendingSuggestions.slice(0, 12).forEach((item) => {
      const typeLabel = {
        customer_profile: '客户资料建议',
        inquiry: '询盘建议',
        specification: '规格建议',
        quotation_draft: '报价线索'
      }[item.suggestion_type] || '邮件建议';
      todayTasks.push({
        task_type: `suggestion_${item.suggestion_type || 'unknown'}`,
        title: `确认${typeLabel}`,
        customer_id: item.matched_customer_id || null,
        customer_name: item.customer_display_name,
        related_id: item.id,
        priority: item.suggestion_type === 'quotation_draft' ? 'A' : 'B',
        due_at: item.updated_at || item.created_at || '',
        reason: item.summary || item.source_email_subject || '有待确认的邮件导入建议',
        action_label: '预览并确认'
      });
    });
    readinessTasks.slice(0, 12).forEach((task) => todayTasks.push(task));
    priorityCustomers
      .filter((row) => text(row.next_followup_at) && row.next_followup_at.slice(0, 10) <= today)
      .slice(0, 8)
      .forEach((row) => todayTasks.push({
        task_type: 'followup_priority_customer',
        title: '跟进 A 类客户',
        customer_id: row.id,
        customer_name: compactCustomerName(row),
        related_id: row.latest_inquiry_id || null,
        priority: 'A',
        due_at: row.next_followup_at,
        reason: row.next_action || 'A 类客户已到跟进时间',
        action_label: '查看客户档案'
      }));
    pendingCosting.slice(0, 8).forEach((row) => todayTasks.push({
      task_type: 'pending_costing',
      title: '推进核价请求',
      customer_id: row.customer_id,
      customer_name: row.customer_display_name,
      related_id: row.id,
      priority: row.urgency === 'urgent' ? 'A' : 'B',
      due_at: row.due_at || '',
      reason: `${row.inquiry_title || '询盘'} 等待核价处理`,
      action_label: '查看核价'
    }));
    pendingFreight.slice(0, 8).forEach((row) => todayTasks.push({
      task_type: 'pending_freight',
      title: '确认物流费用',
      customer_id: row.customer_id,
      customer_name: row.customer_display_name,
      related_id: row.id,
      priority: row.customer_priority === 'A' ? 'A' : 'B',
      due_at: row.valid_until || '',
      reason: `${row.destination_country || '目的地'} ${row.destination_port || ''} 物流费用待确认`,
      action_label: '查看物流'
    }));

    todayTasks.sort((a, b) => {
      const rank = priorityRank(a.priority) - priorityRank(b.priority);
      if (rank) return rank;
      return String(a.due_at || '9999-12-31').localeCompare(String(b.due_at || '9999-12-31'));
    });

    res.json({
      ok: true,
      summary,
      quote_readiness_blocked: readinessStats.blocked,
      quote_readiness_need_customer_info: readinessStats.need_customer_info,
      quote_readiness_technical_check: readinessStats.technical_check,
      quote_readiness_ready: readinessStats.ready,
      today_tasks: todayTasks.slice(0, 40),
      priority_customers: priorityCustomers,
      pending_suggestions: pendingSuggestions,
      quotation_drafts: quotationDrafts,
      pending_costing: pendingCosting,
      pending_freight: pendingFreight,
      recent_active_customers: recentActiveCustomers
    });
  } catch (err) {
    handleError(res, err, 'CRM 作战台读取失败');
  }
});

router.get('/customers', (req, res) => {
  try {
    const q = text(req.query.q);
    const sortBy = text(req.query.sortBy || 'priority');
    const sortDirection = text(req.query.sortDirection || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    const params = [];
    let where = 'WHERE COALESCE(c.active, 1) = 1';
    if (q) {
      const like = `%${q}%`;
      where += `
        AND (
          c.company_name LIKE ? OR c.name LIKE ? OR c.contact_person LIKE ? OR c.email LIKE ?
          OR c.whatsapp LIKE ? OR c.country LIKE ? OR c.customer_code LIKE ?
        )
      `;
      params.push(like, like, like, like, like, like, like);
    }
    const sortMap = {
      priority: `CASE COALESCE(c.priority, 'D') WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END ${sortDirection}`,
      last_contact_at: `COALESCE(c.last_contact_at, c.updated_at, c.created_at) ${sortDirection}`,
      next_followup_at: `COALESCE(c.next_followup_at, '9999-12-31 23:59:59') ${sortDirection}`,
      latest_inquiry_status: `COALESCE(i.status, '') ${sortDirection}`,
      pending_costing: `pending_costing_count ${sortDirection}`,
      pending_freight: `pending_freight_count ${sortDirection}`,
      updated_at: `COALESCE(c.updated_at, c.created_at) ${sortDirection}`
    };
    const orderBy = sortMap[sortBy] || sortMap.priority;
    const rows = db.prepare(`
      SELECT
        ${customerDisplaySelect('c')},
        i.inquiry_title AS latest_inquiry_title,
        i.status AS latest_inquiry_status,
        i.updated_at AS latest_inquiry_updated_at,
        (
          SELECT status
          FROM costing_requests cr
          WHERE cr.customer_id = c.id
          ORDER BY cr.updated_at DESC, cr.id DESC
          LIMIT 1
        ) AS latest_costing_status,
        (
          SELECT COUNT(*)
          FROM costing_requests cr
          WHERE cr.customer_id = c.id AND cr.status IN ('pending', 'in_progress', 'revision_needed')
        ) AS pending_costing_count,
        (
          SELECT status
          FROM freight_quotes fq
          WHERE fq.customer_id = c.id
          ORDER BY fq.is_current DESC, fq.updated_at DESC, fq.id DESC
          LIMIT 1
        ) AS latest_freight_status,
        (
          SELECT COUNT(*)
          FROM freight_quotes fq
          WHERE fq.customer_id = c.id AND fq.status IN ('draft', 'requested', 'received')
        ) AS pending_freight_count,
        (
          SELECT COUNT(*)
          FROM crm_import_suggestions cis
          INNER JOIN email_messages em ON em.id = cis.source_id AND cis.source_type = 'email'
          WHERE em.matched_customer_id = c.id AND cis.status IN ('pending', 'needs_review')
        ) AS pending_import_suggestion_count,
        (
          SELECT suggested_priority
          FROM customer_research_notes rn
          WHERE rn.customer_id = c.id AND rn.status = 'active'
          ORDER BY rn.updated_at DESC, rn.id DESC
          LIMIT 1
        ) AS latest_suggested_priority
      FROM customers c
      LEFT JOIN inquiries i ON i.id = c.latest_inquiry_id
      ${where}
      ORDER BY ${orderBy}, c.updated_at DESC, c.id DESC
      LIMIT 300
    `).all(...params);
    res.json({ ok: true, rows });
  } catch (err) {
    handleError(res, err, '客户列表读取失败');
  }
});

router.post('/customers', (req, res) => {
  try {
    const body = req.body || {};
    const companyName = text(body.company_name || body.name || body.customer_name);
    if (!companyName) return res.status(400).json({ ok: false, error: 'company_name 必填' });
    const ts = now();
    const stage = normalizeCrmStage(body.stage || 'new_unprocessed');
    const name = companyName;
    const result = db.prepare(`
      INSERT INTO customers (
        salesperson_id, name, customer_code, company_name, country, city, contact_person, email,
        whatsapp, source_channel, priority, stage, owner_id, ai_summary, risk_notes, next_action,
        next_followup_at, last_contact_at, contact, phone, notes, active, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      body.salesperson_id || null,
      name,
      text(body.customer_code),
      companyName,
      text(body.country),
      text(body.city),
      text(body.contact_person),
      text(body.email),
      text(body.whatsapp),
      text(body.source_channel),
      text(body.priority || 'C'),
      stage,
      body.owner_id || req.user.id || null,
      text(body.ai_summary),
      text(body.risk_notes),
      text(body.next_action),
      text(body.next_followup_at),
      text(body.last_contact_at),
      text(body.contact || body.contact_person),
      text(body.phone),
      text(body.notes),
      ts,
      ts
    );
    crmAudit(req, 'create_customer', 'crm_customer', result.lastInsertRowid, {
      entity: 'customer',
      action: 'create',
      company_name: companyName
    });
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) {
    handleError(res, err, '客户创建失败');
  }
});

router.get('/customers/:id', (req, res) => {
  try {
    const id = idParam(req.params.id);
    const customer = getCustomer(id);
    if (!customer) return res.status(404).json({ ok: false, error: '客户不存在' });
    const latestInquiryBase = customer.latest_inquiry_id
      ? db.prepare('SELECT * FROM inquiries WHERE id = ?').get(customer.latest_inquiry_id) || null
      : null;
    const latestInquiry = latestInquiryBase ? withQuoteReadiness(latestInquiryBase) : null;
    const inquiries = db.prepare('SELECT * FROM inquiries WHERE customer_id = ? ORDER BY updated_at DESC, id DESC LIMIT 100').all(id).map(withQuoteReadiness);
    const communications = db.prepare('SELECT * FROM communication_logs WHERE customer_id = ? ORDER BY COALESCE(received_at, created_at) DESC, id DESC LIMIT 100').all(id);
    const overview = getCustomerOverview(id);
    const latestResearchNote = getLatestResearchNote(id);
    const latestSpecification = latestInquiry?.latest_specification_id ? getSpecification(Number(latestInquiry.latest_specification_id)) : null;
    const latestCommunication = communications[0] || null;
    const relatedEmails = db.prepare(`
      SELECT id, subject, from_email, from_name, received_at, direction, processing_status, matched_inquiry_id,
             conversation_key, quote_detected, inquiry_detected,
             SUBSTR(COALESCE(cleaned_text, text_body, ''), 1, 240) AS preview
      FROM email_messages
      WHERE matched_customer_id = ?
      ORDER BY COALESCE(received_at, created_at) DESC, id DESC
      LIMIT 20
    `).all(id);
    const importSuggestions = getCustomerImportSuggestions(id);
    const emailConversations = getCustomerEmailConversations(id);
    const auditLogs = db.prepare(`
      SELECT *
      FROM audit_logs
      WHERE (resource_type = 'crm_customer' AND resource_id = ?)
         OR (resource_type = 'crm_communication_log' AND resource_id IN (
              SELECT CAST(id AS TEXT) FROM communication_logs WHERE customer_id = ?
            ))
         OR (resource_type = 'crm_inquiry' AND resource_id IN (
              SELECT CAST(id AS TEXT) FROM inquiries WHERE customer_id = ?
            ))
      ORDER BY id DESC
      LIMIT 100
    `).all(String(id), id, id);
    res.json({
      ok: true,
      customer,
      latestInquiry,
      latestSpecification,
      latestCommunication,
      inquiries,
      communications,
      relatedEmails,
      emailConversations,
      importSuggestions,
      latestResearchNote,
      overview,
      pendingImportSuggestionCount: Number(overview.pending_import_suggestion_count || 0),
      audit_logs: auditLogs
    });
  } catch (err) {
    handleError(res, err, '客户详情读取失败');
  }
});

router.get('/customers/:id/research-notes', (req, res) => {
  try {
    const customerId = idParam(req.params.id);
    if (!getCustomer(customerId)) return res.status(404).json({ ok: false, error: '客户不存在' });
    const rows = db.prepare(`
      SELECT *
      FROM customer_research_notes
      WHERE customer_id = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT 200
    `).all(customerId);
    res.json({ ok: true, rows });
  } catch (err) {
    handleError(res, err, '客户调研资料读取失败');
  }
});

router.get('/customers/:id/import-suggestions', (req, res) => {
  try {
    const customerId = idParam(req.params.id);
    if (!getCustomer(customerId)) return res.status(404).json({ ok: false, error: '客户不存在' });
    const rows = getCustomerImportSuggestions(customerId);
    res.json({ ok: true, rows });
  } catch (err) {
    handleError(res, err, '客户导入建议读取失败');
  }
});

router.get('/customers/:id/email-conversations', (req, res) => {
  try {
    const customerId = idParam(req.params.id);
    if (!getCustomer(customerId)) return res.status(404).json({ ok: false, error: '客户不存在' });
    const rows = getCustomerEmailConversations(customerId);
    res.json({ ok: true, rows });
  } catch (err) {
    handleError(res, err, '客户邮件线程读取失败');
  }
});

router.post('/customers/:id/research-notes', (req, res) => {
  try {
    const customerId = idParam(req.params.id);
    if (!getCustomer(customerId)) return res.status(404).json({ ok: false, error: '客户不存在' });
    const body = req.body || {};
    const title = text(body.title);
    const summary = text(body.research_summary);
    if (!title && !summary) return res.status(400).json({ ok: false, error: 'title 或 research_summary 必填' });
    const ts = now();
    const result = db.prepare(`
      INSERT INTO customer_research_notes (
        customer_id, source_type, title, research_summary, customer_type, industry, main_products,
        website, country, city, company_size_note, buyer_authenticity_note, business_match_note,
        risk_flags, suggested_priority, suggested_next_action, sources_json, raw_input, parsed_json,
        status, created_by, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      customerId,
      text(body.source_type || 'manual'),
      title,
      summary,
      text(body.customer_type),
      text(body.industry),
      text(body.main_products),
      text(body.website),
      text(body.country),
      text(body.city),
      text(body.company_size_note),
      text(body.buyer_authenticity_note),
      text(body.business_match_note),
      text(body.risk_flags),
      text(body.suggested_priority),
      text(body.suggested_next_action),
      body.sources_json ? String(body.sources_json) : '',
      text(body.raw_input),
      body.parsed_json ? String(body.parsed_json) : '',
      text(body.status || 'active'),
      req.user.userName,
      ts,
      ts
    );
    crmAudit(req, 'create_customer_research_note', 'crm_customer_research_note', result.lastInsertRowid, {
      customer_id: customerId,
      source_type: text(body.source_type || 'manual'),
      title,
      suggested_priority: text(body.suggested_priority)
    });
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) {
    handleError(res, err, '客户调研资料创建失败');
  }
});

router.patch('/customers/:id/research-notes/:noteId', (req, res) => {
  try {
    const customerId = idParam(req.params.id);
    const noteId = idParam(req.params.noteId);
    if (!getCustomer(customerId)) return res.status(404).json({ ok: false, error: '客户不存在' });
    const oldRow = db.prepare('SELECT * FROM customer_research_notes WHERE id = ? AND customer_id = ?').get(noteId, customerId);
    if (!oldRow) return res.status(404).json({ ok: false, error: '调研资料不存在' });
    const fields = [
      'source_type', 'title', 'research_summary', 'customer_type', 'industry', 'main_products',
      'website', 'country', 'city', 'company_size_note', 'buyer_authenticity_note',
      'business_match_note', 'risk_flags', 'suggested_priority', 'suggested_next_action',
      'sources_json', 'raw_input', 'parsed_json', 'status'
    ];
    const body = req.body || {};
    const changes = changesFrom(oldRow, body, fields);
    updateByFields('customer_research_notes', noteId, body, fields);
    crmAudit(req, 'update_customer_research_note', 'crm_customer_research_note', noteId, {
      customer_id: customerId,
      changes
    });
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err, '客户调研资料更新失败');
  }
});

router.get('/customer-priority', (req, res) => {
  try {
    const params = [];
    let where = 'WHERE COALESCE(c.active, 1) = 1';
    ['priority', 'stage', 'country', 'owner_id', 'customer_type'].forEach((key) => {
      const value = text(req.query[key]);
      if (!value) return;
      where += ` AND c.${key} = ?`;
      params.push(key === 'owner_id' ? Number(value) : value);
    });
    if (text(req.query.pending_costing) === '1') {
      where += ` AND EXISTS (
        SELECT 1 FROM costing_requests cr
        WHERE cr.customer_id = c.id AND cr.status IN ('pending', 'in_progress', 'revision_needed')
      )`;
    }
    if (text(req.query.pending_freight) === '1') {
      where += ` AND EXISTS (
        SELECT 1 FROM freight_quotes fq
        WHERE fq.customer_id = c.id AND fq.status IN ('draft', 'requested', 'received')
      )`;
    }
    if (text(req.query.pending_suggestions) === '1') {
      where += ` AND EXISTS (
        SELECT 1
        FROM crm_import_suggestions cis
        INNER JOIN email_messages em ON em.id = cis.source_id AND cis.source_type = 'email'
        WHERE em.matched_customer_id = c.id AND cis.status IN ('pending', 'needs_review')
      )`;
    }
    const keyword = text(req.query.keyword || req.query.q);
    if (keyword) {
      const like = `%${keyword}%`;
      where += ` AND (
        COALESCE(c.company_name, '') LIKE ? OR COALESCE(c.name, '') LIKE ? OR COALESCE(c.country, '') LIKE ?
        OR COALESCE(c.customer_type, '') LIKE ? OR COALESCE(c.industry, '') LIKE ? OR COALESCE(c.next_action, '') LIKE ?
        OR COALESCE(c.risk_notes, '') LIKE ? OR COALESCE(i.inquiry_title, '') LIKE ?
      )`;
      params.push(like, like, like, like, like, like, like, like);
    }
    const rows = db.prepare(`
      SELECT
        ${customerDisplaySelect('c')},
        i.id AS latest_inquiry_id,
        i.inquiry_code AS latest_inquiry_code,
        i.inquiry_title AS latest_inquiry_title,
        i.status AS latest_inquiry_status,
        i.product_type AS latest_product_type,
        i.updated_at AS latest_inquiry_updated_at,
        i.next_action AS latest_inquiry_next_action,
        (
          SELECT COUNT(*) FROM costing_requests cr
          WHERE cr.customer_id = c.id AND cr.status IN ('pending', 'in_progress', 'revision_needed')
        ) AS pending_costing_count,
        (
          SELECT COUNT(*) FROM freight_quotes fq
          WHERE fq.customer_id = c.id AND fq.status IN ('draft', 'requested', 'received')
        ) AS pending_freight_count,
        (
          SELECT COUNT(*)
          FROM crm_import_suggestions cis
          INNER JOIN email_messages em ON em.id = cis.source_id AND cis.source_type = 'email'
          WHERE em.matched_customer_id = c.id AND cis.status IN ('pending', 'needs_review')
        ) AS pending_import_suggestion_count,
        (
          SELECT status FROM costing_requests cr
          WHERE cr.customer_id = c.id
          ORDER BY cr.updated_at DESC, cr.id DESC
          LIMIT 1
        ) AS latest_costing_status,
        (
          SELECT status FROM freight_quotes fq
          WHERE fq.customer_id = c.id
          ORDER BY fq.is_current DESC, fq.updated_at DESC, fq.id DESC
          LIMIT 1
        ) AS latest_freight_status,
        (
          SELECT risk_flags FROM customer_research_notes rn
          WHERE rn.customer_id = c.id AND rn.status = 'active'
          ORDER BY rn.updated_at DESC, rn.id DESC
          LIMIT 1
        ) AS latest_research_risk_flags
      FROM customers c
      LEFT JOIN inquiries i ON i.id = c.latest_inquiry_id
      ${where}
      ORDER BY
        CASE COALESCE(c.priority, 'D') WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END ASC,
        COALESCE(c.next_followup_at, '9999-12-31 23:59:59') ASC,
        COALESCE(c.last_contact_at, c.updated_at, c.created_at) DESC,
        c.updated_at DESC,
        c.id DESC
      LIMIT 300
    `).all(...params);
    const grouped = rows.reduce((acc, row) => {
      const key = text(row.priority || 'D') || 'D';
      if (!acc[key]) acc[key] = [];
      acc[key].push(row);
      return acc;
    }, {});
    res.json({ ok: true, rows, grouped });
  } catch (err) {
    handleError(res, err, '客户优先级列表读取失败');
  }
});

router.patch('/customers/:id', (req, res) => {
  try {
    const id = idParam(req.params.id);
    const oldRow = getCustomer(id);
    if (!oldRow) return res.status(404).json({ ok: false, error: '客户不存在' });
    const body = req.body || {};
    const normalized = { ...body };
    if (Object.prototype.hasOwnProperty.call(normalized, 'company_name') && text(normalized.company_name)) {
      normalized.name = text(normalized.company_name);
    }
    if (Object.prototype.hasOwnProperty.call(normalized, 'stage')) {
      normalized.stage = normalizeCrmStage(normalized.stage);
    }
    const fields = [...CUSTOMER_FIELDS, 'name'];
    const changes = changesFrom(oldRow, normalized, fields);
    updateByFields('customers', id, normalized, fields);
    crmAudit(req, 'update_customer', 'crm_customer', id, {
      entity: 'customer',
      action: 'update',
      changes
    });
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err, '客户更新失败');
  }
});

router.get('/customers/:id/communications', (req, res) => {
  try {
    const id = idParam(req.params.id);
    if (!getCustomer(id)) return res.status(404).json({ ok: false, error: '客户不存在' });
    const rows = db.prepare('SELECT * FROM communication_logs WHERE customer_id = ? ORDER BY COALESCE(received_at, created_at) DESC, id DESC LIMIT 300').all(id);
    res.json({ ok: true, rows });
  } catch (err) {
    handleError(res, err, '沟通记录读取失败');
  }
});

router.post('/customers/:id/communications', (req, res) => {
  try {
    const customerId = idParam(req.params.id);
    if (!getCustomer(customerId)) return res.status(404).json({ ok: false, error: '客户不存在' });
    const body = req.body || {};
    const rawContent = text(body.raw_content);
    const subject = text(body.subject);
    if (!rawContent && !subject) return res.status(400).json({ ok: false, error: 'subject 或 raw_content 必填' });
    const ts = now();
    const result = db.prepare(`
      INSERT INTO communication_logs (
        customer_id, inquiry_id, channel, direction, sender, recipient, subject, raw_content,
        ai_summary, attachments_json, message_id, thread_id, received_at, created_by, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      customerId,
      body.inquiry_id || null,
      text(body.channel || 'manual'),
      text(body.direction || 'inbound'),
      text(body.sender),
      text(body.recipient),
      subject,
      rawContent,
      text(body.ai_summary),
      body.attachments_json ? String(body.attachments_json) : '',
      text(body.message_id),
      text(body.thread_id),
      text(body.received_at || ts),
      req.user.userName,
      ts,
      ts
    );
    db.prepare('UPDATE customers SET last_contact_at = ?, updated_at = ? WHERE id = ?').run(text(body.received_at || ts), ts, customerId);
    crmAudit(req, 'create_communication_log', 'crm_communication_log', result.lastInsertRowid, {
      entity: 'communication_log',
      action: 'create',
      customer_id: customerId,
      inquiry_id: body.inquiry_id || null,
      channel: text(body.channel || 'manual')
    });
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) {
    handleError(res, err, '沟通记录创建失败');
  }
});

const INQUIRY_FIELDS = [
  'inquiry_code', 'customer_id', 'inquiry_title', 'product_type', 'application', 'packaging_type',
  'status', 'priority', 'quantity', 'destination_country', 'destination_port', 'destination_address',
  'trade_term_requested', 'customer_target_price', 'missing_info', 'customer_questions',
  'technical_risks', 'commercial_risks', 'costing_required', 'latest_cost_sheet_id',
  'latest_quote_id', 'order_id', 'next_action', 'next_followup_at'
];

router.get('/inquiries', (req, res) => {
  try {
    const q = text(req.query.q);
    const status = text(req.query.status);
    const priority = text(req.query.priority);
    const params = [];
    let where = 'WHERE 1 = 1';
    if (q) {
      const like = `%${q}%`;
      where += `
        AND (
          i.inquiry_title LIKE ? OR i.product_type LIKE ? OR i.packaging_type LIKE ?
          OR i.destination_country LIKE ? OR c.company_name LIKE ? OR c.name LIKE ?
        )
      `;
      params.push(like, like, like, like, like, like);
    }
    if (status) {
      where += ' AND i.status = ?';
      params.push(status);
    }
    if (priority) {
      where += ' AND i.priority = ?';
      params.push(priority);
    }
    const rows = db.prepare(`
      SELECT
        i.*,
        COALESCE(NULLIF(c.company_name, ''), NULLIF(c.name, ''), '未命名客户') AS customer_display_name,
        c.country AS customer_country
      FROM inquiries i
      LEFT JOIN customers c ON c.id = i.customer_id
      ${where}
      ORDER BY i.updated_at DESC, i.id DESC
      LIMIT 300
    `).all(...params);
    res.json({ ok: true, rows });
  } catch (err) {
    handleError(res, err, '询盘列表读取失败');
  }
});

router.post('/inquiries', (req, res) => {
  try {
    const body = req.body || {};
    const customerId = idParam(body.customer_id);
    if (!customerId || !getCustomer(customerId)) return res.status(400).json({ ok: false, error: '有效 customer_id 必填' });
    const title = text(body.inquiry_title);
    if (!title) return res.status(400).json({ ok: false, error: 'inquiry_title 必填' });
    const ts = now();
    const tx = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO inquiries (
          inquiry_code, customer_id, inquiry_title, product_type, application, packaging_type, status,
          priority, quantity, destination_country, destination_port, destination_address, trade_term_requested,
          customer_target_price, missing_info, customer_questions, technical_risks, commercial_risks,
          costing_required, next_action, next_followup_at, created_by, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        text(body.inquiry_code),
        customerId,
        title,
        text(body.product_type),
        text(body.application),
        text(body.packaging_type),
        text(body.status || 'new'),
        text(body.priority || 'C'),
        text(body.quantity),
        text(body.destination_country),
        text(body.destination_port),
        text(body.destination_address),
        text(body.trade_term_requested),
        text(body.customer_target_price),
        text(body.missing_info),
        text(body.customer_questions),
        text(body.technical_risks),
        text(body.commercial_risks),
        intFlag(body.costing_required),
        text(body.next_action),
        text(body.next_followup_at),
        req.user.userName,
        ts,
        ts
      );
      db.prepare('UPDATE customers SET latest_inquiry_id = ?, updated_at = ? WHERE id = ?').run(result.lastInsertRowid, ts, customerId);
      return result.lastInsertRowid;
    });
    const id = tx();
    recalculateQuoteReadiness(id);
    crmAudit(req, 'create_inquiry', 'crm_inquiry', id, {
      entity: 'inquiry',
      action: 'create',
      customer_id: customerId,
      inquiry_title: title
    });
    crmAudit(req, 'update_customer_latest_inquiry', 'crm_customer', customerId, {
      entity: 'customer',
      action: 'update_customer_latest_inquiry',
      latest_inquiry_id: id
    });
    res.json({ ok: true, id });
  } catch (err) {
    handleError(res, err, '询盘创建失败');
  }
});

function getInquiry(id) {
  return db.prepare(`
    SELECT
      i.*,
      COALESCE(NULLIF(c.company_name, ''), NULLIF(c.name, ''), '未命名客户') AS customer_display_name
    FROM inquiries i
    LEFT JOIN customers c ON c.id = i.customer_id
    WHERE i.id = ?
  `).get(id);
}

function getSpecification(id) {
  const spec = db.prepare('SELECT * FROM inquiry_specifications WHERE id = ?').get(id);
  if (!spec) return null;
  spec.layers = db.prepare('SELECT * FROM specification_layers WHERE specification_id = ? ORDER BY layer_order ASC, id ASC').all(id);
  return spec;
}

router.get('/inquiries/:id', (req, res) => {
  try {
    const id = idParam(req.params.id);
    const inquiryBase = getInquiry(id);
    const inquiry = inquiryBase ? withQuoteReadiness(inquiryBase) : null;
    if (!inquiry) return res.status(404).json({ ok: false, error: '询盘不存在' });
    const specifications = db.prepare('SELECT * FROM inquiry_specifications WHERE inquiry_id = ? ORDER BY version_no DESC, id DESC').all(id);
    const currentBase = specifications.find((row) => Number(row.is_current) === 1) || specifications[0] || null;
    const currentSpecification = currentBase ? getSpecification(currentBase.id) : null;
    const communications = db.prepare('SELECT * FROM communication_logs WHERE inquiry_id = ? ORDER BY COALESCE(received_at, created_at) DESC, id DESC LIMIT 100').all(id);
    res.json({ ok: true, inquiry, currentSpecification, specifications, communications, quote_readiness: inquiry.quote_readiness });
  } catch (err) {
    handleError(res, err, '询盘详情读取失败');
  }
});

router.patch('/inquiries/:id', (req, res) => {
  try {
    const id = idParam(req.params.id);
    const oldRow = getInquiry(id);
    if (!oldRow) return res.status(404).json({ ok: false, error: '询盘不存在' });
    const body = req.body || {};
    if (Object.prototype.hasOwnProperty.call(body, 'customer_id') && !getCustomer(idParam(body.customer_id))) {
      return res.status(400).json({ ok: false, error: '有效 customer_id 必填' });
    }
    const changes = changesFrom(oldRow, body, INQUIRY_FIELDS);
    updateByFields('inquiries', id, body, INQUIRY_FIELDS);
    recalculateQuoteReadiness(id);
    crmAudit(req, 'update_inquiry', 'crm_inquiry', id, {
      entity: 'inquiry',
      action: 'update',
      changes
    });
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err, '询盘更新失败');
  }
});

router.get('/inquiries/:id/quote-readiness', (req, res) => {
  try {
    const id = idParam(req.params.id);
    const inquiry = getInquiry(id);
    if (!inquiry) return res.status(404).json({ ok: false, error: '询盘不存在' });
    const currentSpecification = getCurrentSpecificationForInquiry(inquiry);
    const quoteReadiness = evaluateQuoteReadiness(inquiry, currentSpecification || {});
    const hints = buildQuoteReadinessHints(inquiry, quoteReadiness);
    res.json({
      ok: true,
      inquiry: { ...withQuoteReadiness(inquiry), ...hints },
      current_specification: currentSpecification,
      quote_readiness: { ...quoteReadiness, ...hints }
    });
  } catch (err) {
    handleError(res, err, '报价资料完整度读取失败');
  }
});

router.post('/inquiries/:id/recalculate-quote-readiness', (req, res) => {
  try {
    const id = idParam(req.params.id);
    const result = recalculateQuoteReadiness(id);
    if (!result) return res.status(404).json({ ok: false, error: '询盘不存在' });
    crmAudit(req, 'recalculate_quote_readiness', 'crm_inquiry', id, {
      inquiry_id: id,
      quote_readiness_status: result.readiness.status,
      quote_readiness_score: result.readiness.score,
      quote_readiness_color: result.readiness.color
    });
    res.json({
      ok: true,
      inquiry: { ...withQuoteReadiness(result.inquiry), ...(result.hints || {}) },
      current_specification: result.specification,
      quote_readiness: { ...result.readiness, ...(result.hints || {}) }
    });
  } catch (err) {
    handleError(res, err, '报价资料完整度重算失败');
  }
});

const SPEC_FIELDS = [
  'product_type', 'bag_type', 'film_type', 'size_width', 'size_height', 'gusset_size', 'roll_width',
  'roll_length', 'repeat_length', 'thickness_total', 'thickness_unit', 'material_structure_text',
  'printing_colors', 'surface_finish', 'zipper_required', 'valve_required', 'spout_required',
  'tear_notch_required', 'window_required', 'filling_weight', 'packing_machine_type', 'artwork_status',
  'notes', 'source_communication_id'
];

router.get('/inquiries/:id/specifications', (req, res) => {
  try {
    const inquiryId = idParam(req.params.id);
    if (!getInquiry(inquiryId)) return res.status(404).json({ ok: false, error: '询盘不存在' });
    const rows = db.prepare('SELECT * FROM inquiry_specifications WHERE inquiry_id = ? ORDER BY version_no DESC, id DESC').all(inquiryId);
    const layersBySpec = new Map();
    if (rows.length) {
      const ids = rows.map((row) => row.id);
      const placeholders = ids.map(() => '?').join(',');
      const layers = db.prepare(`SELECT * FROM specification_layers WHERE specification_id IN (${placeholders}) ORDER BY layer_order ASC, id ASC`).all(...ids);
      layers.forEach((layer) => {
        const key = Number(layer.specification_id);
        if (!layersBySpec.has(key)) layersBySpec.set(key, []);
        layersBySpec.get(key).push(layer);
      });
    }
    res.json({ ok: true, rows: rows.map((row) => ({ ...row, layers: layersBySpec.get(Number(row.id)) || [] })) });
  } catch (err) {
    handleError(res, err, '规格版本读取失败');
  }
});

router.post('/inquiries/:id/specifications', (req, res) => {
  try {
    const inquiryId = idParam(req.params.id);
    if (!getInquiry(inquiryId)) return res.status(404).json({ ok: false, error: '询盘不存在' });
    const body = req.body || {};
    const ts = now();
    const tx = db.transaction(() => {
      const maxRow = db.prepare('SELECT COALESCE(MAX(version_no), 0) AS max_version FROM inquiry_specifications WHERE inquiry_id = ?').get(inquiryId);
      const versionNo = Number(maxRow?.max_version || 0) + 1;
      db.prepare('UPDATE inquiry_specifications SET is_current = 0, updated_at = ? WHERE inquiry_id = ?').run(ts, inquiryId);
      const result = db.prepare(`
        INSERT INTO inquiry_specifications (
          inquiry_id, version_no, is_current, product_type, bag_type, film_type, size_width, size_height,
          gusset_size, roll_width, roll_length, repeat_length, thickness_total, thickness_unit,
          material_structure_text, printing_colors, surface_finish, zipper_required, valve_required,
          spout_required, tear_notch_required, window_required, filling_weight, packing_machine_type,
          artwork_status, notes, source_communication_id, created_by, created_at, updated_at
        )
        VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        inquiryId,
        versionNo,
        text(body.product_type),
        text(body.bag_type),
        text(body.film_type),
        text(body.size_width),
        text(body.size_height),
        text(body.gusset_size),
        text(body.roll_width),
        text(body.roll_length),
        text(body.repeat_length),
        text(body.thickness_total),
        text(body.thickness_unit),
        text(body.material_structure_text),
        text(body.printing_colors),
        text(body.surface_finish),
        intFlag(body.zipper_required),
        intFlag(body.valve_required),
        intFlag(body.spout_required),
        intFlag(body.tear_notch_required),
        intFlag(body.window_required),
        text(body.filling_weight),
        text(body.packing_machine_type),
        text(body.artwork_status),
        text(body.notes),
        body.source_communication_id || null,
        req.user.userName,
        ts,
        ts
      );
      db.prepare('UPDATE inquiries SET latest_specification_id = ?, updated_at = ? WHERE id = ?').run(result.lastInsertRowid, ts, inquiryId);
      return { id: result.lastInsertRowid, versionNo };
    });
    const result = tx();
    recalculateQuoteReadiness(inquiryId);
    crmAudit(req, 'create_specification_version', 'crm_specification', result.id, {
      entity: 'specification',
      action: 'create_version',
      inquiry_id: inquiryId,
      version_no: result.versionNo
    });
    res.json({ ok: true, id: result.id, version_no: result.versionNo });
  } catch (err) {
    handleError(res, err, '规格版本创建失败');
  }
});

router.get('/specifications/:id', (req, res) => {
  try {
    const id = idParam(req.params.id);
    const specification = getSpecification(id);
    if (!specification) return res.status(404).json({ ok: false, error: '规格不存在' });
    res.json({ ok: true, specification });
  } catch (err) {
    handleError(res, err, '规格读取失败');
  }
});

router.post('/specifications/:id/layers', (req, res) => {
  try {
    const specificationId = idParam(req.params.id);
    if (!getSpecification(specificationId)) return res.status(404).json({ ok: false, error: '规格不存在' });
    const body = req.body || {};
    const materialName = text(body.material_name);
    if (!materialName) return res.status(400).json({ ok: false, error: 'material_name 必填' });
    const ts = now();
    const maxRow = db.prepare('SELECT COALESCE(MAX(layer_order), 0) AS max_order FROM specification_layers WHERE specification_id = ?').get(specificationId);
    const layerOrder = Number(body.layer_order || 0) > 0 ? Number(body.layer_order) : Number(maxRow?.max_order || 0) + 1;
    const result = db.prepare(`
      INSERT INTO specification_layers (
        specification_id, layer_order, material_name, material_code, thickness, thickness_unit, layer_role,
        is_customer_required, is_system_suggested, is_confirmed_by_costing, notes, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      specificationId,
      layerOrder,
      materialName,
      text(body.material_code),
      text(body.thickness),
      text(body.thickness_unit),
      text(body.layer_role),
      intFlag(body.is_customer_required),
      intFlag(body.is_system_suggested),
      intFlag(body.is_confirmed_by_costing),
      text(body.notes),
      ts,
      ts
    );
    crmAudit(req, 'create_specification_layer', 'crm_specification_layer', result.lastInsertRowid, {
      entity: 'specification_layer',
      action: 'create',
      specification_id: specificationId,
      layer_order: layerOrder,
      material_name: materialName
    });
    const specRow = db.prepare('SELECT inquiry_id FROM inquiry_specifications WHERE id = ?').get(specificationId);
    if (specRow?.inquiry_id) recalculateQuoteReadiness(Number(specRow.inquiry_id));
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) {
    handleError(res, err, '材料层创建失败');
  }
});

function isCostingUser(req) {
  return req.user?.role === 'costing_user';
}

function assertCostingAssignment(req, row) {
  if (!isCostingUser(req)) return true;
  const userName = String(req.user?.userName || '');
  const userId = Number(req.user?.id || 0);
  return Number(row?.assigned_to_user_id || 0) === userId || String(row?.assigned_to || '') === userName;
}

function safeCustomerSummary(customer = {}, includeSensitive = false) {
  const base = {
    id: customer.id,
    display_name: customer.display_name || customer.company_name || customer.name || '未命名客户',
    company_name: customer.company_name || customer.name || '',
    country: customer.country || '',
    city: customer.city || '',
    contact_person: customer.contact_person || customer.contact || '',
  };
  if (includeSensitive) {
    base.email = customer.email || '';
    base.whatsapp = customer.whatsapp || '';
  }
  return base;
}

function safeEmailConfigStatus() {
  const validation = validateImapConfig();
  return {
    imapConfigured: validation.ok,
    host: validation.config.host || '',
    port: validation.config.port || 0,
    secure: !!validation.config.secure,
    userMasked: validation.config.userMasked || '',
    passwordConfigured: !!validation.config.passwordConfigured,
    missing: validation.missing,
    suggestedHosts: ['imap.qiye.aliyun.com', 'imap.mxhichina.com'],
    note: 'Run real IMAP connectivity verification on the deployment server.'
  };
}

const CUSTOMER_APPLY_FIELDS = [
  'company_name', 'contact_person', 'email', 'whatsapp', 'phone', 'country', 'city', 'website',
  'customer_type', 'industry', 'main_product', 'source_channel', 'customer_summary', 'risk_notes',
  'next_action', 'priority'
];

const INQUIRY_APPLY_FIELDS = [
  'inquiry_title', 'product_type', 'application', 'packaging_type', 'quantity', 'destination_country',
  'destination_port', 'destination_address', 'trade_term_requested', 'customer_target_price',
  'missing_info', 'customer_questions', 'technical_risks', 'commercial_risks', 'next_action'
];

const SPEC_APPLY_FIELDS = [
  'product_type', 'bag_type', 'film_type', 'size_width', 'size_height', 'gusset_size', 'roll_width',
  'repeat_length', 'thickness_total', 'thickness_unit', 'material_structure_text', 'printing_colors',
  'surface_finish', 'zipper_required', 'valve_required', 'spout_required', 'tear_notch_required',
  'window_required', 'filling_weight', 'packing_machine_type', 'artwork_status', 'notes'
];

function loadSuggestion(id) {
  return db.prepare(`
    SELECT cis.*, em.subject AS source_email_subject, em.received_at AS source_email_received_at, em.message_id AS source_message_id
    FROM crm_import_suggestions cis
    LEFT JOIN email_messages em ON em.id = cis.source_id AND cis.source_type = 'email'
    WHERE cis.id = ?
  `).get(id);
}

function buildDiff(current, suggested, fields) {
  return fields
    .filter((field) => Object.prototype.hasOwnProperty.call(suggested, field))
    .map((field) => {
      const currentValue = current?.[field] ?? '';
      const suggestedValue = suggested?.[field] ?? '';
      if (String(currentValue ?? '') === String(suggestedValue ?? '')) return null;
      return {
        field,
        current_value: currentValue,
        suggested_value: suggestedValue,
        action: currentValue === undefined || currentValue === null || currentValue === '' ? 'create' : 'update'
      };
    })
    .filter(Boolean);
}

function buildSuggestionPreview(row) {
  const extracted = parseJsonObject(row.extracted_json, {});
  const applyPlan = {
    will_create_customer: false,
    will_update_customer: false,
    will_create_communication_log: false,
    will_create_inquiry: false,
    will_create_specification: false,
    will_create_quotation: false
  };
  const warnings = [];
  let target = {};
  let diff = [];

  if (row.suggestion_type === 'customer_profile') {
    target = row.matched_customer_id ? getCustomer(Number(row.matched_customer_id)) || {} : {};
    applyPlan.will_create_customer = !row.matched_customer_id;
    applyPlan.will_update_customer = !!row.matched_customer_id;
    diff = buildDiff(target, extracted, CUSTOMER_APPLY_FIELDS);
    if (!row.matched_customer_id) warnings.push('No matched customer. Creating a new customer requires allow_create_customer=true.');
  } else if (row.suggestion_type === 'communication_log') {
    target = {};
    applyPlan.will_create_communication_log = true;
    diff = buildDiff({}, extracted, ['channel', 'direction', 'sender', 'recipient', 'subject', 'raw_content', 'received_at']);
    if (!row.matched_customer_id) warnings.push('Communication log should be linked after customer confirmation.');
  } else if (row.suggestion_type === 'inquiry') {
    target = row.matched_inquiry_id ? getInquiry(Number(row.matched_inquiry_id)) || {} : {};
    applyPlan.will_create_inquiry = !row.matched_inquiry_id;
    diff = buildDiff(target, extracted, INQUIRY_APPLY_FIELDS);
    if (!row.matched_customer_id) warnings.push('Inquiry creation requires a confirmed customer.');
  } else if (row.suggestion_type === 'specification') {
    target = row.matched_inquiry_id ? getInquiry(Number(row.matched_inquiry_id)) || {} : {};
    applyPlan.will_create_specification = true;
    diff = buildDiff({}, extracted, SPEC_APPLY_FIELDS);
    if (!row.matched_inquiry_id) warnings.push('Specification creation requires a confirmed inquiry.');
  } else if (row.suggestion_type === 'quotation_draft') {
    applyPlan.will_create_quotation = tableExists('quotations');
    diff = buildDiff({}, extracted, ['trade_term', 'unit_price', 'total_amount', 'quantity', 'payment_terms', 'lead_time', 'validity_date']);
    if (!tableExists('quotations')) warnings.push('Quotation table not available yet.');
  }

  return {
    suggestion: row,
    target,
    diff,
    apply_plan: applyPlan,
    warnings
  };
}

function buildSuggestedCostInput(inquiry = {}, specification = {}, layers = [], costingRequest = {}) {
  return {
    product_type: specification.product_type || inquiry.product_type || '',
    bag_type: specification.bag_type || '',
    film_type: specification.film_type || '',
    material_structure_text: specification.material_structure_text || '',
    layers,
    thickness_total: specification.thickness_total || '',
    thickness_unit: specification.thickness_unit || '',
    quantity: inquiry.quantity || '',
    required_unit: costingRequest.required_unit || '',
    destination_country: inquiry.destination_country || '',
    destination_port: inquiry.destination_port || '',
    trade_term_requested: inquiry.trade_term_requested || '',
  };
}

function getCostingRequestRow(id) {
  return db.prepare(`
    SELECT
      cr.*,
      COALESCE(NULLIF(c.company_name, ''), NULLIF(c.name, ''), '未命名客户') AS customer_display_name,
      c.country AS customer_country,
      i.inquiry_title,
      i.product_type AS inquiry_product_type,
      i.quantity AS inquiry_quantity,
      i.destination_country,
      i.destination_port,
      i.trade_term_requested,
      s.product_type AS specification_product_type,
      s.bag_type,
      s.film_type,
      s.size_width,
      s.size_height,
      s.gusset_size,
      s.thickness_total,
      s.thickness_unit,
      s.material_structure_text
    FROM costing_requests cr
    LEFT JOIN customers c ON c.id = cr.customer_id
    LEFT JOIN inquiries i ON i.id = cr.inquiry_id
    LEFT JOIN inquiry_specifications s ON s.id = cr.specification_id
    WHERE cr.id = ?
  `).get(id);
}

function generateCostingRequestCode() {
  const day = now().slice(0, 10).replace(/-/g, '');
  const prefix = `CR-${day}-`;
  const row = db.prepare('SELECT costing_request_code FROM costing_requests WHERE costing_request_code LIKE ? ORDER BY costing_request_code DESC LIMIT 1').get(`${prefix}%`);
  const last = row?.costing_request_code ? Number(String(row.costing_request_code).slice(prefix.length)) : 0;
  return `${prefix}${String((Number.isFinite(last) ? last : 0) + 1).padStart(4, '0')}`;
}

function getLatestCostSnapshot(costingRequestId, inquiryId, specificationId) {
  return db.prepare(`
    SELECT *
    FROM cost_snapshots
    WHERE
      (costing_request_id = ? AND ? > 0)
      OR (inquiry_id = ? AND ? > 0)
      OR (specification_id = ? AND ? > 0)
    ORDER BY is_current DESC, updated_at DESC, id DESC
    LIMIT 1
  `).get(costingRequestId, costingRequestId, inquiryId, inquiryId, specificationId, specificationId) || null;
}

router.post('/inquiries/:id/costing-requests', (req, res) => {
  try {
    const inquiryId = idParam(req.params.id);
    const inquiry = getInquiry(inquiryId);
    if (!inquiry) return res.status(404).json({ ok: false, error: '询盘不存在' });
    const specificationId = Number(inquiry.latest_specification_id || 0);
    if (!specificationId) return res.status(400).json({ ok: false, error: '请先创建规格版本，再发起成本核算请求' });
    const specification = getSpecification(specificationId);
    if (!specification) return res.status(400).json({ ok: false, error: '当前规格版本不存在' });
    const customer = getCustomer(Number(inquiry.customer_id || 0));
    if (!customer) return res.status(400).json({ ok: false, error: '客户不存在' });

    const body = req.body || {};
    const ts = now();
    const tx = db.transaction(() => {
      const code = generateCostingRequestCode();
      const result = db.prepare(`
        INSERT INTO costing_requests (
          costing_request_code, customer_id, inquiry_id, specification_id, requested_by,
          assigned_to, assigned_to_user_id, status, request_note, required_quote_terms,
          required_currency, required_unit, target_margin, customer_target_price, urgency,
          due_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        code,
        Number(inquiry.customer_id || 0),
        inquiryId,
        specificationId,
        req.user.userName,
        text(body.assigned_to),
        Number(body.assigned_to_user_id || 0) || null,
        text(body.request_note),
        text(body.required_quote_terms || 'EXW'),
        text(body.required_currency || 'RMB'),
        text(body.required_unit || 'pcs'),
        text(body.target_margin),
        text(body.customer_target_price || inquiry.customer_target_price),
        text(body.urgency || 'normal'),
        text(body.due_at),
        ts,
        ts
      );
      db.prepare("UPDATE inquiries SET costing_required = 1, status = 'costing', next_action = 'Waiting for costing', updated_at = ? WHERE id = ?").run(ts, inquiryId);
      return { id: result.lastInsertRowid, code };
    });

    const created = tx();
    const row = getCostingRequestRow(created.id);
    crmAudit(req, 'create_costing_request', 'crm_costing_request', created.id, {
      costing_request_id: created.id,
      inquiry_id: inquiryId,
      customer_id: inquiry.customer_id,
      specification_id: specificationId,
      old_status: '',
      new_status: 'pending',
      assigned_to: text(body.assigned_to),
      assigned_to_user_id: Number(body.assigned_to_user_id || 0) || null
    });
    crmAudit(req, 'update_inquiry_costing_status', 'crm_inquiry', inquiryId, {
      costing_request_id: created.id,
      inquiry_id: inquiryId,
      customer_id: inquiry.customer_id,
      specification_id: specificationId,
      old_status: inquiry.status,
      new_status: 'costing'
    });
    res.json({
      ok: true,
      costing_request: row,
      inquiry: getInquiry(inquiryId),
      specification,
      layers: specification.layers || []
    });
  } catch (err) {
    handleError(res, err, '成本核算请求创建失败');
  }
});

router.get('/costing-requests', (req, res) => {
  try {
    const params = [];
    let where = 'WHERE 1 = 1';
    if (isCostingUser(req)) {
      where += ' AND (cr.assigned_to_user_id = ? OR cr.assigned_to = ?)';
      params.push(Number(req.user.id || 0), String(req.user.userName || ''));
    }
    ['status', 'assigned_to', 'customer_id', 'inquiry_id', 'urgency'].forEach((key) => {
      const value = text(req.query[key]);
      if (!value) return;
      where += ` AND cr.${key} = ?`;
      params.push(key.endsWith('_id') ? Number(value) : value);
    });
    const q = text(req.query.q);
    if (q) {
      const like = `%${q}%`;
      where += ' AND (cr.costing_request_code LIKE ? OR c.company_name LIKE ? OR c.name LIKE ? OR i.inquiry_title LIKE ?)';
      params.push(like, like, like, like);
    }
    if (text(req.query.date_from)) {
      where += ' AND cr.created_at >= ?';
      params.push(text(req.query.date_from));
    }
    if (text(req.query.date_to)) {
      where += ' AND cr.created_at <= ?';
      params.push(text(req.query.date_to));
    }

    const rows = db.prepare(`
      SELECT
        cr.*,
        COALESCE(NULLIF(c.company_name, ''), NULLIF(c.name, ''), '未命名客户') AS customer_display_name,
        c.country AS customer_country,
        i.inquiry_title,
        i.product_type,
        i.quantity,
        i.destination_country,
        i.destination_port,
        i.trade_term_requested,
        i.next_action,
        s.bag_type,
        s.film_type,
        s.size_width,
        s.size_height,
        s.gusset_size,
        s.thickness_total,
        s.thickness_unit,
        s.material_structure_text
      FROM costing_requests cr
      LEFT JOIN customers c ON c.id = cr.customer_id
      LEFT JOIN inquiries i ON i.id = cr.inquiry_id
      LEFT JOIN inquiry_specifications s ON s.id = cr.specification_id
      ${where}
      ORDER BY cr.updated_at DESC, cr.id DESC
      LIMIT 300
    `).all(...params);
    res.json({ ok: true, rows });
  } catch (err) {
    handleError(res, err, '成本核算请求列表读取失败');
  }
});

router.get('/costing-requests/:id', (req, res) => {
  try {
    const id = idParam(req.params.id);
    const row = getCostingRequestRow(id);
    if (!row) return res.status(404).json({ ok: false, error: '成本核算请求不存在' });
    if (!assertCostingAssignment(req, row)) return res.status(403).json({ error: '无权限访问该成本核算请求' });
    const customer = getCustomer(Number(row.customer_id || 0));
    const inquiry = getInquiry(Number(row.inquiry_id || 0));
    const specification = getSpecification(Number(row.specification_id || 0));
    const layers = specification?.layers || [];
    const latestCostSnapshot = getLatestCostSnapshot(id, Number(row.inquiry_id || 0), Number(row.specification_id || 0));
    const auditLogs = db.prepare(`
      SELECT *
      FROM audit_logs
      WHERE resource_type = 'crm_costing_request' AND resource_id = ?
      ORDER BY id DESC
      LIMIT 100
    `).all(String(id));
    res.json({
      ok: true,
      costing_request: row,
      customer: safeCustomerSummary(customer || {}, !isCostingUser(req)),
      inquiry,
      current_specification: specification,
      specification_layers: layers,
      suggested_cost_input: buildSuggestedCostInput(inquiry || {}, specification || {}, layers, row),
      latest_cost_snapshot: latestCostSnapshot,
      audit_logs: auditLogs
    });
  } catch (err) {
    handleError(res, err, '成本核算请求详情读取失败');
  }
});

const COSTING_UPDATE_FIELDS = [
  'request_note', 'assigned_to', 'assigned_to_user_id', 'required_quote_terms', 'required_currency',
  'required_unit', 'target_margin', 'urgency', 'due_at', 'completed_at'
];
const STATUS_TRANSITIONS = {
  pending: ['in_progress', 'rejected', 'cancelled'],
  in_progress: ['completed', 'revision_needed', 'rejected', 'cancelled'],
  revision_needed: ['in_progress', 'cancelled'],
  completed: [],
  rejected: [],
  cancelled: []
};

router.patch('/costing-requests/:id', (req, res) => {
  try {
    const id = idParam(req.params.id);
    const oldRow = getCostingRequestRow(id);
    if (!oldRow) return res.status(404).json({ ok: false, error: '成本核算请求不存在' });
    if (!assertCostingAssignment(req, oldRow)) return res.status(403).json({ error: '无权限更新该成本核算请求' });
    const body = req.body || {};
    const ts = now();
    const nextStatus = Object.prototype.hasOwnProperty.call(body, 'status') ? text(body.status) : '';
    const oldStatus = text(oldRow.status || 'pending');
    if (nextStatus && nextStatus !== oldStatus) {
      const allowed = STATUS_TRANSITIONS[oldStatus] || [];
      if (!allowed.includes(nextStatus)) return res.status(400).json({ ok: false, error: `状态不能从 ${oldStatus} 更新为 ${nextStatus}` });
    }

    const updateBody = { ...body };
    if (nextStatus === 'completed' && !text(updateBody.completed_at)) updateBody.completed_at = ts;
    const fields = [...COSTING_UPDATE_FIELDS];
    if (nextStatus) fields.push('status');
    updateByFields('costing_requests', id, updateBody, fields);
    if (nextStatus === 'completed') {
      db.prepare("UPDATE inquiries SET status = 'costing_completed', next_action = 'Review costing result', updated_at = ? WHERE id = ?").run(ts, oldRow.inquiry_id);
    } else if (nextStatus === 'revision_needed') {
      db.prepare("UPDATE inquiries SET status = 'costing', next_action = 'Revise specification or costing request', updated_at = ? WHERE id = ?").run(ts, oldRow.inquiry_id);
    }

    const action = nextStatus === 'completed'
      ? 'complete_costing_request'
      : nextStatus === 'rejected'
        ? 'reject_costing_request'
        : nextStatus === 'cancelled'
          ? 'cancel_costing_request'
          : (text(body.assigned_to) || Number(body.assigned_to_user_id || 0) ? 'assign_costing_request' : 'update_costing_request');
    crmAudit(req, action, 'crm_costing_request', id, {
      costing_request_id: id,
      inquiry_id: oldRow.inquiry_id,
      customer_id: oldRow.customer_id,
      specification_id: oldRow.specification_id,
      old_status: oldStatus,
      new_status: nextStatus || oldStatus,
      assigned_to: Object.prototype.hasOwnProperty.call(body, 'assigned_to') ? text(body.assigned_to) : oldRow.assigned_to,
      assigned_to_user_id: Object.prototype.hasOwnProperty.call(body, 'assigned_to_user_id') ? Number(body.assigned_to_user_id || 0) : oldRow.assigned_to_user_id
    });
    res.json({ ok: true, costing_request: getCostingRequestRow(id) });
  } catch (err) {
    handleError(res, err, '成本核算请求更新失败');
  }
});

router.get('/inquiries/:id/costing-prefill', (req, res) => {
  try {
    const inquiryId = idParam(req.params.id);
    const inquiry = getInquiry(inquiryId);
    if (!inquiry) return res.status(404).json({ ok: false, error: '询盘不存在' });
    const assignedRequest = db.prepare(`
      SELECT *
      FROM costing_requests
      WHERE inquiry_id = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(inquiryId);
    if (isCostingUser(req) && !assertCostingAssignment(req, assignedRequest || {})) {
      return res.status(403).json({ error: '无权限访问该询盘成本预填数据' });
    }
    const customer = getCustomer(Number(inquiry.customer_id || 0));
    const specificationId = Number(inquiry.latest_specification_id || 0);
    const specification = specificationId ? getSpecification(specificationId) : null;
    const layers = specification?.layers || [];
    res.json({
      ok: true,
      inquiry,
      customer: safeCustomerSummary(customer || {}, !isCostingUser(req)),
      current_specification: specification,
      specification_layers: layers,
      suggested_cost_input: buildSuggestedCostInput(inquiry, specification || {}, layers, assignedRequest || {})
    });
  } catch (err) {
    handleError(res, err, '成本核算预填数据读取失败');
  }
});

function isFreightUser(req) {
  return req.user?.role === 'freight_user';
}

function assertFreightAssignment(req, row) {
  if (!isFreightUser(req)) return true;
  const userName = String(req.user?.userName || '');
  const userId = Number(req.user?.id || 0);
  return Number(row?.assigned_to_user_id || 0) === userId || String(row?.assigned_to || '') === userName;
}

const FREIGHT_FEE_FIELDS = [
  'ocean_freight', 'air_freight', 'trucking_origin', 'trucking_destination',
  'documentation_fee', 'thc_origin', 'thc_destination', 'customs_clearance_fee',
  'duty_tax_estimate', 'destination_local_charge', 'delivery_fee', 'insurance_fee', 'other_fee'
];
const FREIGHT_UPDATE_FIELDS = [
  'assigned_to', 'assigned_to_user_id', 'quote_source', 'forwarder_name', 'forwarder_contact',
  'shipping_mode', 'origin_city', 'origin_port', 'destination_country', 'destination_port',
  'destination_address', 'container_type', 'cargo_weight', 'cargo_volume', 'package_type',
  'package_count', 'trade_term', 'currency', ...FREIGHT_FEE_FIELDS, 'total_freight_cost',
  'valid_from', 'valid_until', 'quote_file_url', 'notes', 'status'
];

function parseMoneyText(value) {
  const raw = String(value || '').replace(/,/g, '').trim();
  if (!raw) return null;
  const match = raw.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const num = Number(match[0]);
  return Number.isFinite(num) ? num : null;
}

function computeFreightTotal(body = {}) {
  const manual = text(body.total_freight_cost);
  if (manual) return manual;
  let total = 0;
  let count = 0;
  FREIGHT_FEE_FIELDS.forEach((field) => {
    const num = parseMoneyText(body[field]);
    if (num === null) return;
    total += num;
    count += 1;
  });
  return count > 0 ? String(total) : '';
}

function generateFreightQuoteCode() {
  const day = now().slice(0, 10).replace(/-/g, '');
  const prefix = `FQ-${day}-`;
  const row = db.prepare('SELECT freight_quote_code FROM freight_quotes WHERE freight_quote_code LIKE ? ORDER BY freight_quote_code DESC LIMIT 1').get(`${prefix}%`);
  const last = row?.freight_quote_code ? Number(String(row.freight_quote_code).slice(prefix.length)) : 0;
  return `${prefix}${String((Number.isFinite(last) ? last : 0) + 1).padStart(4, '0')}`;
}

function getFreightQuoteRow(id) {
  return db.prepare(`
    SELECT
      fq.*,
      COALESCE(NULLIF(c.company_name, ''), NULLIF(c.name, ''), '未命名客户') AS customer_display_name,
      c.country AS customer_country,
      i.inquiry_title,
      i.product_type,
      i.quantity,
      i.destination_country AS inquiry_destination_country,
      i.destination_port AS inquiry_destination_port,
      i.destination_address AS inquiry_destination_address,
      i.trade_term_requested,
      s.bag_type,
      s.film_type,
      s.size_width,
      s.size_height,
      s.gusset_size,
      s.thickness_total,
      s.material_structure_text
    FROM freight_quotes fq
    LEFT JOIN customers c ON c.id = fq.customer_id
    LEFT JOIN inquiries i ON i.id = fq.inquiry_id
    LEFT JOIN inquiry_specifications s ON s.id = i.latest_specification_id
    WHERE fq.id = ?
  `).get(id);
}

function freightChanges(oldRow, body) {
  return FREIGHT_UPDATE_FIELDS
    .filter((field) => Object.prototype.hasOwnProperty.call(body, field))
    .map((field) => ({
      field,
      oldValue: oldRow ? oldRow[field] ?? '' : '',
      newValue: body[field] ?? ''
    }))
    .filter((item) => String(item.oldValue ?? '') !== String(item.newValue ?? ''));
}

router.post('/inquiries/:id/freight-quotes', (req, res) => {
  try {
    const inquiryId = idParam(req.params.id);
    const inquiry = getInquiry(inquiryId);
    if (!inquiry) return res.status(404).json({ ok: false, error: '询盘不存在' });
    const body = req.body || {};
    const ts = now();
    const maxRow = db.prepare('SELECT COALESCE(MAX(version_no), 0) AS max_version FROM freight_quotes WHERE inquiry_id = ?').get(inquiryId);
    const code = generateFreightQuoteCode();
    const total = computeFreightTotal(body);
    const result = db.prepare(`
      INSERT INTO freight_quotes (
        freight_quote_code, customer_id, inquiry_id, assigned_to, assigned_to_user_id, quote_source,
        forwarder_name, forwarder_contact, shipping_mode, origin_city, origin_port, destination_country,
        destination_port, destination_address, container_type, cargo_weight, cargo_volume, package_type,
        package_count, trade_term, currency, ocean_freight, air_freight, trucking_origin,
        trucking_destination, documentation_fee, thc_origin, thc_destination, customs_clearance_fee,
        duty_tax_estimate, destination_local_charge, delivery_fee, insurance_fee, other_fee,
        total_freight_cost, valid_from, valid_until, quote_file_url, notes, status, is_current,
        version_no, created_by, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
    `).run(
      code,
      Number(inquiry.customer_id || 0),
      inquiryId,
      text(body.assigned_to),
      Number(body.assigned_to_user_id || 0) || null,
      text(body.quote_source || 'manual'),
      text(body.forwarder_name),
      text(body.forwarder_contact),
      text(body.shipping_mode || 'sea'),
      text(body.origin_city),
      text(body.origin_port),
      text(body.destination_country || inquiry.destination_country),
      text(body.destination_port || inquiry.destination_port),
      text(body.destination_address || inquiry.destination_address),
      text(body.container_type),
      text(body.cargo_weight),
      text(body.cargo_volume),
      text(body.package_type),
      text(body.package_count),
      text(body.trade_term || inquiry.trade_term_requested),
      text(body.currency || 'RMB'),
      text(body.ocean_freight),
      text(body.air_freight),
      text(body.trucking_origin),
      text(body.trucking_destination),
      text(body.documentation_fee),
      text(body.thc_origin),
      text(body.thc_destination),
      text(body.customs_clearance_fee),
      text(body.duty_tax_estimate),
      text(body.destination_local_charge),
      text(body.delivery_fee),
      text(body.insurance_fee),
      text(body.other_fee),
      total,
      text(body.valid_from),
      text(body.valid_until),
      text(body.quote_file_url),
      text(body.notes),
      text(body.status || 'draft'),
      Number(maxRow?.max_version || 0) + 1,
      req.user.userName,
      ts,
      ts
    );
    const row = getFreightQuoteRow(result.lastInsertRowid);
    crmAudit(req, 'create_freight_quote', 'crm_freight_quote', result.lastInsertRowid, {
      freight_quote_id: result.lastInsertRowid,
      freight_quote_code: code,
      inquiry_id: inquiryId,
      customer_id: inquiry.customer_id,
      old_status: '',
      new_status: row.status,
      changed_fields: [],
      assigned_to: row.assigned_to,
      assigned_to_user_id: row.assigned_to_user_id
    });
    res.json({ ok: true, freight_quote: row });
  } catch (err) {
    handleError(res, err, '物流报价创建失败');
  }
});

router.get('/freight-quotes', (req, res) => {
  try {
    const params = [];
    let where = 'WHERE 1 = 1';
    if (isFreightUser(req)) {
      where += ' AND (fq.assigned_to_user_id = ? OR fq.assigned_to = ?)';
      params.push(Number(req.user.id || 0), String(req.user.userName || ''));
    }
    ['status', 'assigned_to', 'customer_id', 'inquiry_id', 'destination_country', 'destination_port', 'forwarder_name', 'shipping_mode'].forEach((key) => {
      const value = text(req.query[key]);
      if (!value) return;
      where += ` AND fq.${key} = ?`;
      params.push(key.endsWith('_id') ? Number(value) : value);
    });
    const q = text(req.query.q);
    if (q) {
      const like = `%${q}%`;
      where += ' AND (fq.freight_quote_code LIKE ? OR fq.forwarder_name LIKE ? OR c.company_name LIKE ? OR c.name LIKE ? OR i.inquiry_title LIKE ?)';
      params.push(like, like, like, like, like);
    }
    if (text(req.query.date_from)) {
      where += ' AND fq.created_at >= ?';
      params.push(text(req.query.date_from));
    }
    if (text(req.query.date_to)) {
      where += ' AND fq.created_at <= ?';
      params.push(text(req.query.date_to));
    }
    const rows = db.prepare(`
      SELECT
        fq.*,
        COALESCE(NULLIF(c.company_name, ''), NULLIF(c.name, ''), '未命名客户') AS customer_display_name,
        c.country AS customer_country,
        i.inquiry_title,
        i.product_type,
        i.quantity
      FROM freight_quotes fq
      LEFT JOIN customers c ON c.id = fq.customer_id
      LEFT JOIN inquiries i ON i.id = fq.inquiry_id
      ${where}
      ORDER BY fq.updated_at DESC, fq.id DESC
      LIMIT 300
    `).all(...params);
    res.json({ ok: true, rows });
  } catch (err) {
    handleError(res, err, '物流报价列表读取失败');
  }
});

router.get('/freight-quotes/:id', (req, res) => {
  try {
    const id = idParam(req.params.id);
    const row = getFreightQuoteRow(id);
    if (!row) return res.status(404).json({ ok: false, error: '物流报价不存在' });
    if (!assertFreightAssignment(req, row)) return res.status(403).json({ error: '无权限访问该物流报价' });
    const customer = getCustomer(Number(row.customer_id || 0));
    const inquiry = getInquiry(Number(row.inquiry_id || 0));
    const specification = inquiry?.latest_specification_id ? getSpecification(Number(inquiry.latest_specification_id || 0)) : null;
    const auditLogs = db.prepare(`
      SELECT *
      FROM audit_logs
      WHERE resource_type = 'crm_freight_quote' AND resource_id = ?
      ORDER BY id DESC
      LIMIT 100
    `).all(String(id));
    res.json({
      ok: true,
      freight_quote: row,
      customer: safeCustomerSummary(customer || {}, !isFreightUser(req)),
      inquiry,
      current_specification: specification,
      audit_logs: auditLogs
    });
  } catch (err) {
    handleError(res, err, '物流报价详情读取失败');
  }
});

router.patch('/freight-quotes/:id', (req, res) => {
  try {
    const id = idParam(req.params.id);
    const oldRow = getFreightQuoteRow(id);
    if (!oldRow) return res.status(404).json({ ok: false, error: '物流报价不存在' });
    if (!assertFreightAssignment(req, oldRow)) return res.status(403).json({ error: '无权限更新该物流报价' });
    const body = { ...(req.body || {}) };
    if (Object.prototype.hasOwnProperty.call(body, 'total_freight_cost') || FREIGHT_FEE_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(body, field))) {
      body.total_freight_cost = computeFreightTotal({ ...oldRow, ...body });
    }
    const changes = freightChanges(oldRow, body);
    updateByFields('freight_quotes', id, body, FREIGHT_UPDATE_FIELDS);
    const nextStatus = text(body.status || oldRow.status);
    if (nextStatus === 'selected') {
      db.prepare('UPDATE freight_quotes SET is_current = 0, updated_at = ? WHERE inquiry_id = ? AND id <> ?').run(now(), oldRow.inquiry_id, id);
      db.prepare('UPDATE freight_quotes SET is_current = 1, updated_at = ? WHERE id = ?').run(now(), id);
    } else if (nextStatus === 'expired') {
      db.prepare('UPDATE freight_quotes SET is_current = 0, updated_at = ? WHERE id = ?').run(now(), id);
    }
    const action = nextStatus === 'selected'
      ? 'select_freight_quote'
      : nextStatus === 'expired'
        ? 'expire_freight_quote'
        : nextStatus === 'cancelled'
          ? 'cancel_freight_quote'
          : 'update_freight_quote';
    crmAudit(req, action, 'crm_freight_quote', id, {
      freight_quote_id: id,
      freight_quote_code: oldRow.freight_quote_code,
      inquiry_id: oldRow.inquiry_id,
      customer_id: oldRow.customer_id,
      old_status: oldRow.status,
      new_status: nextStatus,
      changed_fields: changes,
      assigned_to: Object.prototype.hasOwnProperty.call(body, 'assigned_to') ? text(body.assigned_to) : oldRow.assigned_to,
      assigned_to_user_id: Object.prototype.hasOwnProperty.call(body, 'assigned_to_user_id') ? Number(body.assigned_to_user_id || 0) : oldRow.assigned_to_user_id
    });
    res.json({ ok: true, freight_quote: getFreightQuoteRow(id) });
  } catch (err) {
    handleError(res, err, '物流报价更新失败');
  }
});

router.get('/inquiries/:id/freight-quotes', (req, res) => {
  try {
    const inquiryId = idParam(req.params.id);
    if (!getInquiry(inquiryId)) return res.status(404).json({ ok: false, error: '询盘不存在' });
    const params = [inquiryId];
    let where = 'WHERE fq.inquiry_id = ?';
    if (isFreightUser(req)) {
      where += ' AND (fq.assigned_to_user_id = ? OR fq.assigned_to = ?)';
      params.push(Number(req.user.id || 0), String(req.user.userName || ''));
    }
    const rows = db.prepare(`
      SELECT
        fq.*,
        COALESCE(NULLIF(c.company_name, ''), NULLIF(c.name, ''), '未命名客户') AS customer_display_name,
        c.country AS customer_country,
        i.inquiry_title,
        i.product_type,
        i.quantity
      FROM freight_quotes fq
      LEFT JOIN customers c ON c.id = fq.customer_id
      LEFT JOIN inquiries i ON i.id = fq.inquiry_id
      ${where}
      ORDER BY fq.is_current DESC, fq.version_no DESC, fq.id DESC
    `).all(...params);
    res.json({ ok: true, rows });
  } catch (err) {
    handleError(res, err, '询盘物流报价读取失败');
  }
});

router.get('/inquiries/:id/freight-prefill', (req, res) => {
  try {
    const inquiryId = idParam(req.params.id);
    const inquiry = getInquiry(inquiryId);
    if (!inquiry) return res.status(404).json({ ok: false, error: '询盘不存在' });
    const customer = getCustomer(Number(inquiry.customer_id || 0));
    const specification = inquiry.latest_specification_id ? getSpecification(Number(inquiry.latest_specification_id || 0)) : null;
    const suggested = {
      destination_country: inquiry.destination_country || '',
      destination_port: inquiry.destination_port || '',
      destination_address: inquiry.destination_address || '',
      quantity: inquiry.quantity || '',
      product_type: inquiry.product_type || specification?.product_type || '',
      shipping_mode: 'sea',
      package_type: '',
      trade_term: inquiry.trade_term_requested || ''
    };
    res.json({
      ok: true,
      inquiry,
      customer: safeCustomerSummary(customer || {}, true),
      current_specification: specification,
      material_structure_text: specification?.material_structure_text || '',
      quantity: inquiry.quantity || '',
      destination_country: inquiry.destination_country || '',
      destination_port: inquiry.destination_port || '',
      destination_address: inquiry.destination_address || '',
      trade_term_requested: inquiry.trade_term_requested || '',
      suggested_freight_input: suggested
    });
  } catch (err) {
    handleError(res, err, '物流费用预填数据读取失败');
  }
});

router.get('/audit-logs', (req, res) => {
  try {
    const resourceType = text(req.query.resourceType);
    const action = text(req.query.action);
    const user = text(req.query.user);
    const params = [];
    let where = "WHERE (resource_type LIKE 'crm_%' OR action IN ('create_customer','update_customer','create_communication_log','create_inquiry','update_inquiry','create_specification_version','create_specification_layer','update_customer_latest_inquiry','create_costing_request','update_costing_request','assign_costing_request','complete_costing_request','reject_costing_request','cancel_costing_request','update_inquiry_costing_status','update_cost_snapshot_crm_link','create_freight_quote','update_freight_quote','select_freight_quote','expire_freight_quote','cancel_freight_quote'))";
    if (resourceType) {
      where += ' AND resource_type = ?';
      params.push(resourceType);
    }
    if (action) {
      where += ' AND action = ?';
      params.push(action);
    }
    if (user) {
      where += ' AND user_name LIKE ?';
      params.push(`%${user}%`);
    }
    const rows = db.prepare(`
      SELECT *
      FROM audit_logs
      ${where}
      ORDER BY id DESC
      LIMIT 300
    `).all(...params);
    res.json({ ok: true, rows });
  } catch (err) {
    handleError(res, err, 'CRM 日志读取失败');
  }
});

router.post('/email/sync', async (req, res) => {
  try {
    const body = req.body || {};
    crmAudit(req, 'email_sync_start', 'crm_email_sync', '', {
      folder: text(body.folder || 'INBOX'),
      days: Number(body.days || 0) || null,
      limit: Number(body.limit || 0) || null
    });
    const result = await syncMailbox({
      folder: text(body.folder || 'INBOX'),
      days: Number(body.days || 0) || undefined,
      limit: Number(body.limit || 0) || undefined,
      operator: req.user.userName
    });
    crmAudit(req, 'email_sync_completed', 'crm_email_sync', result.id, result);
    res.json({
      ok: true,
      sync_run: {
        ...result,
        run_id: result.id,
        error_message: '',
      },
      config_status: safeEmailConfigStatus()
    });
  } catch (err) {
    crmAudit(req, 'email_sync_failed', 'crm_email_sync', err.runId || '', {
      error: text(err.message || err)
    });
    const code = err.code === 'IMAP_ENV_MISSING' || err.code === 'IMAP_DEP_MISSING' ? 400 : 500;
    res.status(code).json({
      ok: false,
      error: text(err.message || '邮件同步失败'),
      sync_run: err.summary ? {
        ...err.summary,
        run_id: err.summary.id,
        error_message: text(err.message || '邮件同步失败')
      } : null,
      config_status: safeEmailConfigStatus(),
      run_id: err.runId || null
    });
  }
});

router.get('/email/sync-runs', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT *
      FROM email_sync_runs
      ORDER BY id DESC
      LIMIT 100
    `).all();
    res.json({ ok: true, rows, config_status: safeEmailConfigStatus() });
  } catch (err) {
    handleError(res, err, '邮件同步记录读取失败');
  }
});

router.get('/email/config-status', (req, res) => {
  try {
    const status = safeEmailConfigStatus();
    if (!status.imapConfigured) {
      return res.status(400).json({
        ok: false,
        error: 'IMAP configuration is incomplete',
        ...status
      });
    }
    res.json({ ok: true, ...status });
  } catch (err) {
    handleError(res, err, 'IMAP 配置状态读取失败');
  }
});

router.get('/email/messages', (req, res) => {
  try {
    const params = [];
    let where = 'WHERE 1 = 1';
    const keyword = text(req.query.keyword);
    if (keyword) {
      const like = `%${keyword}%`;
      where += ' AND (em.subject LIKE ? OR em.from_email LIKE ? OR em.from_name LIKE ? OR em.cleaned_text LIKE ?)';
      params.push(like, like, like, like);
    }
    ['from_email', 'matched_customer_id', 'matched_inquiry_id', 'processing_status', 'direction', 'folder'].forEach((key) => {
      const value = text(req.query[key]);
      if (!value) return;
      where += ` AND em.${key} = ?`;
      params.push(key.endsWith('_id') ? Number(value) : value);
    });
    ['quote_detected', 'inquiry_detected', 'customer_detected'].forEach((key) => {
      const value = text(req.query[key]);
      if (value !== '0' && value !== '1') return;
      where += ` AND em.${key} = ?`;
      params.push(Number(value));
    });
    if (text(req.query.date_from)) {
      where += ' AND COALESCE(em.received_at, em.created_at) >= ?';
      params.push(text(req.query.date_from));
    }
    if (text(req.query.date_to)) {
      where += ' AND COALESCE(em.received_at, em.created_at) <= ?';
      params.push(text(req.query.date_to));
    }
    const rows = db.prepare(`
      SELECT
        em.id, em.mailbox, em.folder, em.message_uid, em.message_id, em.thread_id, em.conversation_key,
        em.from_email, em.from_name, em.contact_email, em.contact_name, em.to_emails, em.cc_emails, em.subject,
        em.cleaned_text, em.sent_at, em.received_at, em.direction, em.processing_status, em.quote_detected,
        em.inquiry_detected, em.customer_detected, em.matched_customer_id, em.matched_inquiry_id, em.created_at, em.updated_at,
        COALESCE(NULLIF(c.company_name, ''), NULLIF(c.name, ''), '未匹配客户') AS matched_customer_name,
        i.inquiry_title AS matched_inquiry_title
      FROM email_messages em
      LEFT JOIN customers c ON c.id = em.matched_customer_id
      LEFT JOIN inquiries i ON i.id = em.matched_inquiry_id
      ${where}
      ORDER BY COALESCE(em.received_at, em.created_at) DESC, em.id DESC
      LIMIT 300
    `).all(...params);
    res.json({ ok: true, rows, config_status: safeEmailConfigStatus() });
  } catch (err) {
    handleError(res, err, '邮件列表读取失败');
  }
});

router.get('/email/messages/:id', (req, res) => {
  try {
    const id = idParam(req.params.id);
    const row = db.prepare(`
      SELECT
        em.*,
        COALESCE(NULLIF(c.company_name, ''), NULLIF(c.name, ''), '未匹配客户') AS matched_customer_name,
        i.inquiry_title AS matched_inquiry_title
      FROM email_messages em
      LEFT JOIN customers c ON c.id = em.matched_customer_id
      LEFT JOIN inquiries i ON i.id = em.matched_inquiry_id
      WHERE em.id = ?
    `).get(id);
    if (!row) return res.status(404).json({ ok: false, error: '邮件不存在' });
    const threadRows = row.conversation_key
      ? db.prepare(`
          SELECT id, subject, from_email, from_name, to_emails, received_at, direction, processing_status,
                 quote_detected, inquiry_detected, SUBSTR(COALESCE(cleaned_text, text_body, ''), 1, 240) AS preview
          FROM email_messages
          WHERE conversation_key = ?
          ORDER BY COALESCE(received_at, created_at) ASC, id ASC
          LIMIT 100
        `).all(row.conversation_key)
      : [];
    const suggestions = db.prepare(`
      SELECT *
      FROM crm_import_suggestions
      WHERE source_type = 'email' AND source_id = ?
      ORDER BY id DESC
    `).all(id);
    res.json({ ok: true, message: row, suggestions, thread: threadRows });
  } catch (err) {
    handleError(res, err, '邮件详情读取失败');
  }
});

router.get('/email/messages/:id/thread', (req, res) => {
  try {
    const id = idParam(req.params.id);
    const message = db.prepare('SELECT id, conversation_key FROM email_messages WHERE id = ?').get(id);
    if (!message) return res.status(404).json({ ok: false, error: '邮件不存在' });
    if (!text(message.conversation_key)) return res.json({ ok: true, rows: [] });
    const rows = db.prepare(`
      SELECT id, subject, from_email, from_name, to_emails, cc_emails, received_at, direction, processing_status,
             quote_detected, inquiry_detected, customer_detected, SUBSTR(COALESCE(cleaned_text, text_body, ''), 1, 240) AS preview
      FROM email_messages
      WHERE conversation_key = ?
      ORDER BY COALESCE(received_at, created_at) ASC, id ASC
    `).all(message.conversation_key);
    res.json({ ok: true, conversation_key: message.conversation_key, rows });
  } catch (err) {
    handleError(res, err, '邮件线程读取失败');
  }
});

router.post('/email/messages/:id/parse', (req, res) => {
  try {
    const id = idParam(req.params.id);
    const message = db.prepare('SELECT * FROM email_messages WHERE id = ?').get(id);
    if (!message) return res.status(404).json({ ok: false, error: '邮件不存在' });
    const result = createSuggestionsFromEmail(message);
    db.prepare(`
      UPDATE email_messages
      SET processing_status = 'parsed', parsed_at = ?, quote_detected = ?, inquiry_detected = ?, customer_detected = ?,
          noise_level = ?, business_relevance = ?, detected_signals_json = ?, parser_hints_json = ?,
          matched_customer_id = COALESCE(?, matched_customer_id), matched_inquiry_id = COALESCE(?, matched_inquiry_id),
          conversation_key = COALESCE(NULLIF(conversation_key, ''), ?), normalized_subject = COALESCE(NULLIF(normalized_subject, ''), ?),
          updated_at = ?
      WHERE id = ?
    `).run(
      now(),
      result.parsed.quoteDetected,
      result.parsed.inquiryDetected,
      result.parsed.customerDetected,
      text(result.parsed.screening?.noise_level || 'low'),
      text(result.parsed.screening?.business_relevance || 'low'),
      JSON.stringify(result.parsed.screening?.detected_signals || {}),
      JSON.stringify(result.parsed.screening?.hints || {}),
      result.parsed.matchedCustomerId,
      result.parsed.matchedInquiryId,
      result.parsed.conversationKey,
      result.parsed.normalizedSubject,
      now(),
      id
    );
    crmAudit(req, 'email_message_parsed', 'crm_email_message', id, {
      suggestion_ids: result.results.map((item) => item.id),
      suggestion_types: result.results.map((item) => item.suggestion_type)
    });
    result.results.forEach((item) => {
      crmAudit(req, 'crm_import_suggestion_created', 'crm_import_suggestion', item.id, {
        source_type: 'email',
        source_id: id,
        suggestion_type: item.suggestion_type
      });
    });
    res.json({ ok: true, suggestion_ids: result.results.map((item) => item.id), created_count: result.results.filter((item) => item.created).length, parsed: result.parsed });
  } catch (err) {
    handleError(res, err, '邮件解析失败');
  }
});

router.post('/email/parse-unprocessed', (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.body?.limit || 50)));
    const rows = db.prepare(`
      SELECT *
      FROM email_messages
      WHERE processing_status IN ('new', 'imported', '')
      ORDER BY COALESCE(received_at, created_at) DESC, id DESC
      LIMIT ?
    `).all(limit);
    const results = rows.map((message) => {
      const result = createSuggestionsFromEmail(message);
      db.prepare(`
        UPDATE email_messages
        SET processing_status = 'parsed', parsed_at = ?, quote_detected = ?, inquiry_detected = ?, customer_detected = ?,
            noise_level = ?, business_relevance = ?, detected_signals_json = ?, parser_hints_json = ?,
            matched_customer_id = COALESCE(?, matched_customer_id), matched_inquiry_id = COALESCE(?, matched_inquiry_id),
            conversation_key = COALESCE(NULLIF(conversation_key, ''), ?), normalized_subject = COALESCE(NULLIF(normalized_subject, ''), ?),
            updated_at = ?
        WHERE id = ?
      `).run(
        now(),
        result.parsed.quoteDetected,
        result.parsed.inquiryDetected,
        result.parsed.customerDetected,
        text(result.parsed.screening?.noise_level || 'low'),
        text(result.parsed.screening?.business_relevance || 'low'),
        JSON.stringify(result.parsed.screening?.detected_signals || {}),
        JSON.stringify(result.parsed.screening?.hints || {}),
        result.parsed.matchedCustomerId,
        result.parsed.matchedInquiryId,
        result.parsed.conversationKey,
        result.parsed.normalizedSubject,
        now(),
        message.id
      );
      return {
        message_id: message.id,
        suggestion_ids: result.results.map((item) => item.id),
        suggestion_types: result.results.map((item) => item.suggestion_type),
        created_count: result.results.filter((item) => item.created).length
      };
    });
    crmAudit(req, 'email_message_parsed', 'crm_email_batch', '', { count: results.length });
    res.json({ ok: true, rows: results });
  } catch (err) {
    handleError(res, err, '批量邮件解析失败');
  }
});

router.get('/import-suggestions', (req, res) => {
  try {
    const params = [];
    let where = 'WHERE 1 = 1';
    ['source_type', 'suggestion_type', 'status', 'matched_customer_id', 'matched_inquiry_id'].forEach((key) => {
      const value = text(req.query[key]);
      if (!value) return;
      where += ` AND cis.${key} = ?`;
      params.push(key.endsWith('_id') ? Number(value) : value);
    });
    const rows = db.prepare(`
      SELECT
        cis.*,
        COALESCE(NULLIF(c.company_name, ''), NULLIF(c.name, ''), '未匹配客户') AS matched_customer_name,
        i.inquiry_title AS matched_inquiry_title
      FROM crm_import_suggestions cis
      LEFT JOIN customers c ON c.id = cis.matched_customer_id
      LEFT JOIN inquiries i ON i.id = cis.matched_inquiry_id
      ${where}
      ORDER BY cis.updated_at DESC, cis.id DESC
      LIMIT 300
    `).all(...params);
    res.json({ ok: true, rows });
  } catch (err) {
    handleError(res, err, '导入建议列表读取失败');
  }
});

router.get('/email/quote-suggestions', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        cis.*,
        em.subject AS source_email_subject,
        em.received_at AS source_email_received_at,
        em.conversation_key AS source_email_conversation_key,
        COALESCE(NULLIF(c.company_name, ''), NULLIF(c.name, ''), '未匹配客户') AS matched_customer_name,
        i.inquiry_title AS matched_inquiry_title
      FROM crm_import_suggestions cis
      LEFT JOIN email_messages em ON em.id = cis.source_id AND cis.source_type = 'email'
      LEFT JOIN customers c ON c.id = cis.matched_customer_id
      LEFT JOIN inquiries i ON i.id = cis.matched_inquiry_id
      WHERE cis.source_type = 'email' AND cis.suggestion_type = 'quotation_draft'
      ORDER BY cis.updated_at DESC, cis.id DESC
      LIMIT 200
    `).all();
    res.json({ ok: true, rows });
  } catch (err) {
    handleError(res, err, '报价建议读取失败');
  }
});

router.get('/import-suggestions/:id', (req, res) => {
  try {
    const id = idParam(req.params.id);
    const row = db.prepare(`
      SELECT
        cis.*,
        em.subject AS source_email_subject,
        em.received_at AS source_email_received_at,
        em.conversation_key AS source_email_conversation_key,
        COALESCE(NULLIF(c.company_name, ''), NULLIF(c.name, ''), '未匹配客户') AS matched_customer_name,
        i.inquiry_title AS matched_inquiry_title
      FROM crm_import_suggestions cis
      LEFT JOIN email_messages em ON em.id = cis.source_id AND cis.source_type = 'email'
      LEFT JOIN customers c ON c.id = cis.matched_customer_id
      LEFT JOIN inquiries i ON i.id = cis.matched_inquiry_id
      WHERE cis.id = ?
    `).get(id);
    if (!row) return res.status(404).json({ ok: false, error: '导入建议不存在' });
    res.json({ ok: true, suggestion: row });
  } catch (err) {
    handleError(res, err, '导入建议详情读取失败');
  }
});

router.get('/import-suggestions/:id/preview', (req, res) => {
  try {
    const id = idParam(req.params.id);
    const row = loadSuggestion(id);
    if (!row) return res.status(404).json({ ok: false, error: '导入建议不存在' });
    const preview = buildSuggestionPreview(row);
    crmAudit(req, 'preview_import_suggestion', 'crm_import_suggestion', id, {
      suggestion_type: row.suggestion_type,
      matched_customer_id: row.matched_customer_id,
      matched_inquiry_id: row.matched_inquiry_id
    });
    res.json({ ok: true, ...preview });
  } catch (err) {
    handleError(res, err, '导入建议预览失败');
  }
});

router.post('/import-suggestions/:id/apply', (req, res) => {
  try {
    const id = idParam(req.params.id);
    const row = loadSuggestion(id);
    if (!row) return res.status(404).json({ ok: false, error: '导入建议不存在' });
    const body = req.body || {};
    const applyFields = Array.isArray(body.apply_fields) ? body.apply_fields.map((item) => text(item)).filter(Boolean) : [];
    const extracted = parseJsonObject(row.extracted_json, {});
    const warnings = [];
    const created = {};
    const reviewNote = text(body.review_note);
    let matchedCustomerId = Number(row.matched_customer_id || 0) || null;
    let matchedInquiryId = Number(row.matched_inquiry_id || 0) || null;

    const tx = db.transaction(() => {
      if (row.suggestion_type === 'customer_profile') {
        const allowedFields = applyFields.filter((field) => CUSTOMER_APPLY_FIELDS.includes(field) && (field !== 'priority' || body.apply_priority === true));
        const customerPayload = {};
        allowedFields.forEach((field) => {
          if (Object.prototype.hasOwnProperty.call(extracted, field)) customerPayload[field] = extracted[field];
        });
        if (matchedCustomerId) {
          if (allowedFields.length && body.allow_update_customer !== false) {
            const oldRow = getCustomer(matchedCustomerId) || {};
            if (customerPayload.company_name) customerPayload.name = customerPayload.company_name;
            updateByFields('customers', matchedCustomerId, customerPayload, [...CUSTOMER_FIELDS, 'name']);
            crmAudit(req, 'update_customer_from_import_suggestion', 'crm_customer', matchedCustomerId, {
              suggestion_id: id,
              apply_fields: allowedFields,
              changes: changesFrom(oldRow, customerPayload, [...CUSTOMER_FIELDS, 'name']),
              review_note: reviewNote
            });
          }
        } else if (body.allow_create_customer === true) {
          const ts = now();
          const companyName = text(customerPayload.company_name || customerPayload.contact_person || customerPayload.email || `邮件客户 ${ts}`);
          const result = db.prepare(`
            INSERT INTO customers (
              salesperson_id, name, company_name, contact_person, email, whatsapp, country, city, website,
              customer_type, industry, main_product, source_channel, customer_summary, risk_notes, next_action,
              active, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
          `).run(
            null, companyName, text(customerPayload.company_name || companyName), text(customerPayload.contact_person), text(customerPayload.email), text(customerPayload.whatsapp),
            text(customerPayload.country), text(customerPayload.city), text(customerPayload.website), text(customerPayload.customer_type),
            text(customerPayload.industry), text(customerPayload.main_product), text(customerPayload.source_channel), text(customerPayload.customer_summary),
            text(customerPayload.risk_notes), text(customerPayload.next_action), ts, ts
          );
          matchedCustomerId = Number(result.lastInsertRowid);
          created.customer_id = matchedCustomerId;
          db.prepare('UPDATE crm_import_suggestions SET matched_customer_id = ?, updated_at = ? WHERE id = ?').run(matchedCustomerId, ts, id);
          crmAudit(req, 'create_customer_from_import_suggestion', 'crm_customer', matchedCustomerId, {
            suggestion_id: id,
            apply_fields: allowedFields,
            review_note: reviewNote
          });
        } else {
          warnings.push('Customer not matched. Set allow_create_customer=true to create a new customer.');
        }
      } else if (row.suggestion_type === 'communication_log') {
        if (body.allow_create_communication_log === true) {
          const customerId = matchedCustomerId || null;
          const result = db.prepare(`
            INSERT INTO communication_logs (
              customer_id, inquiry_id, channel, direction, sender, recipient, subject, raw_content,
              ai_summary, attachments_json, message_id, thread_id, received_at, created_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            customerId,
            matchedInquiryId,
            'email',
            text(extracted.direction || 'unknown'),
            text(extracted.sender),
            text(extracted.recipient),
            text(extracted.subject),
            text(extracted.raw_content || '').slice(0, 4000),
            text(extracted.ai_summary || '').slice(0, 1200),
            '[]',
            text(extracted.message_id || row.source_message_id),
            text(extracted.thread_id),
            text(extracted.received_at || now()),
            req.user.userName,
            now(),
            now()
          );
          created.communication_log_id = Number(result.lastInsertRowid);
          crmAudit(req, 'create_communication_from_import_suggestion', 'crm_communication_log', result.lastInsertRowid, {
            suggestion_id: id,
            matched_customer_id: customerId,
            matched_inquiry_id: matchedInquiryId,
            review_note: reviewNote
          });
        } else {
          warnings.push('allow_create_communication_log=false. Communication log was not created.');
        }
      } else if (row.suggestion_type === 'inquiry') {
        const payload = {};
        applyFields.filter((field) => INQUIRY_APPLY_FIELDS.includes(field)).forEach((field) => {
          if (Object.prototype.hasOwnProperty.call(extracted, field)) payload[field] = extracted[field];
        });
        if (matchedInquiryId) {
          updateByFields('inquiries', matchedInquiryId, payload, INQUIRY_APPLY_FIELDS);
          crmAudit(req, 'update_inquiry_from_import_suggestion', 'crm_inquiry', matchedInquiryId, {
            suggestion_id: id,
            apply_fields: Object.keys(payload),
            review_note: reviewNote
          });
        } else if (body.allow_create_inquiry === true) {
          if (!matchedCustomerId) {
            warnings.push('Inquiry creation requires matched_customer_id.');
          } else {
            const ts = now();
            const result = db.prepare(`
              INSERT INTO inquiries (
                inquiry_code, customer_id, inquiry_title, product_type, application, packaging_type, status, priority,
                quantity, destination_country, destination_port, destination_address, trade_term_requested, customer_target_price,
                missing_info, customer_questions, technical_risks, commercial_risks, costing_required, next_action, created_by, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, 'new', 'C', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
            `).run(
              '',
              matchedCustomerId,
              text(extracted.inquiry_title || 'Email inquiry'),
              text(extracted.product_type),
              text(extracted.application),
              text(extracted.packaging_type),
              text(extracted.quantity),
              text(extracted.destination_country),
              text(extracted.destination_port),
              text(extracted.destination_address),
              text(extracted.trade_term_requested),
              text(extracted.customer_target_price),
              text(extracted.missing_info),
              text(extracted.customer_questions),
              text(extracted.technical_risks),
              text(extracted.commercial_risks),
              text(extracted.next_action),
              req.user.userName,
              ts,
              ts
            );
            matchedInquiryId = Number(result.lastInsertRowid);
            created.inquiry_id = matchedInquiryId;
            db.prepare('UPDATE customers SET latest_inquiry_id = ?, updated_at = ? WHERE id = ?').run(matchedInquiryId, ts, matchedCustomerId);
            db.prepare('UPDATE crm_import_suggestions SET matched_customer_id = ?, matched_inquiry_id = ?, updated_at = ? WHERE id = ?').run(matchedCustomerId, matchedInquiryId, ts, id);
            crmAudit(req, 'create_inquiry_from_import_suggestion', 'crm_inquiry', matchedInquiryId, {
              suggestion_id: id,
              matched_customer_id: matchedCustomerId,
              review_note: reviewNote
            });
          }
        } else {
          warnings.push('Inquiry not matched. Set allow_create_inquiry=true to create a new inquiry.');
        }
      } else if (row.suggestion_type === 'specification') {
        if (!matchedInquiryId) {
          warnings.push('Specification creation requires matched_inquiry_id.');
        } else if (body.allow_create_specification === true) {
          const ts = now();
          const currentMax = db.prepare('SELECT COALESCE(MAX(version_no), 0) AS max_version FROM inquiry_specifications WHERE inquiry_id = ?').get(matchedInquiryId);
          const versionNo = Number(currentMax?.max_version || 0) + 1;
          db.prepare('UPDATE inquiry_specifications SET is_current = 0, updated_at = ? WHERE inquiry_id = ?').run(ts, matchedInquiryId);
          const result = db.prepare(`
            INSERT INTO inquiry_specifications (
              inquiry_id, version_no, is_current, product_type, bag_type, film_type, size_width, size_height,
              gusset_size, roll_width, repeat_length, thickness_total, thickness_unit, material_structure_text,
              printing_colors, surface_finish, zipper_required, valve_required, spout_required, tear_notch_required,
              window_required, filling_weight, packing_machine_type, artwork_status, notes, created_by, created_at, updated_at
            ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            matchedInquiryId, versionNo, text(extracted.product_type), text(extracted.bag_type), text(extracted.film_type),
            text(extracted.size_width), text(extracted.size_height), text(extracted.gusset_size), text(extracted.roll_width),
            text(extracted.repeat_length), text(extracted.thickness_total), text(extracted.thickness_unit),
            text(extracted.material_structure_text), text(extracted.printing_colors), text(extracted.surface_finish),
            intFlag(extracted.zipper_required), intFlag(extracted.valve_required), intFlag(extracted.spout_required),
            intFlag(extracted.tear_notch_required), intFlag(extracted.window_required), text(extracted.filling_weight),
            text(extracted.packing_machine_type), text(extracted.artwork_status), text(extracted.notes), req.user.userName, ts, ts
          );
          const specificationId = Number(result.lastInsertRowid);
          created.specification_id = specificationId;
          db.prepare('UPDATE inquiries SET latest_specification_id = ?, updated_at = ? WHERE id = ?').run(specificationId, ts, matchedInquiryId);
          const layers = Array.isArray(extracted.layers) ? extracted.layers : [];
          layers.forEach((layer, index) => {
            db.prepare(`
              INSERT INTO specification_layers (
                specification_id, layer_order, material_name, material_code, thickness, thickness_unit, layer_role,
                is_customer_required, is_system_suggested, is_confirmed_by_costing, notes, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, '', ?, ?)
            `).run(
              specificationId,
              Number(layer.layer_order || index + 1),
              text(layer.material_name),
              text(layer.material_code),
              text(layer.thickness),
              text(layer.thickness_unit || 'micron'),
              text(layer.layer_role),
              ts,
              ts
            );
          });
          crmAudit(req, 'create_specification_from_import_suggestion', 'crm_specification', specificationId, {
            suggestion_id: id,
            matched_inquiry_id: matchedInquiryId,
            review_note: reviewNote,
            layer_count: layers.length
          });
        } else {
          warnings.push('allow_create_specification=false. Specification was not created.');
        }
      } else if (row.suggestion_type === 'quotation_draft') {
        if (!tableExists('quotations')) {
          warnings.push('Quotation table not available yet.');
        } else if (body.allow_create_quotation !== true) {
          warnings.push('allow_create_quotation=false. Quotation was not created.');
        } else {
          warnings.push('Quotation apply is deferred in this phase.');
        }
      }

      const nextStatus = warnings.length && !Object.keys(created).length && row.suggestion_type === 'quotation_draft' ? 'needs_review' : 'applied';
      if (!(row.suggestion_type === 'quotation_draft' && !tableExists('quotations'))) {
        db.prepare(`
          UPDATE crm_import_suggestions
          SET status = ?, matched_customer_id = COALESCE(?, matched_customer_id), matched_inquiry_id = COALESCE(?, matched_inquiry_id),
              reviewed_by = ?, reviewed_at = ?, updated_at = ?
          WHERE id = ?
        `).run(nextStatus, matchedCustomerId, matchedInquiryId, req.user.userName, now(), now(), id);
      }
      crmAudit(req, 'apply_import_suggestion', 'crm_import_suggestion', id, {
        suggestion_id: id,
        suggestion_type: row.suggestion_type,
        source_type: row.source_type,
        source_id: row.source_id,
        matched_customer_id: matchedCustomerId,
        matched_inquiry_id: matchedInquiryId,
        apply_fields: applyFields,
        created_entity_type: Object.keys(created)[0] || '',
        created_entity_id: Object.values(created)[0] || '',
        warnings,
        review_note: reviewNote
      });
      return { matchedCustomerId, matchedInquiryId, created, warnings };
    });

    const result = tx();
    res.json({
      ok: true,
      applied: !(row.suggestion_type === 'quotation_draft' && !tableExists('quotations')),
      suggestion_id: id,
      suggestion_type: row.suggestion_type,
      matched_customer_id: result.matchedCustomerId,
      matched_inquiry_id: result.matchedInquiryId,
      created: result.created,
      warnings: result.warnings
    });
  } catch (err) {
    handleError(res, err, '导入建议应用失败');
  }
});

router.patch('/import-suggestions/:id', (req, res) => {
  try {
    const id = idParam(req.params.id);
    const oldRow = db.prepare('SELECT * FROM crm_import_suggestions WHERE id = ?').get(id);
    if (!oldRow) return res.status(404).json({ ok: false, error: '导入建议不存在' });
    const status = text(req.body?.status);
    if (!['pending', 'applied', 'rejected', 'ignored', 'needs_review'].includes(status)) {
      return res.status(400).json({ ok: false, error: '无效的建议状态' });
    }
    db.prepare(`
      UPDATE crm_import_suggestions
      SET status = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(status, req.user.userName, now(), now(), id);
    crmAudit(req, status === 'rejected' ? 'reject_import_suggestion' : status === 'ignored' ? 'ignore_import_suggestion' : 'crm_import_suggestion_status_updated', 'crm_import_suggestion', id, {
      old_status: oldRow.status,
      new_status: status
    });
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err, '导入建议状态更新失败');
  }
});

module.exports = router;

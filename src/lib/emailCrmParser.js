const { db, now } = require('../db');

const PRODUCT_PATTERNS = [
  { label: 'pouch', regex: /\bpouch(?:es)?\b/i },
  { label: 'bag', regex: /\bbag(?:s)?\b/i },
  { label: 'roll film', regex: /\broll\s*film\b/i },
  { label: 'retort', regex: /\bretort\b/i },
  { label: 'coffee', regex: /\bcoffee\b/i },
  { label: 'spout', regex: /\bspout\b/i },
  { label: 'stand up', regex: /\bstand\s*up\b/i },
  { label: 'zipper', regex: /\bzipper\b/i },
  { label: 'sachet', regex: /\bsachet\b/i },
  { label: 'packaging', regex: /\bpackaging\b/i },
];

const COUNTRY_PATTERNS = ['bangladesh', 'thailand', 'vietnam', 'indonesia', 'malaysia', 'philippines', 'india', 'pakistan', 'uae', 'saudi', 'egypt'];
const PORT_PATTERNS = ['bangkok', 'chittagong', 'ho chi minh', 'jakarta', 'manila', 'dubai', 'jebel ali', 'cif', 'fob', 'exw', 'ddp'];

function text(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function parseEmails(value) {
  return text(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractDomain(email) {
  const normalized = text(email).toLowerCase();
  const parts = normalized.split('@');
  return parts.length === 2 ? parts[1] : '';
}

function findCustomerByEmailOrDomain(fromEmail) {
  const normalized = text(fromEmail).toLowerCase();
  if (!normalized) return null;
  const direct = db.prepare(`
    SELECT id, company_name, name, email, website, country
    FROM customers
    WHERE LOWER(COALESCE(email, '')) = ?
    LIMIT 1
  `).get(normalized);
  if (direct) return direct;
  const domain = extractDomain(normalized);
  if (!domain) return null;
  return db.prepare(`
    SELECT id, company_name, name, email, website, country
    FROM customers
    WHERE
      LOWER(COALESCE(email, '')) LIKE ?
      OR LOWER(COALESCE(website, '')) LIKE ?
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `).get(`%@${domain}`, `%${domain}%`) || null;
}

function detectKeywords(source) {
  return PRODUCT_PATTERNS
    .filter((item) => item.regex.test(source))
    .map((item) => item.label);
}

function detectQuantity(source) {
  const match = source.match(/\b\d[\d,.\s]*(pcs|pieces|kg|tons|mt|moq)\b/i);
  return match ? match[0].replace(/\s+/g, ' ').trim() : '';
}

function detectCountry(source) {
  const lowered = source.toLowerCase();
  const hit = COUNTRY_PATTERNS.find((item) => lowered.includes(item));
  return hit ? hit.replace(/\b\w/g, (m) => m.toUpperCase()) : '';
}

function detectPort(source) {
  const lowered = source.toLowerCase();
  const hit = PORT_PATTERNS.find((item) => lowered.includes(item));
  if (!hit) return '';
  if (['cif', 'fob', 'exw', 'ddp'].includes(hit)) return '';
  return hit.replace(/\b\w/g, (m) => m.toUpperCase());
}

function detectTradeTerm(source) {
  const match = source.match(/\b(EXW|FOB|CIF|DDP)\b/i);
  return match ? match[1].toUpperCase() : '';
}

function cleanBody(message = {}) {
  const source = text(message.cleaned_text || message.text_body || message.subject);
  return source
    .replace(/^\s*>.*$/gm, '')
    .replace(/^on .+?wrote:.*$/gim, '')
    .replace(/-{2,}\s*original message\s*-{2,}[\s\S]*$/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function summarize(message, extracted) {
  const parts = [];
  if (extracted.contact.from_name || extracted.contact.from_email) {
    parts.push(`发件人 ${extracted.contact.from_name || extracted.contact.from_email}`);
  }
  if (extracted.possible_inquiry.product_type) {
    parts.push(`产品可能为 ${extracted.possible_inquiry.product_type}`);
  }
  if (extracted.possible_inquiry.quantity) {
    parts.push(`数量 ${extracted.possible_inquiry.quantity}`);
  }
  if (extracted.possible_inquiry.destination_country) {
    parts.push(`目的国 ${extracted.possible_inquiry.destination_country}`);
  }
  return parts.join('；') || `邮件主题：${text(message.subject) || '未命名邮件'}`;
}

function buildSuggestion(message) {
  const body = cleanBody(message);
  const fromEmail = text(message.from_email).toLowerCase();
  const fromName = text(message.from_name);
  const domain = extractDomain(fromEmail);
  const matchedCustomer = findCustomerByEmailOrDomain(fromEmail);
  const keywords = detectKeywords(`${message.subject || ''}\n${body}`);
  const quantity = detectQuantity(`${message.subject || ''}\n${body}`);
  const destinationCountry = detectCountry(`${message.subject || ''}\n${body}`);
  const destinationPort = detectPort(`${message.subject || ''}\n${body}`);
  const tradeTerm = detectTradeTerm(`${message.subject || ''}\n${body}`);
  const riskFlags = [];
  const missingInfo = [];
  if (!quantity) missingInfo.push('quantity');
  if (!tradeTerm) missingInfo.push('trade_term');
  if (!destinationCountry) missingInfo.push('destination_country');
  if (!matchedCustomer) riskFlags.push('unmatched_customer');

  const extracted = {
    contact: {
      from_email: fromEmail,
      from_name: fromName,
      email_domain: domain
    },
    possible_customer: {
      company_name: text(matchedCustomer?.company_name || matchedCustomer?.name),
      website: text(matchedCustomer?.website),
      country: text(matchedCustomer?.country || destinationCountry)
    },
    possible_inquiry: {
      product_type: keywords.join(', '),
      packaging_type: keywords.includes('roll film') ? 'roll film' : keywords.join(', '),
      quantity,
      destination_country: destinationCountry,
      destination_port: destinationPort,
      trade_term_requested: tradeTerm
    },
    communication_summary: body.slice(0, 1200),
    risk_flags: riskFlags,
    missing_info: missingInfo,
    next_action: matchedCustomer ? 'Review and attach to existing customer profile' : 'Review and create/match customer profile manually'
  };

  return {
    matchedCustomerId: Number(matchedCustomer?.id || 0) || null,
    matchedInquiryId: null,
    extracted,
    summary: summarize(message, extracted),
    riskFlags: riskFlags.join(','),
    rawInput: body,
    confidence: matchedCustomer ? 'medium' : 'low',
    suggestionType: matchedCustomer ? 'communication_log' : 'customer_profile'
  };
}

function createSuggestionFromEmail(message, operator = 'system') {
  const parsed = buildSuggestion(message);
  const ts = now();
  const existing = db.prepare(`
    SELECT id
    FROM crm_import_suggestions
    WHERE source_type = 'email' AND source_id = ? AND suggestion_type = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(message.id, parsed.suggestionType);
  if (existing) {
    db.prepare(`
      UPDATE crm_import_suggestions
      SET matched_customer_id = ?, matched_inquiry_id = ?, extracted_json = ?, suggested_updates_json = ?,
          risk_flags = ?, summary = ?, raw_input = ?, updated_at = ?
      WHERE id = ?
    `).run(
      parsed.matchedCustomerId,
      parsed.matchedInquiryId,
      JSON.stringify(parsed.extracted),
      JSON.stringify(parsed.extracted),
      parsed.riskFlags,
      parsed.summary,
      parsed.rawInput,
      ts,
      existing.id
    );
    return { id: existing.id, created: false, parsed };
  }

  const result = db.prepare(`
    INSERT INTO crm_import_suggestions (
      source_type, source_id, suggestion_type, status, confidence, matched_customer_id, matched_inquiry_id,
      extracted_json, suggested_updates_json, risk_flags, summary, raw_input, created_at, updated_at
    )
    VALUES ('email', ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    message.id,
    parsed.suggestionType,
    parsed.confidence,
    parsed.matchedCustomerId,
    parsed.matchedInquiryId,
    JSON.stringify(parsed.extracted),
    JSON.stringify(parsed.extracted),
    parsed.riskFlags,
    parsed.summary,
    parsed.rawInput,
    ts,
    ts
  );
  return { id: result.lastInsertRowid, created: true, parsed };
}

module.exports = {
  cleanBody,
  buildSuggestion,
  createSuggestionFromEmail
};

const { db, now } = require('../db');
const { computeConversationKey, extractDomain, normalizeSubject } = require('./imapSync');

const PRODUCT_PATTERNS = [
  { label: 'roll film', regex: /\broll\s*film\b/i },
  { label: 'stand up pouch', regex: /\bstand[\s-]*up\b.*\bpouch\b|\bpouch\b.*\bstand[\s-]*up\b/i },
  { label: 'coffee pouch', regex: /\bcoffee\b.*\bpouch|\bpouch\b.*\bcoffee\b/i },
  { label: 'spout pouch', regex: /\bspout\b.*\bpouch|\bpouch\b.*\bspout\b/i },
  { label: 'zipper pouch', regex: /\bzipper\b.*\bpouch|\bpouch\b.*\bzipper\b/i },
  { label: 'retort pouch', regex: /\bretort\b.*\bpouch|\bpouch\b.*\bretort\b/i },
  { label: 'sachet', regex: /\bsachet\b/i },
  { label: 'bag', regex: /\bbag(?:s)?\b/i },
  { label: 'pouch', regex: /\bpouch(?:es)?\b/i },
  { label: 'packaging', regex: /\bpackaging\b/i },
];

const PACKAGING_PATTERNS = [
  { label: 'stand_up_zipper_bag', regex: /\bstand[\s-]*up\b|\bzipper\b/i },
  { label: 'spout_pouch', regex: /\bspout\b/i },
  { label: 'roll_film', regex: /\broll\s*film\b/i },
  { label: 'retort_pouch', regex: /\bretort\b/i },
  { label: 'three_side_seal', regex: /\bthree[\s-]*side\b/i },
];

const COUNTRY_PATTERNS = ['bangladesh', 'thailand', 'vietnam', 'indonesia', 'malaysia', 'philippines', 'india', 'pakistan', 'uae', 'saudi', 'egypt', 'china'];
const PORT_PATTERNS = ['bangkok', 'chittagong', 'ho chi minh', 'jakarta', 'manila', 'dubai', 'jebel ali', 'nhava sheva', 'singapore'];
const TRADE_TERMS = ['EXW', 'FOB', 'CIF', 'CFR', 'DDP', 'DAP', 'FCA'];
const QUOTE_KEYWORDS = /\b(quote|quotation|quoted|报价|单价|总价|unit price|total amount|per piece|\/pc|\/pcs|each|usd|rmb|cny|eur|gbp|freight|shipping cost|ocean freight|clearance|duty|tax|thc|tooling fee|cylinder fee|sample fee)\b/i;
const CUSTOMER_HINTS = /\b(company|website|whatsapp|phone|address|buyer|contact|联系人|公司|网站)\b/i;

function text(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (_) {
    return '{}';
  }
}

function titleCase(value) {
  return text(value).replace(/\b\w/g, (m) => m.toUpperCase());
}

function parseEmails(value) {
  return text(value)
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
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

function pickContactEmail(message = {}) {
  const mailbox = text(message.mailbox).toLowerCase();
  const candidates = [
    text(message.from_email).toLowerCase(),
    ...parseEmails(message.to_emails),
    ...parseEmails(message.cc_emails),
  ].filter(Boolean);
  return candidates.find((item) => item !== mailbox) || candidates[0] || '';
}

function pickContactName(message = {}) {
  return text(message.contact_name || message.from_name || '');
}

function extractPhoneLike(source) {
  const match = text(source).match(/(\+?\d[\d\s\-()]{6,}\d)/);
  return match ? text(match[1]).replace(/\s+/g, ' ') : '';
}

function extractWhatsapp(source) {
  const match = text(source).match(/(?:whatsapp|wa)[:\s]*([+0-9][\d\s\-()]{6,})/i);
  return match ? text(match[1]).replace(/\s+/g, ' ') : '';
}

function detectKeywords(source, patterns) {
  return patterns.filter((item) => item.regex.test(source)).map((item) => item.label);
}

function detectQuantity(source) {
  const match = text(source).match(/\b\d[\d,.\s]*(pcs|pieces|kg|tons|mt|moq|bags|rolls)\b/i);
  return match ? text(match[0]).replace(/\s+/g, ' ') : '';
}

function detectCountry(source) {
  const lowered = text(source).toLowerCase();
  const hit = COUNTRY_PATTERNS.find((item) => lowered.includes(item));
  return hit ? titleCase(hit) : '';
}

function detectPort(source) {
  const lowered = text(source).toLowerCase();
  const hit = PORT_PATTERNS.find((item) => lowered.includes(item));
  return hit ? titleCase(hit) : '';
}

function detectTradeTerm(source) {
  const match = text(source).match(/\b(EXW|FOB|CIF|CFR|DDP|DAP|FCA)\b/i);
  return match ? match[1].toUpperCase() : '';
}

function extractMaterialStructure(source) {
  const patterns = [
    /\b(?:PET|BOPP|CPP|PE|VMPET|AL|RCPP|PA|NY|MET\s*BOPP)[\d./+\sA-Z-]{0,80}(?:PE|CPP|AL|VMPET|PA|RCPP|BOPP)\d*\b/i,
    /\b(?:PET|BOPP|CPP|PE|VMPET|AL|RCPP|PA|NY|MET\s*BOPP)\s*\d+\s*(?:\/|\+)\s*(?:PET|BOPP|CPP|PE|VMPET|AL|RCPP|PA|NY|MET\s*BOPP)\s*\d+(?:\s*(?:\/|\+)\s*(?:PET|BOPP|CPP|PE|VMPET|AL|RCPP|PA|NY|MET\s*BOPP)\s*\d+){0,4}\b/i
  ];
  for (const regex of patterns) {
    const match = text(source).match(regex);
    if (match) return text(match[0]).replace(/\s+/g, ' ');
  }
  return '';
}

function extractLayers(materialStructure) {
  const structure = text(materialStructure);
  if (!structure) return [];
  if (!/[\/+]/.test(structure)) return [];
  const segments = structure.split(/[\/+]/).map((item) => item.trim()).filter(Boolean);
  return segments.map((segment, index) => {
    const matched = segment.match(/([A-Z ]+?)(\d+(?:\.\d+)?)/i);
    if (!matched) return null;
    return {
      layer_order: index + 1,
      material_name: text(matched[1]).replace(/\s+/g, ' ').toUpperCase(),
      thickness: text(matched[2]),
      thickness_unit: 'micron'
    };
  }).filter(Boolean);
}

function detectDimensions(source) {
  const match = text(source).match(/\b(\d{2,4})\s*[xX*]\s*(\d{2,4})(?:\s*[xX*+]\s*(\d{2,4}))?/);
  if (!match) return {};
  return {
    size_width: text(match[1]),
    size_height: text(match[2]),
    gusset_size: text(match[3])
  };
}

function detectThickness(source) {
  const match = text(source).match(/\b(\d{2,4}(?:\.\d+)?)\s*(mic|micron|um|μm)\b/i);
  if (!match) return {};
  return { thickness_total: text(match[1]), thickness_unit: 'micron' };
}

function detectPrintingColors(source) {
  const match = text(source).match(/\b(\d{1,2})\s*(colors|colour|colours|色)\b/i);
  return match ? text(match[1]) : '';
}

function extractWebsite(source) {
  const match = text(source).match(/https?:\/\/[^\s]+|www\.[^\s]+/i);
  return match ? text(match[0]) : '';
}

function extractPriceFields(source) {
  const value = text(source);
  const currencyMatch = value.match(/\b(USD|RMB|CNY|EUR|GBP)\b/i);
  const tradeTerm = detectTradeTerm(value);
  const unitPriceMatch = value.match(/(?:unit price|price|quoted at|offer(?:ed)? at|单价|报价)[:\s]*([A-Z$¥€£ ]{0,6}\d+(?:\.\d+)?)(?:\s*(?:\/|per)\s*([a-zA-Z]+))?/i);
  const totalAmountMatch = value.match(/(?:total amount|total|总价)[:\s]*([A-Z$¥€£ ]{0,6}\d+(?:\.\d+)?)/i);
  const fobMatch = value.match(/\bFOB\b[^0-9]{0,10}([A-Z$¥€£ ]{0,6}\d+(?:\.\d+)?)/i);
  const exwMatch = value.match(/\bEXW\b[^0-9]{0,10}([A-Z$¥€£ ]{0,6}\d+(?:\.\d+)?)/i);
  const cifMatch = value.match(/\bCIF\b[^0-9]{0,10}([A-Z$¥€£ ]{0,6}\d+(?:\.\d+)?)/i);
  const ddpMatch = value.match(/\bDDP\b[^0-9]{0,10}([A-Z$¥€£ ]{0,6}\d+(?:\.\d+)?)/i);
  const freightMatch = value.match(/(?:freight|shipping cost|ocean freight)[:\s]*([A-Z$¥€£ ]{0,6}\d+(?:\.\d+)?)/i);
  const clearanceMatch = value.match(/(?:clearance|customs|duty|tax|local charge|delivery fee|trucking|thc)[:\s]*([A-Z$¥€£ ]{0,6}\d+(?:\.\d+)?)/i);
  const toolingMatch = value.match(/(?:tooling fee|cylinder fee|sample fee)[:\s]*([A-Z$¥€£ ]{0,6}\d+(?:\.\d+)?)/i);
  const paymentTermsMatch = value.match(/(?:payment terms|deposit|balance|t\/t)[:\s]*([^\n]+)/i);
  const leadTimeMatch = value.match(/(?:lead time|production time|delivery time)[:\s]*([^\n]+)/i);
  const validityMatch = value.match(/(?:validity|quote valid|valid until)[:\s]*([^\n]+)/i);
  return {
    quote_detected: QUOTE_KEYWORDS.test(value),
    quote_currency: currencyMatch ? currencyMatch[1].toUpperCase() : '',
    quote_unit: unitPriceMatch?.[2] ? text(unitPriceMatch[2]) : '',
    trade_term: tradeTerm,
    unit_price: unitPriceMatch ? text(unitPriceMatch[1]) : '',
    total_amount: totalAmountMatch ? text(totalAmountMatch[1]) : '',
    exw_price: exwMatch ? text(exwMatch[1]) : '',
    fob_price: fobMatch ? text(fobMatch[1]) : '',
    cif_price: cifMatch ? text(cifMatch[1]) : '',
    ddp_price: ddpMatch ? text(ddpMatch[1]) : '',
    freight_cost: freightMatch ? text(freightMatch[1]) : '',
    clearance_cost: clearanceMatch ? text(clearanceMatch[1]) : '',
    tooling_fee: toolingMatch ? text(toolingMatch[1]) : '',
    payment_terms: paymentTermsMatch ? text(paymentTermsMatch[1]) : '',
    lead_time: leadTimeMatch ? text(leadTimeMatch[1]) : '',
    validity_date: validityMatch ? text(validityMatch[1]) : '',
  };
}

function findCustomerCandidates(message, body) {
  const contactEmail = pickContactEmail(message);
  const domain = extractDomain(contactEmail);
  const subject = text(message.subject);
  const exact = db.prepare(`
    SELECT id, company_name, name, email, contact_person, website, country, city
    FROM customers
    WHERE LOWER(COALESCE(email, '')) = ?
    LIMIT 1
  `).get(contactEmail);
  if (exact) return { matchedCustomer: exact, confidence: 'high' };
  if (Number(message.matched_customer_id || 0) > 0) {
    const row = db.prepare(`SELECT id, company_name, name, email, contact_person, website, country, city FROM customers WHERE id = ?`).get(Number(message.matched_customer_id));
    if (row) return { matchedCustomer: row, confidence: 'high' };
  }
  if (domain) {
    const byDomain = db.prepare(`
      SELECT id, company_name, name, email, contact_person, website, country, city
      FROM customers
      WHERE LOWER(COALESCE(email, '')) LIKE ? OR LOWER(COALESCE(website, '')) LIKE ?
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `).get(`%@${domain}`, `%${domain}%`);
    if (byDomain) return { matchedCustomer: byDomain, confidence: 'medium' };
  }
  const source = `${subject}\n${body}`.toLowerCase();
  const rows = db.prepare(`
    SELECT id, company_name, name, email, contact_person, website, country, city
    FROM customers
    WHERE COALESCE(active, 1) = 1
    ORDER BY updated_at DESC, id DESC
    LIMIT 200
  `).all();
  const fuzzy = rows.find((row) => {
    return [row.company_name, row.name, row.contact_person]
      .filter(Boolean)
      .some((part) => source.includes(String(part).toLowerCase()));
  });
  return { matchedCustomer: fuzzy || null, confidence: fuzzy ? 'low' : 'low' };
}

function findInquiryCandidate(customerId, subject, body) {
  const normalizedCustomerId = Number(customerId || 0);
  if (!normalizedCustomerId) return null;
  const source = `${text(subject)}\n${text(body)}`.toLowerCase();
  const inquiries = db.prepare(`
    SELECT id, inquiry_title, product_type, packaging_type, quantity, destination_country
    FROM inquiries
    WHERE customer_id = ?
    ORDER BY updated_at DESC, id DESC
    LIMIT 100
  `).all(normalizedCustomerId);
  return inquiries.find((row) => {
    return [row.inquiry_title, row.product_type, row.packaging_type, row.destination_country, row.quantity]
      .filter(Boolean)
      .some((part) => source.includes(String(part).toLowerCase()));
  }) || null;
}

function buildCustomerSuggestion(message, extracted, matchedCustomerId, confidence) {
  const contactEmail = pickContactEmail(message);
  const domain = extractDomain(contactEmail);
  const summary = `邮件客户线索：${extracted.company_name || contactEmail || '未识别客户'}，联系人 ${extracted.contact_person || '未识别'}。`;
  return {
    suggestionType: 'customer_profile',
    confidence,
    matchedCustomerId,
    matchedInquiryId: null,
    extracted,
    suggestedUpdates: { ...extracted, email_domain: domain, source_channel: 'email' },
    summary,
    rawInput: cleanBody(message).slice(0, 3000),
    riskFlags: matchedCustomerId ? '' : 'unmatched_customer'
  };
}

function buildInquirySuggestion(message, extracted, matchedCustomerId, matchedInquiryId, confidence) {
  return {
    suggestionType: 'inquiry',
    confidence,
    matchedCustomerId,
    matchedInquiryId,
    extracted,
    suggestedUpdates: extracted,
    summary: `邮件询盘线索：${extracted.inquiry_title || extracted.product_type || '未命名询盘'}。`,
    rawInput: cleanBody(message).slice(0, 3000),
    riskFlags: text(extracted.missing_info)
  };
}

function buildCommunicationSuggestion(message, matchedCustomerId, matchedInquiryId, confidence) {
  const body = cleanBody(message);
  return {
    suggestionType: 'communication_log',
    confidence,
    matchedCustomerId,
    matchedInquiryId,
    extracted: {
      channel: 'email',
      direction: text(message.direction || 'unknown'),
      sender: text(message.from_name || message.from_email),
      recipient: text(message.to_emails),
      subject: text(message.subject),
      raw_content: body.slice(0, 4000),
      ai_summary: body.slice(0, 600),
      message_id: text(message.message_id),
      thread_id: text(message.conversation_key || message.thread_id),
      received_at: text(message.received_at || message.sent_at),
      source_type: 'email',
      source_id: message.id
    },
    suggestedUpdates: {},
    summary: `邮件沟通记录：${text(message.subject || '(无主题)')}`,
    rawInput: body.slice(0, 3000),
    riskFlags: matchedCustomerId ? '' : 'customer_not_confirmed'
  };
}

function buildSpecificationSuggestion(message, extracted, matchedCustomerId, matchedInquiryId, confidence) {
  return {
    suggestionType: 'specification',
    confidence,
    matchedCustomerId,
    matchedInquiryId,
    extracted,
    suggestedUpdates: extracted,
    summary: `邮件规格线索：${extracted.material_structure_text || extracted.bag_type || '规格待确认'}。`,
    rawInput: cleanBody(message).slice(0, 3000),
    riskFlags: ''
  };
}

function buildQuotationSuggestion(message, extracted, matchedCustomerId, matchedInquiryId, confidence) {
  return {
    suggestionType: 'quotation_draft',
    confidence,
    matchedCustomerId,
    matchedInquiryId,
    extracted,
    suggestedUpdates: extracted,
    summary: `邮件报价线索：${extracted.trade_term || '未识别条款'} ${extracted.unit_price || extracted.total_amount || '未识别价格'}。`,
    rawInput: cleanBody(message).slice(0, 3000),
    riskFlags: extracted.quote_detected ? '' : 'quote_unconfirmed'
  };
}

function buildSuggestions(message) {
  const body = cleanBody(message);
  const source = `${text(message.subject)}\n${body}`;
  const contactEmail = pickContactEmail(message);
  const contactName = pickContactName(message);
  const domain = extractDomain(contactEmail);
  const { matchedCustomer, confidence } = findCustomerCandidates(message, body);
  const matchedCustomerId = Number(matchedCustomer?.id || 0) || null;
  const matchedInquiry = findInquiryCandidate(matchedCustomerId, message.subject, body);
  const matchedInquiryId = Number(message.matched_inquiry_id || matchedInquiry?.id || 0) || null;
  const products = detectKeywords(source, PRODUCT_PATTERNS);
  const packaging = detectKeywords(source, PACKAGING_PATTERNS);
  const quantity = detectQuantity(source);
  const destinationCountry = detectCountry(source);
  const destinationPort = detectPort(source);
  const tradeTerm = detectTradeTerm(source);
  const materialStructure = extractMaterialStructure(source);
  const layers = extractLayers(materialStructure);
  const dimensions = detectDimensions(source);
  const thickness = detectThickness(source);
  const printingColors = detectPrintingColors(source);
  const quoteFields = extractPriceFields(source);
  const companyName = text(matchedCustomer?.company_name || matchedCustomer?.name || contactName || domain.split('.')[0]);
  const website = extractWebsite(source) || text(matchedCustomer?.website);
  const phone = extractPhoneLike(source);
  const whatsapp = extractWhatsapp(source);
  const customerExtracted = {
    company_name: companyName,
    contact_person: contactName,
    email: contactEmail,
    whatsapp,
    phone,
    country: text(matchedCustomer?.country || destinationCountry),
    city: text(matchedCustomer?.city),
    website,
    customer_type: '',
    industry: '',
    main_product: products.join(', '),
    source_channel: 'email',
    customer_summary: text(body).slice(0, 500),
    risk_notes: matchedCustomerId ? '' : '邮件尚未可靠匹配到正式客户',
    next_action: matchedCustomerId ? 'Review suggestion and merge into existing customer if needed' : 'Review customer candidate and confirm whether to create a new customer'
  };
  const inquiryExtracted = {
    inquiry_title: text(message.subject || `${products[0] || 'Email'} inquiry`),
    product_type: products.join(', '),
    application: '',
    packaging_type: packaging[0] || products.join(', '),
    quantity,
    destination_country: destinationCountry,
    destination_port: destinationPort,
    destination_address: '',
    trade_term_requested: tradeTerm,
    customer_target_price: '',
    missing_info: [!quantity && 'quantity', !tradeTerm && 'trade_term', !destinationCountry && 'destination_country'].filter(Boolean).join(', '),
    customer_questions: '',
    technical_risks: materialStructure ? '' : 'material_structure_not_confirmed',
    commercial_risks: matchedCustomerId ? '' : 'customer_match_pending',
    next_action: 'Review extracted inquiry and confirm whether to create/update CRM inquiry'
  };
  const specificationExtracted = {
    bag_type: packaging.includes('stand_up_zipper_bag') ? 'stand_up_zipper_bag' : '',
    film_type: packaging.includes('roll_film') ? 'roll_film' : '',
    ...dimensions,
    roll_width: '',
    repeat_length: '',
    ...thickness,
    material_structure_text: materialStructure,
    printing_colors: printingColors,
    surface_finish: '',
    zipper_required: /\bzipper\b/i.test(source),
    valve_required: /\bvalve\b/i.test(source),
    spout_required: /\bspout\b/i.test(source),
    tear_notch_required: /\btear notch\b/i.test(source),
    window_required: /\bwindow\b/i.test(source),
    filling_weight: '',
    packing_machine_type: '',
    artwork_status: '',
    notes: '',
    layers
  };
  const quotationExtracted = {
    quote_detected: quoteFields.quote_detected,
    quoted_by_us: text(message.direction) === 'outbound',
    received_supplier_quote: false,
    quote_currency: quoteFields.quote_currency,
    quote_unit: quoteFields.quote_unit || 'pcs',
    trade_term: quoteFields.trade_term || tradeTerm,
    exw_price: quoteFields.exw_price,
    fob_price: quoteFields.fob_price,
    cif_price: quoteFields.cif_price,
    ddp_price: quoteFields.ddp_price,
    unit_price: quoteFields.unit_price,
    total_amount: quoteFields.total_amount,
    quantity,
    moq: '',
    tooling_fee: quoteFields.tooling_fee,
    cylinder_fee: '',
    sample_fee: '',
    freight_cost: quoteFields.freight_cost,
    clearance_cost: quoteFields.clearance_cost,
    local_delivery_fee: '',
    payment_terms: quoteFields.payment_terms,
    lead_time: quoteFields.lead_time,
    validity_date: quoteFields.validity_date,
    destination_country: destinationCountry,
    destination_port: destinationPort,
    remarks: '',
    related_product: products[0] || '',
    source_email_id: message.id
  };

  const suggestions = [];
  if (contactEmail || CUSTOMER_HINTS.test(source)) {
    suggestions.push(buildCustomerSuggestion(message, customerExtracted, matchedCustomerId, confidence));
  }
  suggestions.push(buildCommunicationSuggestion(message, matchedCustomerId, matchedInquiryId, matchedCustomerId ? 'high' : 'medium'));
  if (products.length || quantity || destinationCountry || tradeTerm) {
    suggestions.push(buildInquirySuggestion(message, inquiryExtracted, matchedCustomerId, matchedInquiryId, matchedInquiryId ? 'medium' : confidence));
  }
  if (materialStructure || Object.keys(dimensions).length || printingColors || /\b(zipper|spout|valve|roll film|thickness)\b/i.test(source)) {
    suggestions.push(buildSpecificationSuggestion(message, specificationExtracted, matchedCustomerId, matchedInquiryId, 'medium'));
  }
  if (quotationExtracted.quote_detected) {
    suggestions.push(buildQuotationSuggestion(message, quotationExtracted, matchedCustomerId, matchedInquiryId, 'medium'));
  }
  return {
    matchedCustomerId,
    matchedInquiryId,
    conversationKey: computeConversationKey(message),
    normalizedSubject: normalizeSubject(message.subject),
    quoteDetected: quotationExtracted.quote_detected ? 1 : 0,
    inquiryDetected: suggestions.some((item) => item.suggestionType === 'inquiry' || item.suggestionType === 'specification') ? 1 : 0,
    customerDetected: suggestions.some((item) => item.suggestionType === 'customer_profile') ? 1 : 0,
    suggestions
  };
}

function upsertSuggestion(messageId, suggestion) {
  const ts = now();
  const existing = db.prepare(`
    SELECT id
    FROM crm_import_suggestions
    WHERE source_type = 'email' AND source_id = ? AND suggestion_type = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(messageId, suggestion.suggestionType);
  if (existing) {
    db.prepare(`
      UPDATE crm_import_suggestions
      SET status = 'pending', confidence = ?, matched_customer_id = ?, matched_inquiry_id = ?, extracted_json = ?,
          suggested_updates_json = ?, risk_flags = ?, summary = ?, raw_input = ?, updated_at = ?
      WHERE id = ?
    `).run(
      suggestion.confidence,
      suggestion.matchedCustomerId,
      suggestion.matchedInquiryId,
      safeJson(suggestion.extracted),
      safeJson(suggestion.suggestedUpdates),
      text(suggestion.riskFlags),
      text(suggestion.summary),
      text(suggestion.rawInput),
      ts,
      existing.id
    );
    return { id: existing.id, created: false };
  }
  const result = db.prepare(`
    INSERT INTO crm_import_suggestions (
      source_type, source_id, suggestion_type, status, confidence, matched_customer_id, matched_inquiry_id,
      extracted_json, suggested_updates_json, risk_flags, summary, raw_input, created_at, updated_at
    )
    VALUES ('email', ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    messageId,
    suggestion.suggestionType,
    suggestion.confidence,
    suggestion.matchedCustomerId,
    suggestion.matchedInquiryId,
    safeJson(suggestion.extracted),
    safeJson(suggestion.suggestedUpdates),
    text(suggestion.riskFlags),
    text(suggestion.summary),
    text(suggestion.rawInput),
    ts,
    ts
  );
  return { id: result.lastInsertRowid, created: true };
}

function createSuggestionsFromEmail(message) {
  const parsed = buildSuggestions(message);
  const results = parsed.suggestions.map((suggestion) => ({
    suggestion_type: suggestion.suggestionType,
    ...upsertSuggestion(message.id, suggestion)
  }));
  return { parsed, results };
}

module.exports = {
  cleanBody,
  buildSuggestions,
  createSuggestionsFromEmail
};

'use strict';

const { classifyRecord, isApprovedCountry, REASON_CODES, RULESET_VERSION } = require('./schemaRank');

const DOMESTIC_COUNTRIES = new Set([
  'china', 'cn', 'prc', "people's republic of china", '中国', '中国大陆', '中华人民共和国'
]);
const AUTOMATED_SENDER = /(?:^|[._-])(no[._-]?reply|do[._-]?not[._-]?reply|mailer[._-]?daemon|postmaster)(?:@|[._-]|$)/i;
const SYSTEM_NOTICE = /(?:security alert|account verification|verify your account|delivery failure|undeliverable|automated (?:report|notice)|machine notification)/i;
const FIXTURE_MARKER = /(?:\btoken test\b|\bhello token ok\b|token-verification|sync verification|fixture (?:mailbox|payload))/i;
const BUSINESS_SIGNAL = /(?:inquir|quot|packag|pouch|film|bag|specification|material|dimension|size|product|coffee|snack|detergent|refill)/i;
const INQUIRY_SIGNAL = /\b(?:inquir(?:y|e)|need|require|request)\b/i;
const QUOTE_SIGNAL = /\b(?:quot(?:e|ation)|price)\b/i;
const UNSUBSCRIBE_SIGNAL = /\b(?:unsubscribe|remove me|opt[ -]?out)\b/i;
const REFUSAL_SIGNAL = /\b(?:do not contact|don't contact|not interested|no interest|stop contacting)\b/i;
const INVALID_ADDRESS_SIGNAL = /\b(?:invalid (?:recipient|address)|undeliverable|unknown recipient|address rejected)\b/i;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function lower(value) {
  return text(value).toLowerCase();
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function rows(db, table) {
  return tableExists(db, table) ? db.prepare(`SELECT * FROM ${table} ORDER BY id`).all() : [];
}

function normalizePhone(value) {
  const raw = text(value);
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  return raw.startsWith('+') ? `+${digits}` : digits;
}

function internationalPhone(value) {
  const phone = normalizePhone(value);
  return /^\+[1-9]\d{7,14}$/.test(phone) && !phone.startsWith('+86');
}

function emailDomain(value) {
  const match = lower(value).match(/^[^@\s]+@([^@\s]+)$/);
  return match ? match[1].replace(/^www\./, '') : '';
}

function websiteDomain(value) {
  const raw = text(value);
  if (!raw) return '';
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function canonicalTime(value) {
  const raw = text(value);
  if (!raw) return '';
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(' ', 'T')}Z`
    : raw;
}

function strictSourceTime(value) {
  const candidate = canonicalTime(value);
  if (!candidate) return false;
  const match = candidate.match(/^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (calendarDate.getUTCFullYear() !== year
    || calendarDate.getUTCMonth() !== month - 1
    || calendarDate.getUTCDate() !== day) return false;
  return !candidate.includes('T') || !Number.isNaN(Date.parse(candidate));
}

function normalizedTime(value) {
  const raw = text(value);
  if (!raw) return '';
  const candidate = canonicalTime(raw);
  return strictSourceTime(candidate) ? candidate : raw;
}

function isDomestic(customer) {
  const country = lower(customer?.country);
  if (DOMESTIC_COUNTRIES.has(country)) return true;
  const phone = normalizePhone(customer?.whatsapp || customer?.phone);
  const domain = emailDomain(customer?.email);
  return Boolean(phone.startsWith('+86') || (domain && domain.endsWith('.cn')));
}

function customerHasOverseasEvidence(customer) {
  if (!customer) return false;
  const country = lower(customer.country);
  return Boolean(
    (country && !DOMESTIC_COUNTRIES.has(country))
    || (emailDomain(customer.email) && !emailDomain(customer.email).endsWith('.cn'))
    || internationalPhone(customer.whatsapp || customer.phone)
  );
}

function jsonAddressList(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  const raw = text(value);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(text).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function internalAddressConfig(options = {}) {
  const mailboxes = new Set([
    ...(Array.isArray(options.internalMailboxes) ? options.internalMailboxes : []),
    process.env.SMTP_USER,
    process.env.SMTP_FROM
  ].map(lower).filter(Boolean));
  const domains = new Set([
    ...(Array.isArray(options.internalDomains) ? options.internalDomains : []),
    process.env.MATRIX_INTERNAL_DOMAINS
  ].flatMap(value => text(value).split(',')).map(value => lower(value).replace(/^@/, '')).filter(Boolean));
  return { mailboxes, domains };
}

function emailHasOnlyInternalParticipants(row, config) {
  const participants = [
    text(row.from_email),
    ...jsonAddressList(row.to_emails),
    ...jsonAddressList(row.cc_emails),
    ...jsonAddressList(row.bcc_emails)
  ].map(lower).filter(Boolean);
  return participants.length > 0 && participants.every(address => {
    const domain = emailDomain(address);
    return config.mailboxes.has(address) || (domain && config.domains.has(domain));
  });
}

function groupHasOverseasEvidence(group) {
  return customerHasOverseasEvidence(group.customer)
    || group.crmMessages.some(row => internationalPhone(crmExternalContact(row)))
    || group.emailMessages.some(row => {
      const domain = emailDomain(row.contact_email || row.from_email);
      return Boolean(domain && !domain.endsWith('.cn'));
    });
}

function repeatedSegments(value) {
  const segments = text(value)
    .split(/\r?\n+/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length >= 3);
  return new Set(segments).size < segments.length;
}

function substantiallyOverlaps(left, right) {
  const tokens = (value) => lower(value).match(/[\p{L}\p{N}]+/gu) || [];
  const shingles = (items) => new Set(items.slice(0, -2).map((_, index) => items.slice(index, index + 3).join(' ')));
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (Math.min(leftTokens.length, rightTokens.length) < 5) return false;
  const leftShingles = shingles(leftTokens);
  const rightShingles = shingles(rightTokens);
  const smaller = leftShingles.size <= rightShingles.size ? leftShingles : rightShingles;
  const larger = smaller === leftShingles ? rightShingles : leftShingles;
  let shared = 0;
  for (const shingle of smaller) if (larger.has(shingle)) shared += 1;
  return smaller.size > 0 && shared / smaller.size >= 0.6;
}

function crmExternalContact(row) {
  return lower(row.direction) === 'outbound'
    ? text(row.receiver_contact)
    : text(row.sender_contact);
}

function identityKey(kind, row, customer) {
  if (customer?.id != null) return `customer:${customer.id}`;
  const contact = kind === 'email'
    ? lower(row.contact_email || row.from_email)
    : normalizePhone(crmExternalContact(row));
  return contact ? `${kind}:${contact}` : `${kind}-record:${row.id}`;
}

function createGroup(key, customer) {
  return {
    identity_id: key,
    customer,
    crmMessages: [],
    emailMessages: []
  };
}

function addToGroup(groups, key, customer, kind, row) {
  if (!groups.has(key)) groups.set(key, createGroup(key, customer));
  const group = groups.get(key);
  if (!group.customer && customer) group.customer = customer;
  (kind === 'email' ? group.emailMessages : group.crmMessages).push(row);
}

function groupTime(group) {
  const values = [
    ...group.crmMessages.map((row) => row.received_at || row.created_at),
    ...group.emailMessages.map((row) => row.received_at || row.sent_at || row.created_at),
    group.customer?.last_contact_at,
    group.customer?.updated_at
  ].map(normalizedTime).filter(Boolean);
  return values.sort().at(-1) || '';
}

function hasMalformedTime(group) {
  const rowsToCheck = [group.customer, ...group.crmMessages, ...group.emailMessages].filter(Boolean);
  const values = rowsToCheck.flatMap((row) => Object.entries(row)
    .filter(([key, value]) => key.endsWith('_at')
      && value !== null
      && value !== undefined
      && String(value).trim())
    .map(([, value]) => value));
  return values.some((value) => !strictSourceTime(value));
}

function hasMalformedJson(group) {
  const values = [
    ...group.crmMessages.flatMap((row) => [row.raw_payload_json, row.attachments_json]),
    ...group.emailMessages.flatMap((row) => [
      row.raw_headers_json,
      row.detected_signals_json,
      row.parser_hints_json,
      row.attachments_json,
      row.to_emails,
      row.cc_emails,
      row.bcc_emails
    ])
  ].map(text).filter(Boolean);
  return values.some((value) => {
    try { JSON.parse(value); return false; } catch { return true; }
  });
}

function hasFixtureMarker(group) {
  const values = [
    group.customer?.name, group.customer?.company_name,
    ...group.crmMessages.flatMap(row => [row.source_message_id, row.message_text, row.raw_payload_json]),
    ...group.emailMessages.flatMap(row => [row.message_id, row.from_email, row.subject, row.text_body, row.cleaned_text])
  ];
  return values.some(value => FIXTURE_MARKER.test(text(value)));
}

function crmFixtureRow(row, customer) {
  return FIXTURE_MARKER.test([
    customer?.name, customer?.company_name, row.source_message_id, row.message_text, row.raw_payload_json
  ].map(text).join(' '));
}

function emailFixtureRow(row, customer) {
  return FIXTURE_MARKER.test([
    customer?.name, customer?.company_name, row.message_id, row.from_email,
    row.subject, row.text_body, row.cleaned_text
  ].map(text).join(' '));
}

function systemEmailRow(row) {
  const sender = row.contact_email || row.from_email;
  const content = `${text(row.subject)} ${text(row.cleaned_text || row.text_body)}`;
  return AUTOMATED_SENDER.test(text(sender)) || SYSTEM_NOTICE.test(content) || lower(row.noise_level) === 'high';
}

function isSystemGroup(group) {
  return group.emailMessages.some((row) => {
    const sender = row.contact_email || row.from_email;
    const content = `${text(row.subject)} ${text(row.cleaned_text || row.text_body)}`;
    return AUTOMATED_SENDER.test(text(sender))
      || SYSTEM_NOTICE.test(content)
      || lower(row.noise_level) === 'high';
  });
}

function businessEvidence(group) {
  const customer = group.customer || {};
  const evidence = [customer.main_product, customer.industry, customer.business_background]
    .map(text).filter(Boolean);
  const substantive = group.crmMessages.some((row) => BUSINESS_SIGNAL.test(text(row.message_text)))
    || group.emailMessages.some((row) => lower(row.business_relevance) === 'high'
      || Number(row.inquiry_detected) === 1
      || Number(row.quote_detected) === 1
      || BUSINESS_SIGNAL.test(`${text(row.subject)} ${text(row.cleaned_text || row.text_body)}`));
  return substantive ? [...evidence, 'substantive_conversation'] : evidence;
}

function groupContent(group) {
  return [
    ...group.crmMessages.map((row) => row.message_text),
    ...group.emailMessages.flatMap((row) => [row.subject, row.cleaned_text || row.text_body])
  ].map(text).filter(Boolean).join(' ');
}

function normalizeGroup(group, options = {}) {
  const customer = group.customer || {};
  const latestEmail = group.emailMessages.at(-1);
  const latestCrm = group.crmMessages.at(-1);
  const businessEmail = text(customer.email || latestEmail?.contact_email || latestEmail?.from_email);
  const whatsapp = text(customer.whatsapp || customer.phone || crmExternalContact(latestCrm || {}));
  const sourceKind = group.crmMessages.some((row) => lower(row.source_type) === 'whatsapp') ? 'whatsapp' : 'email';
  const officialDomain = websiteDomain(customer.website) || emailDomain(businessEmail);
  const lastInteraction = groupTime(group);
  const rawMessageContents = [
    ...group.crmMessages.map((row) => row.message_text),
    ...group.emailMessages.map((row) => row.cleaned_text || row.text_body)
  ].filter((value) => text(value));
  const messageContents = rawMessageContents.map((value) => lower(value).replace(/\s+/g, ' '));
  const duplicate = rawMessageContents.some(repeatedSegments)
    || new Set(messageContents).size < messageContents.length
    || rawMessageContents.some((left, index) => rawMessageContents
      .slice(index + 1).some((right) => substantiallyOverlaps(left, right)));
  const internalIdentity = customer.id != null
    ? `customer:${customer.id}`
    : group.crmMessages.length
      ? `crm-message:${Math.min(...group.crmMessages.map((row) => Number(row.id)))}`
      : `email-message:${Math.min(...group.emailMessages.map((row) => Number(row.id)))}`;
  const content = groupContent(group);
  const sourceIds = {
    customer_ids: customer.id == null ? [] : [customer.id],
    crm_message_ids: group.crmMessages.map((row) => row.id),
    email_message_ids: group.emailMessages.map((row) => row.id)
  };
  const evidenceRefs = [
    ...sourceIds.customer_ids.map((id) => `customer:${id}`),
    ...sourceIds.crm_message_ids.map((id) => `crm-message:${id}`),
    ...sourceIds.email_message_ids.map((id) => `email-message:${id}`)
  ];
  const allMessages = [...group.crmMessages, ...group.emailMessages];
  const internalConfig = internalAddressConfig(options);
  const internalOnly = allMessages.length > 0
    && allMessages.every((row) => lower(row.direction) === 'internal'
      || (group.emailMessages.includes(row) && emailHasOnlyInternalParticipants(row, internalConfig)));

  return {
    identity_id: internalIdentity,
    country: text(customer.country),
    official_domain: officialDomain,
    business_email: businessEmail,
    sender_name: lower(latestCrm?.direction) === 'outbound' ? '' : text(latestCrm?.sender_name || customer.contact_person),
    sender_phone: normalizePhone(whatsapp),
    source_kind: isSystemGroup(group) ? REASON_CODES.SECURITY_NOTICE : sourceKind,
    fixture_marker: hasFixtureMarker(group) ? 'known-verification-artifact' : '',
    product_evidence: businessEvidence(group),
    inquiry_evidence: INQUIRY_SIGNAL.test(content) ? evidenceRefs : [],
    quote_evidence: QUOTE_SIGNAL.test(content) ? evidenceRefs : [],
    substantive_interaction: BUSINESS_SIGNAL.test(content),
    evidence_refs: evidenceRefs,
    last_interaction_at: lastInteraction,
    duplicated_message_segments: duplicate,
    has_malformed_source_time: hasMalformedTime(group),
    has_malformed_json_payload: hasMalformedJson(group),
    uncertain_direction: group.crmMessages.some((row) => {
      const direction = lower(row.direction);
      return lower(row.source_type) === 'whatsapp' && !['inbound', 'outbound'].includes(direction);
    }),
    confirmed_international_whatsapp: internationalPhone(whatsapp),
    overseas_eligible: groupHasOverseasEvidence(group),
    internal_only: internalOnly,
    unsubscribe: UNSUBSCRIBE_SIGNAL.test(content),
    refusal: REFUSAL_SIGNAL.test(content),
    invalid_address: INVALID_ADDRESS_SIGNAL.test(content),
    delivery_failure: /\b(?:delivery failure|hard bounce|mailer daemon)\b/i.test(content),
    source_ids: sourceIds,
    private_contact: businessEmail || whatsapp || ''
  };
}

function readEligibleCrmRecords(db, options = {}) {
  const customers = rows(db, 'customers');
  const crmMessages = rows(db, 'crm_messages');
  const emailMessages = rows(db, 'email_messages');
  const customerById = new Map(customers.map((row) => [Number(row.id), row]));
  const linkedCustomerIds = new Set([
    ...crmMessages
      .filter((row) => {
        const contact = crmExternalContact(row);
        return FIXTURE_MARKER.test(`${text(row.sender_name)} ${text(row.message_text)} ${text(row.raw_payload_json)}`)
          || (lower(row.source_type) === 'whatsapp' && internationalPhone(contact));
      })
      .map((row) => Number(row.customer_id)).filter(Number.isFinite),
    ...emailMessages
      .filter((row) => {
        const domain = emailDomain(row.contact_email || row.from_email);
        return domain && !domain.endsWith('.cn');
      })
      .map((row) => Number(row.matched_customer_id)).filter(Number.isFinite)
  ]);
  const excludedDomesticIds = customers
    .filter((customer) => (isDomestic(customer) && !customerHasOverseasEvidence(customer))
      || (!customerHasOverseasEvidence(customer) && !linkedCustomerIds.has(Number(customer.id))))
    .map((row) => row.id);
  const excludedSet = new Set(excludedDomesticIds.map(Number));
  const groups = new Map();

  for (const customer of customers) {
    if (excludedSet.has(Number(customer.id)) || !customerHasOverseasEvidence(customer)) continue;
    const key = identityKey('customer', {}, customer);
    if (!groups.has(key)) groups.set(key, createGroup(key, customer));
  }

  for (const row of crmMessages) {
    const customer = customerById.get(Number(row.customer_id));
    if (crmFixtureRow(row, customer)) {
      addToGroup(groups, `fixture-crm:${row.id}`, customer, 'crm', row);
      continue;
    }
    if (customer && excludedSet.has(Number(customer.id))) {
      if (lower(row.source_type) === 'whatsapp' && !crmExternalContact(row)) {
        addToGroup(groups, identityKey('crm', row, null), null, 'crm', row);
      }
      continue;
    }
    addToGroup(groups, identityKey('crm', row, customer), customer, 'crm', row);
  }

  for (const row of emailMessages) {
    const customer = customerById.get(Number(row.matched_customer_id));
    if (emailFixtureRow(row, customer)) {
      addToGroup(groups, `fixture-email:${row.id}`, customer, 'email', row);
      continue;
    }
    if (systemEmailRow(row)) {
      addToGroup(groups, `system-email:${row.id}`, customer, 'email', row);
      continue;
    }
    if (customer && excludedSet.has(Number(customer.id))) continue;
    addToGroup(groups, identityKey('email', row, customer), customer, 'email', row);
  }

  return {
    records: [...groups.values()].map(group => normalizeGroup(group, options)),
    excluded_domestic_ids: excludedDomesticIds
  };
}

function classifyNormalizedRecord(record, context, classifier = classifyRecord) {
  const base = classifier(record, { ...context, scope: 'existing_crm' });
  let result = base;

  const safetyReasons = [];
  if (record.duplicated_message_segments) safetyReasons.push(REASON_CODES.DUPLICATED_MESSAGE_SEGMENTS);
  if (record.has_malformed_source_time) safetyReasons.push(REASON_CODES.MALFORMED_SOURCE_TIME);
  if (record.has_malformed_json_payload) safetyReasons.push(REASON_CODES.MALFORMED_JSON_PAYLOAD);
  if (record.uncertain_direction) safetyReasons.push(REASON_CODES.UNCERTAIN_DIRECTION);
  if (result.classification === 'valid' && !record.product_evidence.length) {
    safetyReasons.push(REASON_CODES.MISSING_BUSINESS_EVIDENCE);
  }
  const reasons = [...new Set([...result.reason_codes, ...safetyReasons])];
  if (!['test', 'noise'].includes(result.classification) && safetyReasons.length) {
    return { classification: 'needs_review', priority: null, reason_codes: reasons, confidence: 0.5 };
  }
  return { ...result, reason_codes: reasons };
}

function classifyCurrentCrm(db, options = {}) {
  const normalized = readEligibleCrmRecords(db, options);
  const counts = {
    input: normalized.records.length,
    excluded_domestic: normalized.excluded_domestic_ids.length,
    test: 0,
    noise: 0,
    needs_review: 0,
    valid: 0,
    errors: 0
  };
  const includePrivate = options.includePrivatePreview === true
    && options.authenticatedLocalOperator === true;
  const classifier = typeof options.classifier === 'function' ? options.classifier : classifyRecord;
  const records = [];

  for (const record of normalized.records) {
    try {
      const classification = classifyNormalizedRecord(record, { now: options.now }, classifier);
      counts[classification.classification] += 1;
      const output = {
        identity_id: record.identity_id,
        source_ids: record.source_ids,
        classification: classification.classification,
        priority: classification.priority,
        reason_codes: classification.reason_codes,
        confidence: classification.confidence
      };
      if (includePrivate) output.private_preview = { contact: record.private_contact };
      records.push(output);
    } catch {
      counts.errors += 1;
      counts.needs_review += 1;
      records.push({
        identity_id: record.identity_id,
        source_ids: record.source_ids,
        classification: 'needs_review',
        priority: null,
        reason_codes: [REASON_CODES.CLASSIFICATION_ERROR],
        confidence: 0
      });
    }
  }

  return {
    ruleset_version: RULESET_VERSION,
    counts,
    excluded_domestic_ids: normalized.excluded_domestic_ids,
    records
  };
}

module.exports = {
  readEligibleCrmRecords,
  classifyCurrentCrm
};

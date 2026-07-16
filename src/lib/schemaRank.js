'use strict';

const RULESET_VERSION = '1.1.0';

const APPROVED_COUNTRIES = Object.freeze([
  'Vietnam',
  'Thailand',
  'Malaysia',
  'Indonesia',
  'Philippines',
  'Kazakhstan'
]);

const EXCLUDED_COUNTRIES = Object.freeze([
  'India'
]);

const REASON_CODES = Object.freeze({
  FIXTURE_MARKER: 'fixture_marker',
  SECURITY_NOTICE: 'security_notice',
  EXCLUDED_COUNTRY: 'excluded_country',
  UNAPPROVED_COUNTRY: 'unapproved_country',
  MISSING_IDENTITY: 'missing_identity',
  AMBIGUOUS_CONTACT: 'ambiguous_contact',
  UNKNOWN_WHATSAPP_SENDER: 'unknown_whatsapp_sender',
  MALFORMED_SOURCE_TIME: 'malformed_source_time',
  CONFLICTING_DOMAINS: 'conflicting_domains',
  APPROVED_COUNTRY: 'approved_country',
  OFFICIAL_DOMAIN: 'official_domain',
  PRODUCT_EVIDENCE: 'product_evidence',
  VALID_SOURCE_TIME: 'valid_source_time',
  CONFIRMED_INTERNATIONAL_WHATSAPP: 'confirmed_international_whatsapp',
  BUSINESS_EVIDENCE: 'business_evidence',
  DUPLICATED_MESSAGE_SEGMENTS: 'duplicated_message_segments',
  MALFORMED_JSON_PAYLOAD: 'malformed_json_payload',
  UNCERTAIN_DIRECTION: 'uncertain_direction',
  MISSING_BUSINESS_EVIDENCE: 'missing_business_evidence',
  MISSING_EVIDENCE_REFERENCES: 'missing_evidence_references',
  HISTORICAL_INQUIRY: 'historical_inquiry',
  HISTORICAL_QUOTE: 'historical_quote',
  SUBSTANTIVE_INTERACTION: 'substantive_interaction',
  COMPANY_EVIDENCE: 'company_evidence',
  INTERNAL_ONLY: 'internal_only',
  UNSUBSCRIBE: 'unsubscribe',
  REFUSAL: 'refusal',
  INVALID_ADDRESS: 'invalid_address',
  DELIVERY_FAILURE: 'delivery_failure',
  CLASSIFICATION_ERROR: 'classification_error'
});
const PUBLIC_REASON_CODES = Object.freeze(Object.values(REASON_CODES));

const approvedCountryKeys = new Set(APPROVED_COUNTRIES.map(normalizeCountry));
const excludedCountryKeys = new Set(EXCLUDED_COUNTRIES.map(normalizeCountry));
const AMBIGUOUS_CONTACT_DOMAINS = Object.freeze([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'qq.com',
  'yahoo.com'
]);
const ambiguousContactDomainKeys = new Set(AMBIGUOUS_CONTACT_DOMAINS);

function normalizeCountry(country) {
  return typeof country === 'string'
    ? country.trim().toLowerCase().replace(/\s+/g, ' ')
    : '';
}

function isApprovedCountry(country) {
  return approvedCountryKeys.has(normalizeCountry(country));
}

function emailDomain(email) {
  if (typeof email !== 'string') return '';
  const match = email.trim().toLowerCase().match(/^[^@\s]+@([^@\s]+)$/);
  return match ? match[1].replace(/^www\./, '') : '';
}

function normalizeDomain(domain) {
  return typeof domain === 'string'
    ? domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
    : '';
}

function domainsMatch(left, right) {
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
}

function validDate(value) {
  if (typeof value !== 'string') return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (calendarDate.getUTCFullYear() !== year
    || calendarDate.getUTCMonth() !== month - 1
    || calendarDate.getUTCDate() !== day) {
    return false;
  }

  return !value.includes('T') || !Number.isNaN(Date.parse(value));
}

function isAmbiguousContactDomain(domain) {
  return domain.split('.')[0] === 'example' || ambiguousContactDomainKeys.has(domain);
}

function hasIdentityValue(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function result(classification, priority, reasonCodes, confidence) {
  return {
    classification,
    priority,
    reason_codes: reasonCodes,
    confidence
  };
}

function classifyRecord(record = {}, context = {}) {
  const countryKey = normalizeCountry(record.country);
  const officialDomain = normalizeDomain(record.official_domain);
  const contactDomain = emailDomain(record.business_email);

  if (record.fixture_marker) {
    return result('test', null, [REASON_CODES.FIXTURE_MARKER], 1);
  }

  const noiseReasons = [];
  if (record.source_kind === REASON_CODES.SECURITY_NOTICE) noiseReasons.push(REASON_CODES.SECURITY_NOTICE);
  if (excludedCountryKeys.has(countryKey)) noiseReasons.push(REASON_CODES.EXCLUDED_COUNTRY);
  if (record.internal_only) noiseReasons.push(REASON_CODES.INTERNAL_ONLY);
  if (record.unsubscribe) noiseReasons.push(REASON_CODES.UNSUBSCRIBE);
  if (record.refusal) noiseReasons.push(REASON_CODES.REFUSAL);
  if (record.invalid_address) noiseReasons.push(REASON_CODES.INVALID_ADDRESS);
  if (record.delivery_failure) noiseReasons.push(REASON_CODES.DELIVERY_FAILURE);
  if (noiseReasons.length) {
    return result('noise', null, noiseReasons, 1);
  }

  const reviewReasons = [];
  if (!countryKey || !approvedCountryKeys.has(countryKey)) reviewReasons.push(REASON_CODES.UNAPPROVED_COUNTRY);
  const confirmedWhatsapp = record.confirmed_international_whatsapp === true
    && hasIdentityValue(record.sender_phone);
  const usableEmail = Boolean(contactDomain && !isAmbiguousContactDomain(contactDomain));
  if (!usableEmail && !confirmedWhatsapp) reviewReasons.push(REASON_CODES.MISSING_IDENTITY);
  if (contactDomain && isAmbiguousContactDomain(contactDomain)) reviewReasons.push(REASON_CODES.AMBIGUOUS_CONTACT);
  if (record.source_kind === 'whatsapp'
    && !hasIdentityValue(record.sender_name)
    && !hasIdentityValue(record.sender_phone)) {
    reviewReasons.push(REASON_CODES.UNKNOWN_WHATSAPP_SENDER);
  }
  if (record.last_interaction_at && !validDate(record.last_interaction_at)) {
    reviewReasons.push(REASON_CODES.MALFORMED_SOURCE_TIME);
  }
  if (officialDomain && usableEmail && !domainsMatch(officialDomain, contactDomain)) {
    reviewReasons.push(REASON_CODES.CONFLICTING_DOMAINS);
  }

  const productEvidence = Array.isArray(record.product_evidence)
    && record.product_evidence.some(hasIdentityValue);
  const companyEvidence = Array.isArray(record.company_evidence)
    && record.company_evidence.some(hasIdentityValue);
  const inquiryEvidence = Array.isArray(record.inquiry_evidence)
    && record.inquiry_evidence.some(hasIdentityValue);
  const quoteEvidence = Array.isArray(record.quote_evidence)
    && record.quote_evidence.some(hasIdentityValue);
  const substantive = record.substantive_interaction === true;
  if (!productEvidence && !companyEvidence && !inquiryEvidence && !quoteEvidence && !substantive) {
    reviewReasons.push(REASON_CODES.MISSING_BUSINESS_EVIDENCE);
  }
  if (!Array.isArray(record.evidence_refs) || !record.evidence_refs.some(hasIdentityValue)) {
    reviewReasons.push(REASON_CODES.MISSING_EVIDENCE_REFERENCES);
  }

  if (reviewReasons.length) {
    return result('needs_review', null, [...new Set(reviewReasons)], 0.5);
  }

  const validReasons = [REASON_CODES.APPROVED_COUNTRY];
  if (usableEmail) validReasons.push(REASON_CODES.OFFICIAL_DOMAIN);
  if (confirmedWhatsapp) validReasons.push(REASON_CODES.CONFIRMED_INTERNATIONAL_WHATSAPP);
  if (productEvidence) validReasons.push(REASON_CODES.PRODUCT_EVIDENCE);
  if (companyEvidence) validReasons.push(REASON_CODES.COMPANY_EVIDENCE);
  if (inquiryEvidence) validReasons.push(REASON_CODES.HISTORICAL_INQUIRY);
  if (quoteEvidence) validReasons.push(REASON_CODES.HISTORICAL_QUOTE);
  if (substantive) validReasons.push(REASON_CODES.SUBSTANTIVE_INTERACTION);
  if (record.last_interaction_at && validDate(record.last_interaction_at)) {
    validReasons.push(REASON_CODES.VALID_SOURCE_TIME);
  }

  const now = validDate(context.now) ? Date.parse(context.now) : NaN;
  const interaction = validDate(record.last_interaction_at) ? Date.parse(record.last_interaction_at) : NaN;
  const recent = !Number.isNaN(now) && !Number.isNaN(interaction)
    && now >= interaction && now - interaction <= 30 * 24 * 60 * 60 * 1000;

  const priorityA = recent && productEvidence && substantive && (inquiryEvidence || quoteEvidence);
  const priority = priorityA ? 'A' : productEvidence ? 'B' : 'C';
  return result('valid', priority, validReasons, priorityA ? 0.95 : priority === 'B' ? 0.85 : 0.7);
}

module.exports = {
  classifyRecord,
  isApprovedCountry,
  APPROVED_COUNTRIES,
  EXCLUDED_COUNTRIES,
  REASON_CODES,
  PUBLIC_REASON_CODES,
  RULESET_VERSION
};

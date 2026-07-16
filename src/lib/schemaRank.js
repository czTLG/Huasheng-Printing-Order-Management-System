'use strict';

const RULESET_VERSION = '1.0.0';

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
    return result('test', 'C', ['fixture_marker'], 1);
  }

  if (record.source_kind === 'security_notice' || excludedCountryKeys.has(countryKey)) {
    const reason = record.source_kind === 'security_notice' ? 'security_notice' : 'excluded_country';
    return result('noise', 'C', [reason], 1);
  }

  const reviewReasons = [];
  if (!countryKey || !approvedCountryKeys.has(countryKey)) reviewReasons.push('unapproved_country');
  if (!officialDomain || !contactDomain) reviewReasons.push('missing_identity');
  if (contactDomain && isAmbiguousContactDomain(contactDomain)) reviewReasons.push('ambiguous_contact');
  if (record.source_kind === 'whatsapp'
    && !hasIdentityValue(record.sender_name)
    && !hasIdentityValue(record.sender_phone)) {
    reviewReasons.push('unknown_whatsapp_sender');
  }
  if (record.last_interaction_at && !validDate(record.last_interaction_at)) {
    reviewReasons.push('malformed_source_time');
  }
  if (officialDomain && contactDomain && !domainsMatch(officialDomain, contactDomain)) {
    reviewReasons.push('conflicting_domains');
  }

  if (reviewReasons.length) {
    return result('needs_review', 'B', reviewReasons, 0.5);
  }

  const validReasons = ['approved_country', 'official_domain'];
  if (Array.isArray(record.product_evidence) && record.product_evidence.length) {
    validReasons.push('product_evidence');
  }
  if (record.last_interaction_at && validDate(record.last_interaction_at)) {
    validReasons.push('valid_source_time');
  }

  const now = validDate(context.now) ? Date.parse(context.now) : NaN;
  const interaction = validDate(record.last_interaction_at) ? Date.parse(record.last_interaction_at) : NaN;
  const recent = !Number.isNaN(now) && !Number.isNaN(interaction)
    && now >= interaction && now - interaction <= 30 * 24 * 60 * 60 * 1000;

  return result('valid', recent ? 'A' : 'B', validReasons, recent ? 0.95 : 0.85);
}

module.exports = {
  classifyRecord,
  isApprovedCountry,
  APPROVED_COUNTRIES,
  EXCLUDED_COUNTRIES,
  RULESET_VERSION
};

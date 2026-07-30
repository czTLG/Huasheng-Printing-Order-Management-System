'use strict';

const PUBLIC_MAILBOX_PROVIDERS = new Set([
  'gmail.com',
  'hotmail.com',
  'live.com',
  'outlook.com',
  'yahoo.com'
]);
const CORROBORATION_SOURCE_CLASSES = new Set([
  'government',
  'industry_association',
  'official_exhibition'
]);

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function exactKeys(value, allowed, required, label) {
  const item = object(value, label);
  const accepted = new Set(allowed);
  for (const key of Object.keys(item)) if (!accepted.has(key)) throw new Error(`${label} has unknown field: ${key}`);
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(item, key)) throw new Error(`${label} missing field: ${key}`);
  return item;
}

function text(value, label, maximum = 500) {
  const result = String(value == null ? '' : value).trim();
  if (!result || [...result].length > maximum) throw new Error(`${label} must be non-empty text`);
  return result;
}

function domain(value, label = 'domain') {
  const result = String(value || '').trim().toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(result)) throw new Error(`${label} is invalid`);
  return result;
}

function httpsUrl(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be a public HTTPS URL`); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || !host.includes('.') || /^(?:localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(host)) {
    throw new Error(`${label} must be a public HTTPS URL`);
  }
  return url;
}

function onDomain(url, expectedDomain) {
  const host = url.hostname.toLowerCase();
  return host === expectedDomain || host.endsWith(`.${expectedDomain}`);
}

function recent(value, now, label, maximumDays) {
  const parsed = Date.parse(String(value || ''));
  const current = Date.parse(String(now || ''));
  const age = current - parsed;
  if (!Number.isFinite(parsed) || !Number.isFinite(current) || age < 0 || age > maximumDays * 86400000) {
    throw new Error(`${label} evidence is stale`);
  }
  return new Date(parsed).toISOString();
}

function normalizedName(value) {
  return text(value, 'organization name', 160).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function validateRecipientProvenance(input, {
  organizationDomain,
  organizationName,
  now = new Date().toISOString(),
  maxAgeDays = 180
} = {}) {
  const recipient = exactKeys(
    input,
    ['corroboration', 'email', 'evidence_mode', 'role', 'source_url', 'verified_at'],
    ['email', 'role', 'source_url', 'verified_at'],
    'recipient'
  );
  const companyDomain = domain(organizationDomain, 'organization domain');
  const email = text(recipient.email, 'recipient.email', 254).toLowerCase();
  const match = email.match(/^([^\s@]+)@([^\s@]+)$/);
  if (!match) throw new Error('recipient email is invalid');
  const emailDomain = domain(match[2], 'recipient email domain');
  const source = httpsUrl(recipient.source_url, 'recipient.source_url');
  if (!onDomain(source, companyDomain)) throw new Error('recipient source domain mismatch');
  const verifiedAt = recent(recipient.verified_at, now, 'recipient verification', maxAgeDays);
  const requestedMode = String(recipient.evidence_mode || '').trim();

  if (emailDomain === companyDomain || emailDomain.endsWith(`.${companyDomain}`)) {
    if (requestedMode && requestedMode !== 'company_domain') throw new Error('recipient evidence mode mismatch');
    if (recipient.corroboration !== undefined) throw new Error('company-domain recipient must not include corroboration');
    return {
      email,
      role: text(recipient.role, 'recipient.role', 120),
      source_url: source.toString(),
      verified_at: verifiedAt,
      evidence_mode: 'company_domain',
      corroboration: null
    };
  }

  const publicMailbox = requestedMode === 'official_public_mailbox';
  const relatedCorporateDomain = requestedMode === 'official_related_domain';
  if (!publicMailbox && !relatedCorporateDomain) throw new Error('recipient domain mismatch');
  if (publicMailbox && !PUBLIC_MAILBOX_PROVIDERS.has(emailDomain)) throw new Error('public mailbox provider is not allowed');
  if (relatedCorporateDomain && PUBLIC_MAILBOX_PROVIDERS.has(emailDomain)) throw new Error('related corporate domain cannot be a public mailbox provider');
  const corroboration = exactKeys(
    recipient.corroboration,
    ['email', 'identity_matches', 'observed_at', 'official_domain', 'organization_name', 'source_class', 'source_url'],
    ['email', 'identity_matches', 'observed_at', 'official_domain', 'organization_name', 'source_class', 'source_url'],
    'corroboration'
  );
  const sourceClass = text(corroboration.source_class, 'corroboration source class', 40);
  if (!CORROBORATION_SOURCE_CLASSES.has(sourceClass)) throw new Error('corroboration source class is not allowed');
  const corroborationUrl = httpsUrl(corroboration.source_url, 'corroboration.source_url');
  if (onDomain(corroborationUrl, companyDomain)) throw new Error('corroboration source must be independent');
  const corroborationEmail = text(corroboration.email, 'corroboration.email', 254).toLowerCase();
  if (publicMailbox && corroborationEmail !== email) throw new Error('corroboration email mismatch');
  if (domain(corroboration.official_domain, 'corroboration official domain') !== companyDomain) {
    throw new Error('corroboration official domain mismatch');
  }
  if (normalizedName(corroboration.organization_name) !== normalizedName(organizationName)) {
    throw new Error('corroboration organization name mismatch');
  }
  const matches = exactKeys(
    corroboration.identity_matches,
    ['address', 'phone', 'registration_number'],
    [],
    'corroboration.identity_matches'
  );
  if (Object.values(matches).filter(value => value === true).length < 2) {
    throw new Error('at least two corroborated identity fields required');
  }
  if (Object.values(matches).some(value => typeof value !== 'boolean')) {
    throw new Error('corroborated identity fields must be boolean');
  }

  return {
    email,
    role: text(recipient.role, 'recipient.role', 120),
    source_url: source.toString(),
    verified_at: verifiedAt,
    evidence_mode: requestedMode,
    corroboration: {
      source_url: corroborationUrl.toString(),
      source_class: sourceClass,
      observed_at: recent(corroboration.observed_at, now, 'corroboration', maxAgeDays),
      email: publicMailbox ? email : corroborationEmail,
      organization_name: text(corroboration.organization_name, 'corroboration.organization_name', 160),
      official_domain: companyDomain,
      identity_matches: Object.fromEntries(
        ['address', 'phone', 'registration_number']
          .filter(key => Object.prototype.hasOwnProperty.call(matches, key))
          .map(key => [key, matches[key]])
      )
    }
  };
}

function validateSnapshotRecipientProvenance({
  email,
  sourceUrl,
  verifiedAt,
  organizationDomain,
  organizationName,
  snapshot,
  now = new Date().toISOString(),
  maxAgeDays = 180
} = {}) {
  const provenance = snapshot?.recipient_provenance && typeof snapshot.recipient_provenance === 'object'
    && !Array.isArray(snapshot.recipient_provenance)
    ? snapshot.recipient_provenance
    : { evidence_mode: 'company_domain' };
  return validateRecipientProvenance({
    email,
    role: 'public company',
    source_url: sourceUrl,
    verified_at: verifiedAt,
    evidence_mode: provenance.evidence_mode,
    ...(provenance.corroboration ? { corroboration: provenance.corroboration } : {})
  }, {
    organizationDomain,
    organizationName,
    now,
    maxAgeDays
  });
}

module.exports = {
  CORROBORATION_SOURCE_CLASSES,
  PUBLIC_MAILBOX_PROVIDERS,
  validateRecipientProvenance,
  validateSnapshotRecipientProvenance
};

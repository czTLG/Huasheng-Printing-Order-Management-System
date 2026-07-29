'use strict';

const REQUIRED_SCOPES = new Set([
  'official_contact',
  'official_about',
  'official_sales_export_procurement',
  'independent_organization_sources'
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

function normalizedAddress(channel, value) {
  const address = String(value || '').trim().toLowerCase();
  if (channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error('contact email is invalid');
  if (channel === 'whatsapp' && !/^\+?[1-9]\d{7,14}$/.test(address)) throw new Error('contact WhatsApp is invalid');
  return channel === 'whatsapp' ? address.replace(/^\+/, '') : address;
}

function officialSource(value, organizationDomain) {
  let url;
  try { url = new URL(String(value || '')); } catch (_) { throw new Error('contact source must be HTTPS'); }
  const domain = String(organizationDomain || '').toLowerCase().replace(/^www\./, '');
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (url.protocol !== 'https:' || (host !== domain && !host.endsWith(`.${domain}`))) {
    throw new Error('contact source must be on the verified organization domain');
  }
  return url.toString();
}

function roleScore(route) {
  const text = `${route.role || ''} ${route.address || ''}`.toLowerCase();
  if (/(?:procurement|purchasing|sourcing|supply chain|采购|供应链)/u.test(text)) return 100;
  if (/(?:export|international|overseas|出口|国际)/u.test(text)) return 90;
  if (/(?:business development|commercial|partnership|商务|业务合作)/u.test(text)) return 85;
  if (/(?:sales|销售)/u.test(text)) return 80;
  if (/(?:marketing|市场)/u.test(text)) return 70;
  if (/(?:enquiry|inquiry)/u.test(text)) return 50;
  if (/(?:^|[@\s])(info|contact|hello)(?:@|\b)|general/u.test(text)) return 40;
  return 60;
}

function normalizedRoute(value, organizationDomain, label) {
  const route = exactKeys(
    value,
    ['address', 'channel', 'role', 'source_url', 'verified_at'],
    ['address', 'channel', 'role', 'source_url', 'verified_at'],
    label
  );
  const channel = String(route.channel || '').trim().toLowerCase();
  if (!['email', 'whatsapp'].includes(channel)) throw new Error(`${label} channel is invalid`);
  const verifiedAt = new Date(String(route.verified_at || ''));
  if (Number.isNaN(verifiedAt.getTime())) throw new Error(`${label} verification time is invalid`);
  const result = {
    channel,
    address: normalizedAddress(channel, route.address),
    role: String(route.role || '').trim(),
    source_url: officialSource(route.source_url, organizationDomain),
    verified_at: verifiedAt.toISOString()
  };
  if (!result.role) throw new Error(`${label} role is required`);
  return { ...result, score: roleScore(result) };
}

function validateContactSelection(input, {
  organizationDomain,
  recipientEmail,
  now = new Date().toISOString(),
  maximumAgeDays = 30
} = {}) {
  const review = exactKeys(
    input,
    ['alternatives', 'public_only', 'search_complete', 'searched_at', 'scopes', 'selected'],
    ['alternatives', 'public_only', 'search_complete', 'searched_at', 'scopes', 'selected'],
    'contact_selection'
  );
  if (review.public_only !== true || review.search_complete !== true) throw new Error('contact selection review is incomplete');
  const searchedAt = Date.parse(String(review.searched_at || ''));
  const nowMs = Date.parse(String(now || ''));
  if (!Number.isFinite(searchedAt) || !Number.isFinite(nowMs)
      || searchedAt > nowMs || nowMs - searchedAt > maximumAgeDays * 86400000) {
    throw new Error('contact selection review is stale');
  }
  if (!Array.isArray(review.scopes)) throw new Error('contact selection scopes must be an array');
  const scopes = new Set(review.scopes.map(value => String(value || '').trim()));
  for (const scope of REQUIRED_SCOPES) if (!scopes.has(scope)) throw new Error(`contact selection scope missing: ${scope}`);
  if (!Array.isArray(review.alternatives)) throw new Error('contact alternatives must be an array');

  const selected = normalizedRoute(review.selected, organizationDomain, 'selected contact');
  const alternatives = review.alternatives.map((route, index) => normalizedRoute(route, organizationDomain, `contact alternatives[${index}]`));
  const all = [selected, ...alternatives];
  const unique = new Set(all.map(route => `${route.channel}:${route.address}`));
  if (unique.size !== all.length) throw new Error('contact alternatives contain duplicates');
  const best = Math.max(...all.map(route => route.score));
  if (selected.score < best) throw new Error('selected contact is not the best verified route');
  if (selected.channel !== 'email' || selected.address !== String(recipientEmail || '').trim().toLowerCase()) {
    throw new Error('selected contact does not match the email recipient');
  }
  return { searched_at: new Date(searchedAt).toISOString(), scopes: [...scopes], selected, alternatives };
}

module.exports = { REQUIRED_SCOPES, roleScore, validateContactSelection };

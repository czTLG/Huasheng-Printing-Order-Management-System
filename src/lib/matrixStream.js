'use strict';

const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');
const { classifyRecord } = require('./schemaRank');
const { upsertEntity, appendEvidence, saveClassification } = require('./signalCache');

const MAX_BATCH_RECORDS = 120;
const MAX_COUNTRY_RECORDS = 20;
const MAX_REDIRECTS = 5;
const ALLOWED_CONTACT_FIELDS = new Set([
  'email', 'phone', 'whatsapp', 'linkedin_url', 'contact_page_url'
]);
const ALLOWED_EVIDENCE_FIELDS = new Set([
  'field', 'value', 'source_url', 'page_title', 'retrieved_at',
  'content_fingerprint', 'confidence', 'extraction_method'
]);

function rejected(reason) {
  return { ok: false, normalized_url: null, reason };
}

function parseIPv4(address) {
  if (net.isIP(address) !== 4) return null;
  const octets = address.split('.').map(Number);
  return octets.length === 4 ? octets : null;
}

function parseIPv6(address) {
  let input = address.toLowerCase();
  if (input.includes('%')) return null;

  let ipv4Tail = null;
  const ipv4Match = input.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (ipv4Match) {
    const octets = parseIPv4(ipv4Match[1]);
    if (!octets) return null;
    ipv4Tail = [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
    input = input.slice(0, -ipv4Match[1].length).replace(/:$/, '');
  }

  const halves = input.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const tailLength = ipv4Tail ? 2 : 0;
  const missing = 8 - left.length - right.length - tailLength;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;

  const groups = [
    ...left,
    ...Array(halves.length === 2 ? missing : 0).fill('0'),
    ...right
  ].map(group => {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return NaN;
    return Number.parseInt(group, 16);
  });
  if (ipv4Tail) groups.push(...ipv4Tail);
  return groups.length === 8 && groups.every(Number.isFinite) ? groups : null;
}

function isBlockedIPv4(address) {
  const octets = parseIPv4(address);
  if (!octets) return true;
  const [a, b] = octets;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

function isBlockedAddress(address) {
  const plainAddress = String(address || '').replace(/^\[|\]$/g, '');
  const family = net.isIP(plainAddress);
  if (family === 4) return isBlockedIPv4(plainAddress);
  if (family !== 6) return true;

  const groups = parseIPv6(plainAddress);
  if (!groups) return true;
  const allZero = groups.every(group => group === 0);
  const loopback = groups.slice(0, 7).every(group => group === 0) && groups[7] === 1;
  const uniqueLocal = (groups[0] & 0xfe00) === 0xfc00;
  const linkLocal = (groups[0] & 0xffc0) === 0xfe80;
  const multicast = (groups[0] & 0xff00) === 0xff00;
  const mappedIPv4 = groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff;
  if (mappedIPv4) {
    const mapped = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
    return isBlockedIPv4(mapped);
  }
  return allZero || loopback || uniqueLocal || linkLocal || multicast;
}

function lookupAddresses(result) {
  const entries = Array.isArray(result) ? result : [result];
  return entries.map(entry => {
    const address = typeof entry === 'string' ? entry : entry && entry.address;
    const family = typeof entry === 'object' && entry ? Number(entry.family) : net.isIP(address);
    return address ? { address, family: family || net.isIP(address) } : null;
  }).filter(entry => entry && (entry.family === 4 || entry.family === 6));
}

async function resolvePublicUrl(input, dnsLookup) {
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    return { validation: rejected('invalid_url'), addresses: [] };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { validation: rejected('unsupported_protocol'), addresses: [] };
  }
  if (parsed.username || parsed.password) {
    return { validation: rejected('credentials_not_allowed'), addresses: [] };
  }
  if (parsed.port && parsed.port !== '80' && parsed.port !== '443') {
    return { validation: rejected('port_not_allowed'), addresses: [] };
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return { validation: rejected('blocked_address'), addresses: [] };
  }

  const literalFamily = net.isIP(hostname);
  if (literalFamily && isBlockedAddress(hostname)) {
    return { validation: rejected('blocked_address'), addresses: [] };
  }

  let addresses;
  if (!literalFamily) {
    try {
      addresses = lookupAddresses(await dnsLookup(hostname, { all: true, verbatim: true }));
    } catch {
      return { validation: rejected('dns_lookup_failed'), addresses: [] };
    }
    if (!addresses.length) return { validation: rejected('dns_lookup_failed'), addresses: [] };
    if (addresses.some(entry => isBlockedAddress(entry.address))) {
      return { validation: rejected('blocked_address'), addresses: [] };
    }
  } else {
    addresses = [{ address: hostname, family: literalFamily }];
  }

  parsed.hash = '';
  parsed.hostname = hostname;
  return {
    validation: { ok: true, normalized_url: parsed.toString(), reason: null },
    addresses
  };
}

async function validatePublicUrl(input, dnsLookup = dns.promises.lookup) {
  return (await resolvePublicUrl(input, dnsLookup)).validation;
}

function trimText(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function normalizedUrlText(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const parsed = new URL(value.trim());
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString();
  } catch {
    return value.trim();
  }
}

function officialDomain(officialUrl) {
  try {
    return new URL(officialUrl).hostname.toLowerCase().replace(/^www\./, '').replace(/\.+$/, '');
  } catch {
    return '';
  }
}

function normalizeDiscoveryRecord(input = {}) {
  const officialUrl = normalizedUrlText(input.official_url);
  const publicContacts = {};
  if (input.public_contacts && typeof input.public_contacts === 'object' && !Array.isArray(input.public_contacts)) {
    for (const [key, value] of Object.entries(input.public_contacts)) {
      if (ALLOWED_CONTACT_FIELDS.has(key) && typeof value === 'string' && value.trim()) {
        publicContacts[key] = value.trim();
      }
    }
  }
  const businessEmail = typeof input.business_email === 'string'
    ? input.business_email.trim().toLowerCase()
    : '';
  if (businessEmail && !publicContacts.email) publicContacts.email = businessEmail;

  const evidence = Array.isArray(input.evidence) ? input.evidence.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return {};
    const normalized = {};
    for (const [key, value] of Object.entries(item)) {
      if (!ALLOWED_EVIDENCE_FIELDS.has(key)) continue;
      normalized[key] = key === 'source_url' ? normalizedUrlText(value) : trimText(value);
    }
    return normalized;
  }) : [];

  return {
    country: typeof input.country === 'string' ? input.country.trim().replace(/\s+/g, ' ') : '',
    display_name: typeof input.display_name === 'string' ? input.display_name.trim() : '',
    official_url: officialUrl,
    official_domain: officialDomain(officialUrl),
    business_email: businessEmail,
    public_contacts: publicContacts,
    product_evidence: Array.isArray(input.product_evidence)
      ? input.product_evidence.map(trimText).filter(value => typeof value === 'string' && value)
      : [],
    evidence,
    fixture_marker: trimText(input.fixture_marker),
    source_kind: trimText(input.source_kind),
    sender_name: trimText(input.sender_name),
    sender_phone: trimText(input.sender_phone),
    last_interaction_at: trimText(input.last_interaction_at)
  };
}

function socketFamily(value) {
  if (value === 4 || value === '4' || value === 'IPv4') return 4;
  if (value === 6 || value === '6' || value === 'IPv6') return 6;
  return 0;
}

function pinnedRequest(url, options = {}) {
  const parsed = new URL(url);
  const requestFactory = parsed.protocol === 'https:'
    ? options.requestFactories && options.requestFactories.https || https.request
    : options.requestFactories && options.requestFactories.http || http.request;
  if (!options.connectAddress || (options.connectFamily !== 4 && options.connectFamily !== 6)) {
    return Promise.reject(new Error('validated connection address is required'));
  }

  return new Promise((resolve, reject) => {
    const request = requestFactory({
      protocol: parsed.protocol,
      hostname: parsed.hostname.replace(/^\[|\]$/g, ''),
      port: parsed.port || undefined,
      method: options.method || 'HEAD',
      path: `${parsed.pathname}${parsed.search}`,
      headers: options.headers,
      servername: options.servername,
      rejectUnauthorized: options.rejectUnauthorized !== false,
      agent: false,
      lookup(hostname, lookupOptions, callback) {
        callback(null, options.connectAddress, options.connectFamily);
      }
    }, response => {
      response.resume();
      resolve({
        status: response.statusCode,
        connectedAddress: response.socket && response.socket.remoteAddress,
        connectedFamily: socketFamily(response.socket && response.socket.remoteFamily),
        headers: {
          get(name) {
            const value = response.headers[String(name).toLowerCase()];
            return Array.isArray(value) ? value[0] : value || null;
          }
        }
      });
    });
    request.setTimeout(options.timeout || 10000, () => {
      request.destroy(new Error('public URL probe timed out'));
    });
    request.once('error', reject);
    request.end();
  });
}

async function validateRedirectChain(input, options) {
  let current = input;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const resolved = await resolvePublicUrl(current, options.dnsLookup);
    const { validation } = resolved;
    if (!validation.ok) return validation;
    const parsed = new URL(validation.normalized_url);
    const tlsHostname = parsed.hostname.replace(/^\[|\]$/g, '');
    const target = resolved.addresses[0];

    let response;
    try {
      response = await options.transport(validation.normalized_url, {
        method: 'HEAD',
        redirect: 'manual',
        connectAddress: target.address,
        connectFamily: target.family,
        headers: { Host: parsed.host },
        servername: net.isIP(tlsHostname) ? undefined : tlsHostname,
        rejectUnauthorized: true
      });
    } catch {
      return rejected('transport_failed');
    }

    if (!response
      || response.connectedAddress !== target.address
      || response.connectedFamily !== target.family) {
      return rejected('connection_address_mismatch');
    }
    if (!response || response.status < 300 || response.status >= 400) return validation;
    const location = response.headers && typeof response.headers.get === 'function'
      ? response.headers.get('location')
      : null;
    if (!location) return rejected('redirect_without_location');
    if (redirects === MAX_REDIRECTS) return rejected('too_many_redirects');
    try {
      current = new URL(location, validation.normalized_url).toString();
    } catch {
      return rejected('invalid_redirect');
    }
  }
  return rejected('too_many_redirects');
}

function emptySummary(input) {
  return {
    input,
    excluded: 0,
    test: 0,
    noise: 0,
    needs_review: 0,
    valid: 0,
    errors: 0
  };
}

async function importDiscoveryBatch(db, runId, records, options = {}) {
  if (!Array.isArray(records)) throw new Error('records must be an array');
  if (records.length > MAX_BATCH_RECORDS) {
    throw new Error(`batch exceeds ${MAX_BATCH_RECORDS} input records`);
  }
  if (Object.prototype.hasOwnProperty.call(options, 'fetch')) {
    throw new Error('fetch option is not supported; use the pinned transport contract');
  }
  const dependencies = {
    dnsLookup: options.dnsLookup || dns.promises.lookup,
    transport: options.transport || ((url, transportOptions) => pinnedRequest(url, {
      ...transportOptions,
      requestFactories: options.requestFactories
    }))
  };
  if (typeof dependencies.dnsLookup !== 'function') throw new Error('dnsLookup must be a function');
  if (typeof dependencies.transport !== 'function') throw new Error('transport must be a function');

  const summary = emptySummary(records.length);
  const countryCounts = new Map();

  for (const rawRecord of records) {
    const record = normalizeDiscoveryRecord(rawRecord);
    const countryKey = record.country.toLowerCase();
    if (countryKey === 'india') {
      summary.excluded += 1;
      continue;
    }

    const countryCount = (countryCounts.get(countryKey) || 0) + 1;
    countryCounts.set(countryKey, countryCount);
    if (!countryKey || countryCount > MAX_COUNTRY_RECORDS) {
      summary.errors += 1;
      continue;
    }
    if (!record.official_url || !record.evidence.length
      || record.evidence.some(item => !item.source_url)) {
      summary.errors += 1;
      continue;
    }

    const officialValidation = await validateRedirectChain(record.official_url, dependencies);
    if (!officialValidation.ok) {
      summary.errors += 1;
      continue;
    }

    let evidenceFailed = false;
    const checkedEvidence = [];
    for (const evidence of record.evidence) {
      const validation = await validateRedirectChain(evidence.source_url, dependencies);
      if (!validation.ok) {
        evidenceFailed = true;
        break;
      }
      checkedEvidence.push({ ...evidence, source_url: validation.normalized_url });
    }
    if (evidenceFailed) {
      summary.errors += 1;
      continue;
    }

    record.official_url = officialValidation.normalized_url;
    record.official_domain = officialDomain(record.official_url);
    const classification = classifyRecord(record, { now: options.now });
    try {
      db.transaction(() => {
        const entity = upsertEntity(db, {
          official_domain: record.official_domain,
          display_name: record.display_name || undefined,
          country: record.country,
          public_contacts: record.public_contacts
        });
        for (const evidence of checkedEvidence) appendEvidence(db, entity.id, evidence);
        saveClassification(db, entity.id, classification, runId);
      })();
      if (Object.prototype.hasOwnProperty.call(summary, classification.classification)) {
        summary[classification.classification] += 1;
      } else {
        summary.errors += 1;
      }
    } catch {
      summary.errors += 1;
    }
  }

  return summary;
}

module.exports = {
  validatePublicUrl,
  normalizeDiscoveryRecord,
  importDiscoveryBatch,
  pinnedRequest
};

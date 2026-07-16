'use strict';

const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-stream-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');
process.env.MATRIX_SUPPRESS_BOOTSTRAP_SECRET = '1';

const { db, initDb } = require('../src/db');
const { createRun } = require('../src/lib/signalCache');
const {
  validatePublicUrl,
  normalizeDiscoveryRecord,
  importDiscoveryBatch,
  pinnedRequest
} = require('../src/lib/matrixStream');

const PUBLIC_ADDRESS = '8.8.8.8';
const campaign = (name, countries, overrides = {}) => ({
  name,
  countries,
  categories: ['dry_food'],
  languages: ['en'],
  max_companies_per_country: 20,
  max_pages_per_company: 6,
  max_redirects: 5,
  max_probes: 120,
  run_deadline_ms: 60000,
  allowed_source_types: ['official_website', 'public_directory'],
  official_hosts: ['*.example'],
  third_party_sources: [
    { host: 'evidence-redirect.example', source_type: 'public_directory', terms_url: 'https://evidence-redirect.example/terms', approved_at: '2026-07-16T00:00:00Z' },
    { host: 'evidence-hop.example', source_type: 'public_directory', terms_url: 'https://evidence-hop.example/terms', approved_at: '2026-07-16T00:00:00Z' }
  ],
  exclusion_terms: ['India'],
  existing_domain_suppression: true,
  actor: 'test-operator',
  ...overrides
});
const dnsCalls = [];
async function publicDnsLookup(hostname, options) {
  dnsCalls.push({ hostname, options });
  if (hostname.endsWith('.example')) {
    return options && options.all
      ? [{ address: PUBLIC_ADDRESS, family: 4 }]
      : { address: PUBLIC_ADDRESS, family: 4 };
  }
  throw new Error(`unexpected DNS lookup: ${hostname}`);
}

function response(status, location) {
  return {
    status,
    headers: {
      get(name) {
        return name.toLowerCase() === 'location' ? location || null : null;
      }
    }
  };
}

function evidenceSet(domain, country = 'Vietnam', options = {}) {
  const sourceUrl = options.source_url || `https://${domain}/products`;
  const displayName = options.display_name || 'Brand';
  const email = options.email || `sales@${domain}`;
  return [
    ['display_name', displayName], ['official_domain', options.official_domain || domain], ['country', country],
    ['public_email', email], ['product', 'coffee']
  ].map(([field, value]) => ({ source_type: options.source_type || 'official_website', field, value, source_url: sourceUrl, retrieved_at: '2026-07-16T00:00:00Z', confidence: 0.9 }));
}

function pinnedResponse(status, location, options) {
  return {
    ...response(status, location),
    connectedAddress: options.connectAddress,
    connectedFamily: options.connectFamily
  };
}

function discoveryRecord(index, overrides = {}) {
  const domain = `brand-${index}.example`;
  const record = {
    country: 'Vietnam',
    display_name: `Brand ${index}`,
    official_url: `https://${domain}/`,
    business_email: `sales@${domain}`,
    product_evidence: ['coffee'],
    ...overrides
  };
  if (!Object.prototype.hasOwnProperty.call(overrides, 'evidence')) {
    let finalDomain = domain;
    try { finalDomain = new URL(record.official_url).hostname.replace(/^www\./, ''); } catch {}
    record.evidence = evidenceSet(finalDomain, record.country, {
      display_name: record.display_name,
      email: record.business_email
    });
  }
  return record;
}

function fakeRequestFactory(captures, remoteAddress = PUBLIC_ADDRESS, remoteFamily = 'IPv4') {
  return (requestOptions, onResponse) => {
    captures.push(requestOptions);
    const listeners = {};
    const request = {
      setTimeout() {},
      once(event, listener) {
        listeners[event] = listener;
        return request;
      },
      destroy(error) {
        if (listeners.error) listeners.error(error);
      },
      end() {
        onResponse({
          statusCode: 200,
          headers: {},
          socket: { remoteAddress, remoteFamily },
          resume() {}
        });
      }
    };
    return request;
  };
}

async function main() {
  initDb();
  assert.equal(typeof pinnedRequest, 'function', 'production pinned request adapter must be directly testable');

  const rejectedUrls = [
    ['loopback IPv4', 'http://127.0.0.1', 'blocked_address'],
    ['link-local IPv4', 'http://169.254.169.254', 'blocked_address'],
    ['private IPv4', 'http://10.0.0.1', 'blocked_address'],
    ['carrier-grade NAT', 'http://100.64.0.1', 'blocked_address'],
    ['documentation IPv4', 'http://203.0.113.10', 'blocked_address'],
    ['IPv6 loopback', 'http://[::1]', 'blocked_address'],
    ['IPv6 unique-local', 'http://[fd00::1]', 'blocked_address'],
    ['IPv6 benchmark', 'http://[2001:2::1]', 'blocked_address'],
    ['IPv6 documentation', 'http://[3fff::1]', 'blocked_address'],
    ['IPv4-mapped private', 'http://[::ffff:10.0.0.1]', 'blocked_address'],
    ['credentials', 'https://user:pass@official.example/', 'credentials_not_allowed'],
    ['non-HTTP scheme', 'file:///etc/passwd', 'unsupported_protocol'],
    ['nonstandard port', 'https://official.example:8443/', 'port_not_allowed']
  ];
  for (const [label, url, reason] of rejectedUrls) {
    const result = await validatePublicUrl(url, publicDnsLookup);
    assert.equal(result.ok, false, `${label} must be rejected`);
    assert.equal(result.reason, reason, `${label} rejection reason`);
  }

  const acceptedUrl = await validatePublicUrl('HTTPS://Official.Example/docs#intro', publicDnsLookup);
  assert.deepEqual(acceptedUrl, {
    ok: true,
    normalized_url: 'https://official.example/docs',
    reason: null
  });

  const mixedDns = async (hostname, options) => {
    assert.equal(hostname, 'mixed.example');
    assert.equal(options.all, true);
    return [
      { address: PUBLIC_ADDRESS, family: 4 },
      { address: '192.168.1.9', family: 4 }
    ];
  };
  const mixedResult = await validatePublicUrl('https://mixed.example', mixedDns);
  assert.equal(mixedResult.ok, false);
  assert.equal(mixedResult.reason, 'blocked_address');

  const normalized = normalizeDiscoveryRecord({
    country: '  Vietnam ',
    display_name: ' Brand ',
    official_url: 'HTTPS://WWW.Brand.Example/path',
    business_email: ' SALES@BRAND.EXAMPLE ',
    evidence: [{
      field: ' product ',
      value: ' coffee ',
      source_url: ' HTTPS://Brand.Example/products ',
      retrieved_at: ' 2026-07-16T00:00:00Z '
    }]
  });
  assert.equal(normalized.country, 'Vietnam');
  assert.equal(normalized.display_name, 'Brand');
  assert.equal(normalized.official_url, 'https://www.brand.example/path');
  assert.equal(normalized.official_domain, 'brand.example');
  assert.equal(normalized.business_email, 'sales@brand.example');
  assert.equal(normalized.evidence[0].field, 'product');
  const socialDropped = normalizeDiscoveryRecord({
    country: 'Vietnam', official_url: 'https://brand.example', business_email: 'sales@brand.example',
    public_contacts: { linkedin_url: 'https://linkedin.example/company/brand' }
  });
  assert.equal(Object.hasOwn(socialDropped.public_contacts, 'linkedin_url'), false);

  const run = createRun(db, campaign('matrix-stream-test', ['Vietnam']));
  const transportCalls = [];
  const safeTransport = async (url, options) => {
    transportCalls.push({ url, options });
    const parsed = new URL(url);
    const targetHostname = parsed.hostname.replace(/^\[|\]$/g, '');
    assert.equal(options.connectAddress, net.isIP(targetHostname) ? targetHostname : PUBLIC_ADDRESS);
    assert.equal(options.headers.Host, parsed.host);
    assert.equal(options.redirect, 'manual');
    if (parsed.protocol === 'https:') {
      const tlsName = targetHostname;
      assert.equal(options.servername, net.isIP(tlsName) ? undefined : tlsName);
      assert.equal(options.rejectUnauthorized, true);
    }
    if (url === 'https://redirect.example/') {
      return pinnedResponse(302, 'http://10.0.0.1/admin', options);
    }
    if (url === 'https://multi-hop.example/') {
      return pinnedResponse(301, '/second-hop', options);
    }
    if (url === 'https://multi-hop.example/second-hop') {
      return pinnedResponse(302, '/landing', options);
    }
    if (url === 'https://evidence-redirect.example/start') {
      return pinnedResponse(302, 'https://evidence-hop.example/final', options);
    }
    return pinnedResponse(200, null, options);
  };

  const records = [
    discoveryRecord('valid'),
    discoveryRecord('india', { country: 'India' }),
    discoveryRecord('missing-source', {
      evidence: [{ field: 'product', value: 'coffee', retrieved_at: '2026-07-16T00:00:00Z' }]
    }),
    discoveryRecord('missing-official', { official_url: '' }),
    discoveryRecord('empty-evidence', { evidence: [] }),
    discoveryRecord('unsafe-evidence', {
      evidence: [{
        field: 'product',
        value: '<article>full page</article>',
        source_url: 'https://unsafe-evidence.example/products',
        retrieved_at: '2026-07-16T00:00:00Z'
      }]
    }),
    discoveryRecord('redirect', {
      official_url: 'https://redirect.example/',
      business_email: 'sales@redirect.example',
      evidence: evidenceSet('redirect.example', 'Vietnam', { display_name: 'Brand redirect' })
    }),
    discoveryRecord('multi-hop', {
      official_url: 'https://multi-hop.example/',
      business_email: 'sales@multi-hop.example'
    }),
    discoveryRecord('evidence-redirect', {
      official_url: 'https://brand-evidence-redirect.example/',
      business_email: 'sales@brand-evidence-redirect.example',
      evidence: evidenceSet('evidence-redirect.example', 'Vietnam', { source_url: 'https://evidence-redirect.example/start', official_domain: 'brand-evidence-redirect.example', email: 'sales@brand-evidence-redirect.example', display_name: 'Brand evidence-redirect', source_type: 'public_directory' })
    })
  ];
  const summary = await importDiscoveryBatch(db, run.id, records, {
    dnsLookup: publicDnsLookup,
    transport: safeTransport,
    now: '2026-07-16'
  });
  assert.deepEqual(summary, {
    input: 9,
    excluded: 1,
    test: 0,
    noise: 0,
    needs_review: 0,
    valid: 3,
    errors: 5
  });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM matrix_entities').get().n, 3);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM matrix_evidence').get().n, 15);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM matrix_classification_evidence').get().n, 15);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM matrix_classifications').get().n, 3);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM customers').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_messages').get().n, 0);
  await assert.rejects(
    importDiscoveryBatch(db, run.id, [discoveryRecord('second-call')], { dnsLookup: publicDnsLookup, transport: safeTransport }),
    /single-use/i
  );
  const suppressionRun = createRun(db, campaign('existing-domain-suppression', ['Vietnam']));
  const callsBeforeSuppression = transportCalls.length;
  const suppressionSummary = await importDiscoveryBatch(db, suppressionRun.id, [discoveryRecord('valid')], {
    dnsLookup: publicDnsLookup, transport: safeTransport
  });
  assert.equal(suppressionSummary.excluded, 1);
  assert.equal(transportCalls.length, callsBeforeSuppression, 'existing domains must be suppressed before network access');
  const aliasRun = createRun(db, campaign('redirect-alias-suppression', ['Vietnam'], {
    official_hosts: ['alias.example', 'brand-valid.example']
  }));
  const aliasSummary = await importDiscoveryBatch(db, aliasRun.id, [discoveryRecord('alias', {
    official_url: 'https://alias.example/', business_email: 'sales@alias.example',
    evidence: evidenceSet('alias.example', 'Vietnam', { display_name: 'Brand alias' })
  })], {
    dnsLookup: publicDnsLookup,
    transport: async (url, options) => url === 'https://alias.example/'
      ? pinnedResponse(302, 'https://brand-valid.example/', options)
      : pinnedResponse(200, null, options)
  });
  assert.equal(aliasSummary.errors, 1, 'cross-host official redirects require an explicit later-phase alias contract');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM matrix_entities WHERE normalized_domain = 'alias.example'").get().n, 0);
  assert(transportCalls.some(call => call.url === 'https://redirect.example/'));
  assert(
    !transportCalls.some(call => call.url === 'http://10.0.0.1/admin'),
    'blocked redirect destination must be revalidated before fetch'
  );
  assert.deepEqual(
    transportCalls.filter(call => new URL(call.url).hostname === 'multi-hop.example')
      .map(call => call.url),
    [
      'https://multi-hop.example/',
      'https://multi-hop.example/second-hop',
      'https://multi-hop.example/landing',
      'https://multi-hop.example/products'
    ]
  );
  assert(transportCalls.some(call => call.url === 'https://evidence-hop.example/final'));

  const rebindingRun = createRun(db, campaign('dns-rebinding', ['Thailand'], { third_party_sources: [{ host: 'rebind-evidence.example', source_type: 'public_directory', terms_url: 'https://rebind-evidence.example/terms', approved_at: '2026-07-16T00:00:00Z' }] }));
  let rebindingLookups = 0;
  async function rebindingDnsLookup(hostname, options) {
    if (hostname !== 'rebind.example') return publicDnsLookup(hostname, options);
    rebindingLookups += 1;
    const address = rebindingLookups === 1 ? PUBLIC_ADDRESS : '127.0.0.1';
    return options && options.all ? [{ address, family: 4 }] : { address, family: 4 };
  }
  const reachedAddresses = [];
  async function rebindingTransport(url, options) {
    let address = options && options.connectAddress;
    if (!address) {
      const answers = await rebindingDnsLookup(new URL(url).hostname, { all: true });
      address = answers[0].address;
    }
    reachedAddresses.push(address);
    return pinnedResponse(200, null, options);
  }
  const rebindingSummary = await importDiscoveryBatch(db, rebindingRun.id, [
    discoveryRecord('rebind', {
      country: 'Thailand',
      official_url: 'https://rebind.example/',
      business_email: 'sales@rebind.example',
      evidence: evidenceSet('rebind-evidence.example', 'Thailand', { display_name: 'Brand rebind', official_domain: 'rebind.example', email: 'sales@rebind.example', source_type: 'public_directory' })
    })
  ], {
    dnsLookup: rebindingDnsLookup,
    transport: rebindingTransport,
    now: '2026-07-16'
  });
  assert.equal(rebindingSummary.valid, 1);
  assert.equal(rebindingLookups, 1, 'connection must not resolve the original hostname again');
  assert(!reachedAddresses.includes('127.0.0.1'), 'connection must stay pinned to validated public IP');
  assert(reachedAddresses.every(address => address === PUBLIC_ADDRESS));

  const ordinaryFetchRun = createRun(db, campaign('ordinary-fetch-rejected', ['Thailand']));
  await assert.rejects(
    importDiscoveryBatch(db, ordinaryFetchRun.id, [
      discoveryRecord('ordinary-fetch-option', { country: 'Thailand' })
    ], {
      dnsLookup: publicDnsLookup,
      fetch: async () => response(200),
      now: '2026-07-16'
    }),
    /fetch.*not supported/i
  );
  const ordinaryFetchSummary = await importDiscoveryBatch(db, ordinaryFetchRun.id, [
    discoveryRecord('ordinary-fetch-response', { country: 'Thailand' })
  ], {
    dnsLookup: publicDnsLookup,
    transport: async () => response(200),
    now: '2026-07-16'
  });
  assert.equal(ordinaryFetchSummary.valid, 0);
  assert.equal(ordinaryFetchSummary.errors, 1, 'response without connected peer proof must be rejected');

  const ipv6Run = createRun(db, campaign('public-ipv6', ['Indonesia'], { official_hosts: ['[2606:4700:4700::1111]'] }));
  const ipv6Summary = await importDiscoveryBatch(db, ipv6Run.id, [
    discoveryRecord('ipv6', {
      country: 'Indonesia',
      official_url: 'https://[2606:4700:4700::1111]/',
      business_email: 'sales@ipv6.example',
      evidence: evidenceSet('2606:4700:4700::1111', 'Indonesia', { source_url: 'https://[2606:4700:4700::1111]/products', official_domain: '[2606:4700:4700::1111]', email: 'sales@ipv6.example', display_name: 'Brand ipv6' })
    })
  ], {
    dnsLookup: publicDnsLookup,
    transport: safeTransport,
    now: '2026-07-16'
  });
  assert.equal(ipv6Summary.needs_review, 1);

  const pinnedCaptures = [];
  const directPinnedResponse = await pinnedRequest('https://adapter.example/probe?q=1', {
    method: 'HEAD',
    connectAddress: PUBLIC_ADDRESS,
    connectFamily: 4,
    headers: { Host: 'adapter.example' },
    servername: 'adapter.example',
    rejectUnauthorized: true,
    requestFactories: { https: fakeRequestFactory(pinnedCaptures) }
  });
  assert.equal(directPinnedResponse.connectedAddress, PUBLIC_ADDRESS);
  assert.equal(directPinnedResponse.connectedFamily, 4);
  assert.equal(pinnedCaptures.length, 1);
  const pinnedOptions = pinnedCaptures[0];
  assert.equal(pinnedOptions.hostname, 'adapter.example');
  assert.equal(pinnedOptions.path, '/probe?q=1');
  assert.equal(pinnedOptions.headers.Host, 'adapter.example');
  assert.equal(pinnedOptions.servername, 'adapter.example');
  assert.equal(pinnedOptions.rejectUnauthorized, true);
  assert.equal(pinnedOptions.agent, false);
  assert.equal(pinnedOptions.maxHeaderSize, 16 * 1024);
  const pinnedLookup = await new Promise((resolve, reject) => {
    pinnedOptions.lookup('adapter.example', {}, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
  assert.deepEqual(pinnedLookup, { address: PUBLIC_ADDRESS, family: 4 });

  const defaultAdapterRun = createRun(db, campaign('default-adapter', ['Philippines']));
  const defaultAdapterCaptures = [];
  const defaultAdapterSummary = await importDiscoveryBatch(db, defaultAdapterRun.id, [
    discoveryRecord('default-adapter', {
      country: 'Philippines',
      official_url: 'https://default-adapter.example/',
      business_email: 'sales@default-adapter.example',
      evidence: evidenceSet('default-adapter.example', 'Philippines', { display_name: 'Brand default-adapter' })
    })
  ], {
    dnsLookup: publicDnsLookup,
    requestFactories: { https: fakeRequestFactory(defaultAdapterCaptures) },
    now: '2026-07-16'
  });
  assert.equal(defaultAdapterSummary.valid, 1);
  assert.equal(defaultAdapterCaptures.length, 2);
  assert(defaultAdapterCaptures.every(options => options.headers.Host === 'default-adapter.example'));
  assert(defaultAdapterCaptures.every(options => options.servername === 'default-adapter.example'));

  const mismatchedAdapterRun = createRun(db, campaign('mismatched-adapter', ['Kazakhstan']));
  const entitiesBeforeMismatch = db.prepare('SELECT COUNT(*) n FROM matrix_entities').get().n;
  const mismatchedSummary = await importDiscoveryBatch(db, mismatchedAdapterRun.id, [
    discoveryRecord('mismatched-adapter', {
      country: 'Kazakhstan',
      official_url: 'https://mismatched-adapter.example/',
      business_email: 'sales@mismatched-adapter.example'
    })
  ], {
    dnsLookup: publicDnsLookup,
    requestFactories: {
      https: fakeRequestFactory([], '127.0.0.1', 'IPv4')
    },
    now: '2026-07-16'
  });
  assert.equal(mismatchedSummary.valid, 0);
  assert.equal(mismatchedSummary.errors, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM matrix_entities').get().n, entitiesBeforeMismatch);

  const scopeRun = createRun(db, campaign('scope-canaries', ['Vietnam']));
  const transportsBeforeScope = transportCalls.length;
  const entitiesBeforeScope = db.prepare('SELECT COUNT(*) n FROM matrix_entities').get().n;
  const scopeSummary = await importDiscoveryBatch(db, scopeRun.id, [
    discoveryRecord('canada', { country: 'Canada' }),
    discoveryRecord('blank-country', { country: '   ' }),
    discoveryRecord('country-alias', { country: 'viet nam' }),
    discoveryRecord('run-mismatch', { country: 'Thailand' })
  ], { dnsLookup: publicDnsLookup, transport: safeTransport, now: '2026-07-16' });
  assert.deepEqual(scopeSummary, { input: 4, excluded: 4, test: 0, noise: 0, needs_review: 0, valid: 0, errors: 0 });
  assert.equal(transportCalls.length, transportsBeforeScope, 'country exclusions must happen before DNS/HTTP');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM matrix_entities').get().n, entitiesBeforeScope);

  const unlistedRun = createRun(db, campaign('unlisted-host', ['Vietnam'], { official_hosts: ['approved.example'] }));
  const unlistedSummary = await importDiscoveryBatch(db, unlistedRun.id, [
    discoveryRecord('unlisted', { official_url: 'https://unlisted.test/', business_email: 'sales@unlisted.test' })
  ], { dnsLookup: publicDnsLookup, transport: safeTransport });
  assert.equal(unlistedSummary.errors, 1);

  const sourceTypeRun = createRun(db, campaign('source-type-boundary', ['Vietnam']));
  const sourceTypeRecord = discoveryRecord('source-type-mismatch');
  sourceTypeRecord.evidence = sourceTypeRecord.evidence.map(item => ({ ...item, source_type: 'public_social' }));
  const sourceCallsBefore = transportCalls.length;
  const sourceTypeSummary = await importDiscoveryBatch(db, sourceTypeRun.id, [sourceTypeRecord], {
    dnsLookup: publicDnsLookup, transport: safeTransport
  });
  assert.equal(sourceTypeSummary.errors, 1);
  assert.equal(transportCalls.length, sourceCallsBefore, 'source-type authorization must happen before network access');

  const emailConflictRun = createRun(db, campaign('email-conflict', ['Vietnam']));
  const emailConflictCalls = [];
  const emailConflictSummary = await importDiscoveryBatch(db, emailConflictRun.id, [
    discoveryRecord('email-conflict', { public_contacts: { email: 'other@different.example' } })
  ], {
    dnsLookup: publicDnsLookup,
    transport: async (url, options) => { emailConflictCalls.push(url); return pinnedResponse(200, null, options); }
  });
  assert.equal(emailConflictSummary.errors, 1);
  assert.equal(emailConflictCalls.length, 0, 'conflicting identity emails must fail before network');

  const escapedHostRun = createRun(db, campaign('redirect-host-boundary', ['Vietnam'], { official_hosts: ['origin.example'] }));
  const escapedHostRecord = discoveryRecord('escaped-host', {
    official_url: 'https://origin.example/', business_email: 'sales@origin.example',
    evidence: evidenceSet('origin.example', 'Vietnam', { display_name: 'Brand escaped-host' })
  });
  const escapedHostSummary = await importDiscoveryBatch(db, escapedHostRun.id, [escapedHostRecord], {
    dnsLookup: publicDnsLookup,
    transport: async (url, options) => url === 'https://origin.example/'
      ? pinnedResponse(302, 'https://escaped.example/', options)
      : pinnedResponse(200, null, options)
  });
  assert.equal(escapedHostSummary.valid, 0);
  assert.equal(escapedHostSummary.needs_review, 0);
  assert.equal(escapedHostSummary.errors, 1, 'official redirects must remain inside the run allowlist');
  const intermediateRun = createRun(db, campaign('redirect-intermediate-boundary', ['Vietnam'], { official_hosts: ['origin.example'] }));
  const intermediateCalls = [];
  const intermediateSummary = await importDiscoveryBatch(db, intermediateRun.id, [escapedHostRecord], {
    dnsLookup: publicDnsLookup,
    transport: async (url, options) => {
      intermediateCalls.push(url);
      return url === 'https://origin.example/'
        ? pinnedResponse(302, 'https://unapproved-hop.example/then', options)
        : pinnedResponse(200, null, options);
    }
  });
  assert.equal(intermediateSummary.errors, 1);
  assert.deepEqual(intermediateCalls, ['https://origin.example/'], 'unapproved redirect hops must be rejected before contact');

  const pageRun = createRun(db, campaign('page-cap', ['Vietnam'], { max_pages_per_company: 6 }));
  const pageRecord = discoveryRecord('too-many-pages');
  pageRecord.evidence = pageRecord.evidence.map((item, index) => ({ ...item, source_url: `https://brand-too-many-pages.example/page-${index}` }));
  pageRecord.evidence.push({ ...pageRecord.evidence[4], source_url: 'https://brand-too-many-pages.example/page-5' });
  pageRecord.evidence.push({ ...pageRecord.evidence[4], source_url: 'https://brand-too-many-pages.example/page-6' });
  const pageSummary = await importDiscoveryBatch(db, pageRun.id, [pageRecord], { dnsLookup: publicDnsLookup, transport: safeTransport });
  assert.equal(pageSummary.errors, 1);

  const deadlineRun = createRun(db, campaign('deadline-cap', ['Vietnam'], { run_deadline_ms: 20 }));
  const deadlineStarted = Date.now();
  const deadlineSummary = await importDiscoveryBatch(db, deadlineRun.id, [discoveryRecord('slow-trickle')], {
    dnsLookup: publicDnsLookup,
    transport: () => new Promise(() => {})
  });
  assert.equal(deadlineSummary.errors, 1);
  assert(Date.now() - deadlineStarted < 1000, 'wall-clock deadline must stop a continuously pending transport');

  const dnsDeadlineRun = createRun(db, campaign('dns-deadline-cap', ['Vietnam'], { run_deadline_ms: 10 }));
  const dnsDeadlineCalls = [];
  const dnsSignals = [];
  const dnsDeadlineSummary = await importDiscoveryBatch(db, dnsDeadlineRun.id, [discoveryRecord('slow-dns')], {
    dnsLookup: (hostname, options) => new Promise((resolve) => {
      dnsSignals.push(options.signal);
      setTimeout(() => resolve([{ address: '93.184.216.34', family: 4 }]), 40);
    }),
    transport: async (url, options) => {
      dnsDeadlineCalls.push(url);
      return pinnedResponse(200, null, options);
    }
  });
  assert.equal(dnsDeadlineSummary.errors, 1);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(dnsDeadlineCalls.length, 0, 'late DNS completion must not start detached transport');
  assert(dnsSignals.every(signal => signal && signal.aborted), 'DNS lookup must receive the run cancellation signal');

  const sensitiveRun = createRun(db, campaign('sensitive-url', ['Vietnam']));
  const sensitiveRecord = discoveryRecord('sensitive-url');
  sensitiveRecord.evidence = sensitiveRecord.evidence.map(item => ({
    ...item, source_url: 'https://brand-sensitive-url.example/products?token=secret'
  }));
  const sensitiveSummary = await importDiscoveryBatch(db, sensitiveRun.id, [sensitiveRecord], {
    dnsLookup: publicDnsLookup, transport: safeTransport
  });
  assert.equal(sensitiveSummary.errors, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM matrix_entities WHERE normalized_domain = 'brand-sensitive-url.example'").get().n, 0);

  const capRun = createRun(db, campaign('country-cap', ['Malaysia']));
  const cappedRecords = Array.from({ length: 21 }, (_, index) => discoveryRecord(`cap-${index}`, {
    country: 'Malaysia'
  }));
  const capSummary = await importDiscoveryBatch(db, capRun.id, cappedRecords, {
    dnsLookup: publicDnsLookup,
    transport: safeTransport,
    now: '2026-07-16'
  });
  assert.equal(capSummary.input, 21);
  assert.equal(capSummary.valid, 20);
  assert.equal(capSummary.errors, 1);

  const lowCompanyRun = createRun(db, campaign('low-company-cap', ['Vietnam'], { max_companies_per_country: 1 }));
  const lowCompanyCalls = [];
  const lowCompanySummary = await importDiscoveryBatch(db, lowCompanyRun.id, [
    discoveryRecord('low-company-1'), discoveryRecord('low-company-2')
  ], {
    dnsLookup: publicDnsLookup,
    transport: async (url, options) => { lowCompanyCalls.push(url); return pinnedResponse(200, null, options); }
  });
  assert.equal(lowCompanySummary.valid, 1);
  assert.equal(lowCompanySummary.errors, 1);
  assert.equal(lowCompanyCalls.length, 2);

  const onePageRun = createRun(db, campaign('one-page-cap', ['Vietnam'], { max_pages_per_company: 1 }));
  const onePageCalls = [];
  const onePageSummary = await importDiscoveryBatch(db, onePageRun.id, [discoveryRecord('one-page')], {
    dnsLookup: publicDnsLookup,
    transport: async (url, options) => { onePageCalls.push(url); return pinnedResponse(200, null, options); }
  });
  assert.equal(onePageSummary.errors, 1);
  assert.equal(onePageCalls.length, 0, 'official plus evidence page must exceed a one-page campaign before network');

  const hopBudgetRun = createRun(db, campaign('hop-budget', ['Vietnam'], { max_probes: 2 }));
  const hopCalls = [];
  const hopSummary = await importDiscoveryBatch(db, hopBudgetRun.id, [discoveryRecord('hop-budget')], {
    dnsLookup: publicDnsLookup,
    transport: async (url, options) => {
      hopCalls.push(url);
      if (url === 'https://brand-hop-budget.example/') return pinnedResponse(302, '/home', options);
      return pinnedResponse(200, null, options);
    }
  });
  assert.equal(hopSummary.errors, 1);
  assert.equal(hopCalls.length, 2, 'each actual redirect hop must consume the shared probe budget');
  assert.equal(JSON.parse(db.prepare('SELECT counters_json FROM matrix_runs WHERE id = ?').get(hopBudgetRun.id).counters_json).probes, 2);

  const redirectBudgetRun = createRun(db, campaign('redirect-budget', ['Vietnam'], { max_redirects: 1 }));
  const redirectBudgetCalls = [];
  const redirectBudgetSummary = await importDiscoveryBatch(db, redirectBudgetRun.id, [discoveryRecord('redirect-budget')], {
    dnsLookup: publicDnsLookup,
    transport: async (url, options) => {
      redirectBudgetCalls.push(url);
      if (url.endsWith('/')) return pinnedResponse(302, '/one', options);
      if (url.endsWith('/one')) return pinnedResponse(302, '/two', options);
      return pinnedResponse(200, null, options);
    }
  });
  assert.equal(redirectBudgetSummary.errors, 1);
  assert.deepEqual(redirectBudgetCalls, ['https://brand-redirect-budget.example/', 'https://brand-redirect-budget.example/one']);

  const oversizedRun = createRun(db, campaign('oversized', ['Thailand']));
  const entitiesBeforeOversized = db.prepare('SELECT COUNT(*) n FROM matrix_entities').get().n;
  await assert.rejects(
    importDiscoveryBatch(
      db,
      oversizedRun.id,
      Array.from({ length: 121 }, (_, index) => discoveryRecord(`large-${index}`, { country: 'Thailand' })),
      { dnsLookup: publicDnsLookup, transport: safeTransport }
    ),
    /120/
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) n FROM matrix_entities').get().n,
    entitiesBeforeOversized,
    'oversized batch must be rejected before persistence'
  );

  assert(dnsCalls.length > 0);
  console.log('matrix-stream tests passed');
}

main()
  .finally(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  })
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });

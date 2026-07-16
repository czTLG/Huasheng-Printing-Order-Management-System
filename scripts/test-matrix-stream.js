'use strict';

const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-stream-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');

const { db, initDb } = require('../src/db');
const { createRun } = require('../src/lib/signalCache');
const {
  validatePublicUrl,
  normalizeDiscoveryRecord,
  importDiscoveryBatch,
  pinnedRequest
} = require('../src/lib/matrixStream');

const PUBLIC_ADDRESS = '203.0.113.10';
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

function pinnedResponse(status, location, options) {
  return {
    ...response(status, location),
    connectedAddress: options.connectAddress,
    connectedFamily: options.connectFamily
  };
}

function discoveryRecord(index, overrides = {}) {
  const domain = `brand-${index}.example`;
  return {
    country: 'Vietnam',
    display_name: `Brand ${index}`,
    official_url: `https://${domain}/`,
    business_email: `sales@${domain}`,
    product_evidence: ['coffee'],
    evidence: [{
      field: 'product',
      value: 'coffee',
      source_url: `https://${domain}/products`,
      retrieved_at: '2026-07-16T00:00:00Z',
      confidence: 'high'
    }],
    ...overrides
  };
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
    ['IPv6 loopback', 'http://[::1]', 'blocked_address'],
    ['IPv6 unique-local', 'http://[fd00::1]', 'blocked_address'],
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

  const run = createRun(db, { name: 'matrix-stream-test', countries: ['Vietnam'] });
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
      evidence: [{
        field: 'product',
        value: 'coffee',
        source_url: 'https://redirect.example/products',
        retrieved_at: '2026-07-16T00:00:00Z'
      }]
    }),
    discoveryRecord('multi-hop', {
      official_url: 'https://multi-hop.example/',
      business_email: 'sales@multi-hop.example'
    }),
    discoveryRecord('evidence-redirect', {
      official_url: 'https://evidence-redirect.example/',
      business_email: 'sales@evidence-redirect.example',
      evidence: [{
        field: 'product',
        value: 'coffee',
        source_url: 'https://evidence-redirect.example/start',
        retrieved_at: '2026-07-16T00:00:00Z'
      }]
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
  assert.equal(db.prepare('SELECT COUNT(*) n FROM matrix_evidence').get().n, 3);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM matrix_classifications').get().n, 3);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM customers').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_messages').get().n, 0);
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
      'https://multi-hop.example/landing'
    ]
  );
  assert(transportCalls.some(call => call.url === 'https://evidence-hop.example/final'));

  const rebindingRun = createRun(db, { name: 'dns-rebinding', countries: ['Thailand'] });
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
      evidence: [{
        field: 'product',
        value: 'coffee',
        source_url: 'https://rebind-evidence.example/products',
        retrieved_at: '2026-07-16T00:00:00Z'
      }]
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

  const ordinaryFetchRun = createRun(db, { name: 'ordinary-fetch-rejected', countries: ['Thailand'] });
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

  const ipv6Run = createRun(db, { name: 'public-ipv6', countries: ['Indonesia'] });
  const ipv6Summary = await importDiscoveryBatch(db, ipv6Run.id, [
    discoveryRecord('ipv6', {
      country: 'Indonesia',
      official_url: 'https://[2001:db8::10]/',
      business_email: 'sales@ipv6.example',
      evidence: [{
        field: 'product',
        value: 'coffee',
        source_url: 'https://[2001:db8::10]/products',
        retrieved_at: '2026-07-16T00:00:00Z'
      }]
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
  const pinnedLookup = await new Promise((resolve, reject) => {
    pinnedOptions.lookup('adapter.example', {}, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
  assert.deepEqual(pinnedLookup, { address: PUBLIC_ADDRESS, family: 4 });

  const defaultAdapterRun = createRun(db, { name: 'default-adapter', countries: ['Philippines'] });
  const defaultAdapterCaptures = [];
  const defaultAdapterSummary = await importDiscoveryBatch(db, defaultAdapterRun.id, [
    discoveryRecord('default-adapter', {
      country: 'Philippines',
      official_url: 'https://default-adapter.example/',
      business_email: 'sales@default-adapter.example',
      evidence: [{
        field: 'product',
        value: 'coffee',
        source_url: 'https://default-adapter.example/products',
        retrieved_at: '2026-07-16T00:00:00Z'
      }]
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

  const mismatchedAdapterRun = createRun(db, { name: 'mismatched-adapter', countries: ['Kazakhstan'] });
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

  const capRun = createRun(db, { name: 'country-cap', countries: ['Malaysia'] });
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

  const oversizedRun = createRun(db, { name: 'oversized', countries: ['Thailand'] });
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

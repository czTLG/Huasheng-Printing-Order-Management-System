'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-stream-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');

const { db, initDb } = require('../src/db');
const { createRun } = require('../src/lib/signalCache');
const {
  validatePublicUrl,
  normalizeDiscoveryRecord,
  importDiscoveryBatch
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

async function main() {
  initDb();

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
  const fetchCalls = [];
  const safeFetch = async (url, options) => {
    fetchCalls.push({ url, options });
    if (url === 'https://redirect.example/') {
      return response(302, 'http://10.0.0.1/admin');
    }
    return response(200);
  };

  const records = [
    discoveryRecord('valid'),
    discoveryRecord('india', { country: 'India' }),
    discoveryRecord('missing-source', {
      evidence: [{ field: 'product', value: 'coffee', retrieved_at: '2026-07-16T00:00:00Z' }]
    }),
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
    })
  ];
  const summary = await importDiscoveryBatch(db, run.id, records, {
    dnsLookup: publicDnsLookup,
    fetch: safeFetch,
    now: '2026-07-16'
  });
  assert.deepEqual(summary, {
    input: 5,
    excluded: 1,
    test: 0,
    noise: 0,
    needs_review: 0,
    valid: 1,
    errors: 3
  });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM matrix_entities').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM matrix_evidence').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM matrix_classifications').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM customers').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_messages').get().n, 0);
  assert(fetchCalls.some(call => call.url === 'https://redirect.example/'));
  assert(
    !fetchCalls.some(call => call.url === 'http://10.0.0.1/admin'),
    'blocked redirect destination must be revalidated before fetch'
  );

  const capRun = createRun(db, { name: 'country-cap', countries: ['Malaysia'] });
  const cappedRecords = Array.from({ length: 21 }, (_, index) => discoveryRecord(`cap-${index}`, {
    country: 'Malaysia'
  }));
  const capSummary = await importDiscoveryBatch(db, capRun.id, cappedRecords, {
    dnsLookup: publicDnsLookup,
    fetch: safeFetch,
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
      { dnsLookup: publicDnsLookup, fetch: safeFetch }
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

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { createCacheIndexView } = require('../src/lib/cacheIndexView');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-index-view-'));
const dbPath = path.join(dir, 'matrix.db');

function record(overrides) {
  return {
    id: 1,
    company_name: 'Alpha Foods',
    country_code: 'US',
    domain: 'alpha.test',
    url: 'https://alpha.test/',
    categories: '["coffee"]',
    formats: '["pouches"]',
    sizes: '["own factory"]',
    email: 'team@alpha.test',
    phone: '+1 202 555 0123',
    whatsapp: '+1 202 555 0456',
    contact_url: 'https://alpha.test/contact',
    priority: 'P0',
    fit: 91,
    demand_fit: 91,
    access: 80,
    confidence: 0.92,
    status: 'valid',
    assessment: '官网确认咖啡产品。',
    stage_code: 'observed',
    audit_state: 'audited',
    updated_at: '2026-07-16T00:00:00Z',
    ...overrides
  };
}

const db = new Database(dbPath);
try {
  db.exec(`
    CREATE TABLE cache_records (
      id INTEGER PRIMARY KEY, company_name TEXT, country_code TEXT, city TEXT,
      normalized_domain TEXT UNIQUE, official_url TEXT, product_categories_json TEXT,
      format_signals_json TEXT, size_signals_json TEXT, scale_tier TEXT,
      public_email TEXT, public_phone TEXT, public_whatsapp TEXT, contact_url TEXT,
      priority TEXT, fit_score REAL, demand_fit_score REAL, access_score REAL,
      confidence REAL, status TEXT, assessment_cn TEXT, next_action_cn TEXT,
      stage_code TEXT, audit_state TEXT, audit_note TEXT, audited_at TEXT, updated_at TEXT
    );
    CREATE TABLE cache_evidence (
      id INTEGER PRIMARY KEY, record_id INTEGER, source_url TEXT, source_type TEXT,
      page_title TEXT, observed_at TEXT, excerpt TEXT, fingerprint TEXT
    );
    CREATE TABLE cache_discovery (
      id INTEGER PRIMARY KEY, record_id INTEGER, normalized_domain TEXT,
      discovered_via TEXT, discovery_url TEXT, official_url TEXT, source_type TEXT,
      verified_at TEXT, fingerprint TEXT
    );
  `);
  const insertRecord = db.prepare(`INSERT INTO cache_records VALUES (
    @id,@company_name,@country_code,'',@domain,@url,@categories,@formats,@sizes,'medium',
    @email,@phone,@whatsapp,@contact_url,@priority,@fit,@demand_fit,@access,@confidence,
    @status,@assessment,'核实联系入口',@stage_code,@audit_state,NULL,NULL,@updated_at
  )`);
  [
    record({}),
    record({ id: 2, company_name: 'Beta Tea', country_code: 'GB', domain: 'beta.test', url: 'https://beta.test/', categories: '["tea"]', formats: '["sachets"]', sizes: '["exports"]', email: '', phone: '', whatsapp: '', contact_url: '', priority: 'P1', fit: 82, demand_fit: 82, access: 60, confidence: 0.84, assessment: '官网确认茶产品。', updated_at: '2026-07-15T00:00:00Z' }),
    record({ id: 3, company_name: 'Blocked', country_code: 'IN', domain: 'blocked.test', url: 'https://blocked.test/', priority: 'P0', fit: 99, demand_fit: 99, access: 90, confidence: 0.99, assessment: 'excluded', updated_at: '2026-07-17T00:00:00Z' }),
    record({ id: 4, company_name: 'Suppressed', country_code: 'CA', domain: 'suppressed.test', url: 'https://suppressed.test/', stage_code: 'suppressed', priority: 'P0', fit: 98, demand_fit: 98, access: 90 }),
    record({ id: 5, company_name: 'Delta Pet', country_code: 'DE', domain: 'delta.test', url: 'https://delta.test/', categories: '["pet food"]', priority: 'P0', fit: 95, demand_fit: 95, access: 90, audit_state: 'unreviewed' }),
    record({ id: 6, company_name: 'Gamma Coffee', country_code: 'US', domain: 'gamma.test', url: 'https://gamma.test/', categories: '["coffee"]', priority: 'P1', fit: 85, demand_fit: 85, access: 50 }),
    record({ id: 7, company_name: 'Eta Snacks', country_code: 'FR', domain: 'eta.test', url: 'https://eta.test/', categories: '["snacks"]', priority: 'P2', fit: 90, demand_fit: 90, access: 80 }),
    record({ id: 8, company_name: 'Epsilon Snacks', country_code: 'BR', domain: 'epsilon.test', url: 'https://epsilon.test/', categories: '["snacks"]', priority: 'P1', fit: 85, demand_fit: 85, access: 70 }),
    record({ id: 9, company_name: 'Zeta Tea', country_code: 'AU', domain: 'zeta.test', url: 'https://zeta.test/', categories: '["tea"]', priority: 'P1', fit: 96, demand_fit: 96, access: 90, audit_state: 'unreviewed' })
  ].forEach(row => insertRecord.run(row));
  db.prepare('INSERT INTO cache_evidence VALUES (1,1,?,?,?,?,?,?)').run('https://alpha.test/products', 'official_website', 'Products', '2026-07-16T00:00:00Z', 'Coffee products', 'e1');
  db.prepare('INSERT INTO cache_discovery VALUES (1,1,?,?,?,?,?,?,?)').run('alpha.test', 'official_association_directory', 'https://association.test/members', 'https://alpha.test/', 'official_association_directory', '2026-07-16T00:00:00Z', 'd1');
} finally {
  db.close();
}

const view = createCacheIndexView({ dbPath });
try {
  const page = view.list({ region: 'americas', category: 'coffee', page: 1, pageSize: 10 });
  assert.deepStrictEqual(page.rows.map(row => row.id), [1, 6]);
  assert.strictEqual(page.rows[0].contacts.email, 't***@alpha.test');
  assert.strictEqual(page.rows[0].contacts.phone, '***0123');
  assert.strictEqual(page.rows[0].contacts.whatsapp, '***0456');
  assert.strictEqual(page.rows[0].contacts.contact_page, '[available]');
  assert.strictEqual(page.page, 1);
  assert.strictEqual(page.page_size, 10);
  assert.strictEqual(page.total, 2);
  assert.strictEqual(page.total_pages, 1);
  assert.match(page.snapshot_key, /^[a-f0-9]{64}$/);

  const facets = view.facets();
  assert.ok(facets.regions.some(item => item.value === 'americas' && item.count === 3));
  assert.ok(facets.countries.some(item => item.value === 'US' && item.count === 2));
  assert.ok(facets.categories.some(item => item.value === 'coffee' && item.count === 2));
  assert.ok(!facets.countries.some(item => item.value === 'IN'));

  const detail = view.detail(1);
  assert.strictEqual(detail.discovery.discovered_via, 'official_association_directory');
  assert.strictEqual(detail.evidence[0].source_url, 'https://alpha.test/products');
  assert.strictEqual(detail.contacts.email, 't***@alpha.test');
  assert.strictEqual(detail.contacts.contact_page, '[available]');
  assert.strictEqual(detail.discovery.discovery_url, 'https://association.test/members');
  assert.notStrictEqual(detail.evidence[0].source_url, detail.discovery.discovery_url);

  const revealed = view.detail(1, { revealContacts: true });
  assert.strictEqual(revealed.contacts.email, 'team@alpha.test');
  assert.strictEqual(revealed.contacts.phone, '+1 202 555 0123');
  assert.strictEqual(revealed.contacts.whatsapp, '+1 202 555 0456');
  assert.strictEqual(revealed.contacts.contact_page, 'https://alpha.test/contact');

  assert.strictEqual(view.detail(3), null);
  assert.deepStrictEqual(view.recommend({ limit: 99, excludeIds: [] }).map(row => row.id), [1, 5, 8, 6, 2]);
  assert.deepStrictEqual(view.recommend({ limit: 99, excludeIds: [1, 5] }).map(row => row.id), [8, 6, 2, 9, 7]);

  const previousPath = process.env.MATRIX_STREAM_DB_PATH;
  process.env.MATRIX_STREAM_DB_PATH = path.join(dir, 'missing.db');
  try {
    const explicitView = createCacheIndexView({ dbPath });
    assert.strictEqual(explicitView.facets().countries.length, 6);
    explicitView.close();
  } finally {
    if (previousPath === undefined) delete process.env.MATRIX_STREAM_DB_PATH;
    else process.env.MATRIX_STREAM_DB_PATH = previousPath;
  }
} finally {
  view.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('cache index view tests passed');

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { createCacheIndexView, NEARBY_COUNTRY_CODES, REQUIRED_COLUMNS } = require('../src/lib/cacheIndexView');
const regionByCountry = require('../src/lib/matrixRegions.json');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-index-view-'));
const dbPath = path.join(dir, 'matrix.db');

function record(overrides) {
  const row = {
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
  if (!Object.prototype.hasOwnProperty.call(overrides, 'audited_at')) row.audited_at = row.updated_at;
  return row;
}

const db = new Database(dbPath);
try {
  db.pragma('journal_mode = WAL');
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
    CREATE TABLE cache_relationships (
      id INTEGER PRIMARY KEY, record_id INTEGER NOT NULL, supplier_name TEXT NOT NULL,
      supplier_country_code TEXT, supplied_category TEXT, confidence TEXT NOT NULL,
      source_url TEXT NOT NULL, source_type TEXT NOT NULL, observed_at TEXT NOT NULL,
      excerpt TEXT NOT NULL, fingerprint TEXT NOT NULL UNIQUE
    );
    CREATE TABLE cache_strategy_signals (
      id INTEGER PRIMARY KEY, record_id INTEGER NOT NULL, entry_product TEXT NOT NULL,
      differentiation_angle TEXT NOT NULL, first_contact_goal TEXT NOT NULL,
      questions_json TEXT NOT NULL, risks_json TEXT NOT NULL, source_url TEXT NOT NULL,
      observed_at TEXT NOT NULL, fingerprint TEXT NOT NULL UNIQUE
    );
  `);
  const insertRecord = db.prepare(`INSERT INTO cache_records VALUES (
    @id,@company_name,@country_code,'',@domain,@url,@categories,@formats,@sizes,'medium',
    @email,@phone,@whatsapp,@contact_url,@priority,@fit,@demand_fit,@access,@confidence,
    @status,@assessment,'核实联系入口',@stage_code,@audit_state,NULL,@audited_at,@updated_at
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
    record({ id: 9, company_name: 'Zeta Tea', country_code: 'AU', domain: 'zeta.test', url: 'https://zeta.test/', categories: '["tea"]', priority: 'P1', fit: 96, demand_fit: 96, access: 90, audit_state: 'unreviewed' }),
    record({ id: 10, company_name: 'Blocked CN', country_code: 'CN', domain: 'blocked-cn.test', url: 'https://blocked-cn.test/', priority: 'P0', fit: 100, demand_fit: 100, access: 100 }),
    record({ id: 11, company_name: 'Invalid Status', country_code: 'CA', domain: 'invalid.test', url: 'https://invalid.test/', priority: 'P0', fit: 100, demand_fit: 100, access: 100, status: 'invalid' }),
    record({ id: 12, company_name: 'Review Queue', country_code: 'NZ', domain: 'review.test', url: 'https://review.test/', categories: '["coffee"]', priority: 'P3', fit: 60, demand_fit: 60, access: 20, status: 'needs_review' }),
    record({ id: 13, company_name: 'No Contact', country_code: 'JP', domain: 'no-contact.test', url: 'https://no-contact.test/', categories: '["cosmetics"]', email: '', phone: '', whatsapp: '', contact_url: '', priority: 'P2' }),
    record({ id: 14, company_name: 'Stale Audit', country_code: 'JP', domain: 'stale-audit.test', url: 'https://stale-audit.test/', categories: '["cosmetics"]', priority: 'P2', audited_at: '2026-07-15T00:00:00Z', updated_at: '2026-07-16T00:00:00Z' }),
    record({ id: 15, company_name: 'Missing Audit Time', country_code: 'JP', domain: 'missing-audit-time.test', url: 'https://missing-audit-time.test/', categories: '["cosmetics"]', priority: 'P2', audited_at: null }),
    record({ id: 16, company_name: 'Ready Stage', country_code: 'VN', domain: 'ready.test', url: 'https://ready.test/', categories: '["stage-test"]', stage_code: 'recommendation_ready', priority: 'P1' }),
    ...['unknown', 'pending', 'terminal', 'bounced', 'opted_out', 'delivered', 'draft_pending', 'selected'].map((stage_code, index) => record({ id: 17 + index, company_name: `Rejected ${stage_code}`, country_code: 'DE', domain: `rejected-${index}.test`, url: `https://rejected-${index}.test/`, categories: '["stage-test"]', stage_code, priority: 'P3' }))
  ].forEach(row => insertRecord.run(row));
  db.prepare('INSERT INTO cache_evidence VALUES (1,1,?,?,?,?,?,?)').run('https://alpha.test/products', 'official_website', 'Products', '2026-07-16T00:00:00Z', 'Coffee products', 'e1');
  db.prepare('INSERT INTO cache_evidence VALUES (2,1,?,?,?,?,?,?)').run('https://association.test/members', 'official_association_directory', 'Member directory', '2026-07-15T00:00:00Z', 'Association listing', 'e2');
  db.prepare('INSERT INTO cache_evidence VALUES (3,1,?,?,?,?,?,?)').run('https://regulator.test/certificate', 'official_regulator', 'Quality certificate', '2026-07-16T00:00:00Z', 'Current manufacturing certificate', 'e3');
  db.prepare('INSERT INTO cache_evidence VALUES (4,1,?,?,?,?,?,?)').run('https://registry.test/company', 'official_registry', 'Company registry', '2026-07-16T00:00:00Z', 'Current legal entity record', 'e4');
  db.prepare('INSERT INTO cache_discovery VALUES (1,1,?,?,?,?,?,?,?)').run('alpha.test', 'official_association_directory', 'https://association.test/members', 'https://alpha.test/', 'official_association_directory', '2026-07-16T00:00:00Z', 'd1');
  let evidenceId = 10;
  let discoveryId = 10;
  const addOfficial = id => db.prepare('INSERT INTO cache_evidence VALUES (?,?,?,?,?,?,?,?)').run(evidenceId++, id, `https://record-${id}.test/products`, 'official_website', 'Products', '2026-07-16T00:00:00Z', 'Public products', `e-${id}`);
  const addDiscovery = id => db.prepare('INSERT INTO cache_discovery VALUES (?,?,?,?,?,?,?,?,?)').run(discoveryId++, id, `record-${id}.test`, 'official_directory', `https://directory.test/${id}`, `https://record-${id}.test/`, 'official_directory', '2026-07-16T00:00:00Z', `d-${id}`);
  for (const id of [5, 7, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]) addOfficial(id);
  for (const id of [5, 6, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]) addDiscovery(id);
  db.prepare('INSERT INTO cache_relationships VALUES (1,16,?,?,?,?,?,?,?,?,?)').run(
    'Benchmark Supplier', 'CN', 'fruit jelly laminated film', 'confirmed',
    'https://trade.test/record', 'public_trade_record', '2026-07-17T00:00:00Z',
    'Named buyer and supplier', 'relationship-16'
  );
  db.prepare('INSERT INTO cache_strategy_signals VALUES (1,16,?,?,?,?,?,?,?,?)').run(
    'fruit jelly laminated roll film', 'stable nearby supply and structure review',
    'confirm current structure and annual consumption', '["年用量","现有结构"]',
    '["公开关系未必代表当前独家供应"]', 'https://trade.test/record',
    '2026-07-17T00:00:00Z', 'strategy-16'
  );
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
  assert.strictEqual(page.rows[0].stage_code, 'observed');
  assert.strictEqual(page.page, 1);
  assert.strictEqual(page.page_size, 10);
  assert.strictEqual(page.total, 2);
  assert.strictEqual(page.total_pages, 1);
  assert.match(page.snapshot_key, /^[a-f0-9]{64}$/);

  const unfiltered = view.list({ page: 1, pageSize: 50 });
  const priorityP0 = view.list({ priority: 'P0', page: 1, pageSize: 50 });
  const needsReview = view.list({ status: 'needs_review', page: 1, pageSize: 50 });
  assert.deepStrictEqual(priorityP0.rows.map(row => row.id), [1, 5]);
  assert.strictEqual(priorityP0.total, 2);
  assert.deepStrictEqual(needsReview.rows.map(row => row.id), [12]);
  assert.strictEqual(needsReview.total, 1);
  assert.notStrictEqual(priorityP0.snapshot_key, unfiltered.snapshot_key);
  assert.notStrictEqual(needsReview.snapshot_key, unfiltered.snapshot_key);
  assert.notStrictEqual(priorityP0.snapshot_key, needsReview.snapshot_key);

  const facets = view.facets();
  assert.ok(facets.regions.some(item => item.value === 'americas' && item.count === 3));
  assert.ok(facets.countries.some(item => item.value === 'US' && item.count === 2));
  assert.ok(facets.categories.some(item => item.value === 'coffee' && item.count === 3));
  assert.ok(!facets.countries.some(item => item.value === 'IN'));
  assert.ok(!facets.countries.some(item => item.value === 'CN'));
  assert.ok(!facets.countries.some(item => item.value === 'CA'));
  assert.ok(facets.countries.some(item => item.value === 'NZ' && item.count === 1));

  const detail = view.detail(1);
  assert.strictEqual(detail.discovery.discovered_via, 'official_association_directory');
  assert.deepStrictEqual(detail.evidence, detail.official_evidence);
  assert.deepStrictEqual(detail.official_evidence.map(item => item.source_url), [
    'https://alpha.test/products',
    'https://regulator.test/certificate',
    'https://registry.test/company',
    'https://association.test/members'
  ]);
  assert.deepStrictEqual(detail.supporting_evidence, []);
  assert.strictEqual(detail.contacts.email, 't***@alpha.test');
  assert.strictEqual(detail.contacts.contact_page, '[available]');
  assert.strictEqual(detail.discovery.discovery_url, 'https://association.test/members');
  assert.strictEqual(detail.stage_code, 'observed');
  assert.notStrictEqual(detail.official_evidence[0].source_url, detail.discovery.discovery_url);

  const signaledDetail = view.detail(16);
  assert.deepStrictEqual(signaledDetail.supplier_signal, {
    supplier_name: 'Benchmark Supplier', supplier_country_code: 'CN',
    supplied_category: 'fruit jelly laminated film', confidence: 'confirmed',
    source_url: 'https://trade.test/record', source_type: 'public_trade_record',
    observed_at: '2026-07-17T00:00:00Z', excerpt: 'Named buyer and supplier'
  });
  assert.deepStrictEqual(signaledDetail.strategy_signal.questions, ['年用量', '现有结构']);
  assert.deepStrictEqual(signaledDetail.strategy_signal.risks, ['公开关系未必代表当前独家供应']);

  const revealed = view.detail(1, { revealContacts: true });
  assert.strictEqual(revealed.contacts.email, 'team@alpha.test');
  assert.strictEqual(revealed.contacts.phone, '+1 202 555 0123');
  assert.strictEqual(revealed.contacts.whatsapp, '+1 202 555 0456');
  assert.strictEqual(revealed.contacts.contact_page, 'https://alpha.test/contact');

  assert.strictEqual(view.detail(3), null);
  assert.strictEqual(view.detail(10), null);
  assert.strictEqual(view.detail(11), null);
  assert.strictEqual(view.detail(12).status, 'needs_review');
  assert.deepStrictEqual(view.recommend({ limit: 99, excludeIds: [] }).map(row => row.id), [16]);
  assert.deepStrictEqual(view.recommend({ limit: 99, excludeIds: [16] }).map(row => row.id), []);
  assert.deepStrictEqual(view.recommend({ limit: 2.9 }).map(row => row.id), [16]);
  assert.deepStrictEqual(view.recommend({ limit: -3 }), []);
  assert.deepStrictEqual(view.recommend({ limit: 'invalid' }), []);
  assert.deepStrictEqual(view.recommend({ limit: Infinity }), []);
  assert.strictEqual(view.recommend().length, 1);
  assert.ok(view.recommend().every(row => ['observed', 'recommendation_ready'].includes(row.stage_code)));
  assert.ok(view.recommend().every(row => NEARBY_COUNTRY_CODES.has(row.country_code)));
  assert.deepStrictEqual(view.recommend()[0].supplier_signal, {
    supplier_name: 'Benchmark Supplier', supplier_country_code: 'CN',
    supplied_category: 'fruit jelly laminated film', confidence: 'confirmed',
    source_url: 'https://trade.test/record', source_type: 'public_trade_record',
    observed_at: '2026-07-17T00:00:00Z', excerpt: 'Named buyer and supplier'
  });
  assert.deepStrictEqual(view.recommend()[0].strategy_signal.questions, ['年用量', '现有结构']);
  assert.strictEqual(view.ready(), true);
  const strictPage1 = view.recommendPage({ page: 1, page_size: 1 });
  const strictPage2 = view.recommendPage({ page: 2, page_size: 1 });
  assert.deepStrictEqual(strictPage1.rows.map(row => row.id), [16]);
  assert.deepStrictEqual(strictPage2.rows.map(row => row.id), []);
  assert.strictEqual(strictPage1.total, 1);
  assert.strictEqual(strictPage1.total_pages, 1);
  assert.strictEqual(strictPage1.snapshot_key, strictPage2.snapshot_key);
  assert.strictEqual(strictPage1.snapshot_key, view.recommendPage({ page: 1, page_size: 2 }).snapshot_key);
  const mutationDb = new Database(dbPath);
  mutationDb.prepare("UPDATE cache_records SET updated_at = audited_at WHERE id = 16").run();
  mutationDb.prepare("UPDATE cache_records SET updated_at = '2026-07-15T00:00:00Z', audited_at = '2026-07-15T00:00:00Z' WHERE id = 16").run();
  mutationDb.close();
  const driftedPage2 = view.recommendPage({ page: 2, page_size: 1 });
  assert.notStrictEqual(driftedPage2.snapshot_key, strictPage1.snapshot_key);

  let insertedBetweenReads = false;
  const atomicView = createCacheIndexView({
    dbPath,
    afterRecommendationMembership: () => {
      if (insertedBetweenReads) return;
      insertedBetweenReads = true;
      const writer = new Database(dbPath);
      try {
        writer.prepare(`INSERT INTO cache_records (id, company_name, country_code, city, normalized_domain, official_url, product_categories_json, format_signals_json, size_signals_json, scale_tier, public_email, public_phone, public_whatsapp, contact_url, priority, fit_score, demand_fit_score, access_score, confidence, status, assessment_cn, next_action_cn, stage_code, audit_state, audit_note, audited_at, updated_at) VALUES (25, 'Atomic Insert', 'VN', '', 'atomic.test', 'https://atomic.test/', '["coffee"]', '[]', '[]', 'medium', 'team@atomic.test', '', '', 'https://atomic.test/contact', 'P0', 100, 100, 100, 0.99, 'valid', '公开证据', '核实入口', 'observed', 'audited', NULL, '2026-07-17T00:00:00Z', '2026-07-17T00:00:00Z')`).run();
        writer.prepare("INSERT INTO cache_evidence (id, record_id, source_url, source_type, page_title, observed_at, excerpt, fingerprint) VALUES (99,25,'https://atomic.test/products','official_website','Products','2026-07-17T00:00:00Z','Products','atomic-e')").run();
        writer.prepare("INSERT INTO cache_discovery (id, record_id, normalized_domain, discovered_via, discovery_url, official_url, source_type, verified_at, fingerprint) VALUES (99,25,'atomic.test','official_directory','https://directory.test/atomic','https://atomic.test/','official_directory','2026-07-17T00:00:00Z','atomic-d')").run();
      } finally { writer.close(); }
    }
  });
  try {
    const atomicOld = atomicView.recommendPage({ page: 1, page_size: 5 });
    assert.strictEqual(atomicOld.total, 1);
    assert.deepStrictEqual(atomicOld.rows.map(row => row.id), [16]);
    const atomicNew = atomicView.recommendPage({ page: 1, page_size: 5 });
    assert.strictEqual(atomicNew.total, 2);
    assert.deepStrictEqual(atomicNew.rows.map(row => row.id), [25, 16]);
    assert.notStrictEqual(atomicOld.snapshot_key, atomicNew.snapshot_key);
  } finally { atomicView.close(); }
  const throwingView = createCacheIndexView({ dbPath, afterRecommendationMembership: () => { throw new Error('injected membership failure'); } });
  try { assert.throws(() => throwingView.recommendPage({ page: 1, page_size: 5 }), /injected membership failure/); }
  finally { throwingView.close(); }
  assert.deepStrictEqual(view.recommendPage({ category: 'missing', page: 1, page_size: 5 }).rows, []);

  const allowedRegions = new Set(['africa', 'americas', 'asia', 'europe', 'oceania']);
  const requiredIsoCodes = ['AQ', 'AX', 'BL', 'BV', 'CC', 'CX', 'EH', 'FO', 'GG', 'GI', 'GS', 'HM', 'IM', 'IO', 'JE', 'MF', 'SH', 'SJ', 'TF', 'UM'];
  assert.strictEqual(Object.keys(regionByCountry).length, 247);
  assert.ok(requiredIsoCodes.every(code => allowedRegions.has(regionByCountry[code])));
  assert.strictEqual(regionByCountry.CN, undefined);
  assert.strictEqual(regionByCountry.IN, undefined);
  assert.strictEqual(regionByCountry.XK, undefined);
  assert.ok(Object.values(regionByCountry).every(region => allowedRegions.has(region)));

  const previousPath = process.env.MATRIX_STREAM_DB_PATH;
  process.env.MATRIX_STREAM_DB_PATH = path.join(dir, 'missing.db');
  try {
    const explicitView = createCacheIndexView({ dbPath });
    assert.strictEqual(explicitView.facets().countries.length, 9);
    explicitView.close();
  } finally {
    if (previousPath === undefined) delete process.env.MATRIX_STREAM_DB_PATH;
    else process.env.MATRIX_STREAM_DB_PATH = previousPath;
  }
  assert.deepStrictEqual(Object.fromEntries(Object.entries(REQUIRED_COLUMNS).map(([table, columns]) => [table, columns.length])), { cache_records: 26, cache_evidence: 7, cache_discovery: 7 });
  let malformedIndex = 0;
  for (const [missingTable, columns] of Object.entries(REQUIRED_COLUMNS)) {
    for (const missingColumn of columns) {
      const malformedPath = path.join(dir, `malformed-${malformedIndex++}.db`);
      const malformedDb = new Database(malformedPath);
      for (const [table, tableColumns] of Object.entries(REQUIRED_COLUMNS)) {
        const included = tableColumns.filter(column => table !== missingTable || column !== missingColumn);
        malformedDb.exec(`CREATE TABLE ${table} (${included.map(column => `${column} ${column === 'id' ? 'INTEGER PRIMARY KEY' : 'TEXT'}`).join(', ')})`);
      }
      malformedDb.close();
      const malformedView = createCacheIndexView({ dbPath: malformedPath });
      try { assert.throws(() => malformedView.ready(), /schema incomplete/, `${missingTable}.${missingColumn} must be required`); }
      finally { malformedView.close(); }
    }
  }
} finally {
  view.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('cache index view tests passed');

#!/usr/bin/env node
'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const { createCacheIndexView, BASE_WHERE, CURRENT_REVIEW_WHERE, RECOMMENDATION_WHERE, NEARBY_COUNTRY_CODES } = require('../src/lib/cacheIndexView');

const ROOT = path.resolve(__dirname, '..');
const ELIGIBLE = RECOMMENDATION_WHERE;
const FOCUSED_TESTS = [
  'scripts/test-cache-index-view.js',
  'scripts/test-matrix-record-import.js',
  'scripts/test-matrix-signal-import.js',
  'scripts/test-packet-gate.js',
  'scripts/test-matrix-api.js',
  'scripts/test-matrix-stream-preview.js',
  '.runtime/vm_debug_ci/workspace/tests/test-bridge-patch.js',
  '.runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js',
  '.runtime/vm_debug_ci/workspace/tests/test-runtime-supervisor.js',
  'scripts/test-bridge-artifact-local-input.js',
  'scripts/test-bridge-artifact-0.6.9.js',
  'scripts/test-verify-matrix-readonly-selection.js'
];
const RUNTIME_SURFACE_ROOTS = [
  '.runtime/vm_debug_ci/Dockerfile',
  '.runtime/vm_debug_ci/compose.yaml',
  '.runtime/vm_debug_ci/bridge-patch',
  '.runtime/vm_debug_ci/workspace/extensions',
  '.runtime/vm_debug_ci/workspace/scripts',
  'src/db.js',
  'src/server.js',
  'src/lib/cacheIndexView.js',
  'src/lib/imapSync.js',
  'src/lib/matrixInboxStore.js',
  'src/lib/packetGate.js',
  'src/services/matrixInbox.js',
  'src/services/matrixInboxAi.js',
  'src/services/matrixInboxScheduler.js',
  'src/services/matrixOverview.js',
  'src/services/matrixThreadContext.js',
  'src/services/matrixThreadReview.js',
  'src/services/matrixThreadReconcile.js',
  'src/routes/crm.js',
  'src/routes/matrix.js',
  'scripts/run-matrix-inbox-ai.js',
  'shared/matrix-inbox-ai.schema.json',
  'src/services/matrixStreamReview.js',
  'src/services/matrixStreamText.js',
  'src/services/matrixStreamGate.js',
  'src/services/matrixStreamReadiness.js',
  'src/services/matrixStreamFollowup.js',
  'src/services/matrixStreamDelivery.js',
  'src/services/matrixRelayFactory.js',
  'src/services/matrixStreamPreview.js',
  'src/services/matrixStreamCorrelation.js',
  'src/services/matrixThreadRoute.js',
  'src/services/matrixThreadPreview.js',
  'src/services/matrixThreadDelivery.js',
  'deploy/systemd/packaging-system-relay.conf',
  'scripts/matrix-bind-actor.js'
].map(file => path.join(ROOT, file));
// Reviewed production-only surface. Tests and verifier sources are deliberately excluded.
// Any production edit requires review plus an explicit digest update here.
const RUNTIME_MANIFEST = {
  '.runtime/vm_debug_ci/Dockerfile': '0389bfbc40f8523f598a4becd211d77c7fde646b9a751ed628183e065280d203',
  '.runtime/vm_debug_ci/compose.yaml': '52e50645af6010d6a2507aa1b119427286d14d1a7cca9016e70cf860210b26bf',
  '.runtime/vm_debug_ci/bridge-patch/patch-stream-card.cjs': 'f69716c2edefb4756599d442454d03deb6881bdc309ebf1061d0a5a26161a5ae',
  '.runtime/vm_debug_ci/workspace/extensions/stream-card.cjs': 'a5c6b72a47a0546ab4bd4dcda857f068cd2a0648ae5c1ad49884bb59d2b3216b',
  '.runtime/vm_debug_ci/workspace/scripts/cache-index.js': '8a96087d1e50a2a60749ead0a5218ef69a2cc9a9328f0d8dd1d2a1dc20ef9077',
  '.runtime/vm_debug_ci/workspace/scripts/cache-math.js': 'c3a61459c289295d10a3d01387368d3e2c9000194d105bcc840ab1b17d565716',
  '.runtime/vm_debug_ci/workspace/scripts/matrix-asset-context.js': '800332ee7ee5dbb39d0ef9b43ff56cce0f509f88743d05d4e54ea33d5f60881c',
  '.runtime/vm_debug_ci/workspace/scripts/matrix-choice-context.js': 'e24460e506008a4024185726fe78526bf585d3a1c79e00c657be361f32208d13',
  '.runtime/vm_debug_ci/workspace/scripts/matrix-client.js': '54dbcf4f48533dbb8cd22431655fe10aefd8d76c1bb34ca07c45dca37c14858f',
  '.runtime/vm_debug_ci/workspace/scripts/matrix-context.js': '3a5b1a652eba25bffc537f98aae6e9c0156f541a92d619b6fb662e3c574db8b1',
  '.runtime/vm_debug_ci/workspace/scripts/matrix-inbox-watch.js': 'd505f1abe96093499f0ec1245c39fec9e04c32647d2961187192393825072d0f',
  '.runtime/vm_debug_ci/workspace/scripts/matrix-runtime.js': '02c49cdd5705ea4f6362eb2ff36e8eef29e8532dad1944616b13f745f0a88e5b',
  '.runtime/vm_debug_ci/workspace/scripts/matrix-watch.js': 'f3438068355efaaf7dc6f97430501fee2232c9c2ed7d1dec2284547736dd51e7',
  '.runtime/vm_debug_ci/workspace/scripts/packet-math.js': '616911977d633fa3ec6f881736c1e6c3624ad0dbb3f9f2967c3560a81c0e712c',
  '.runtime/vm_debug_ci/workspace/scripts/packet-route.js': '4bf8e3ec9d441a2eb73f7ffcc5e201866c6e374239268feac59616e2ed9c31d1',
  '.runtime/vm_debug_ci/workspace/scripts/stream-watch.js': '2e32706a6dcff90bea2949a1d10989c6c0f2b4242ec2058e2f3979d6f1ed6fe0',
  'src/db.js': 'e2127e9b4f77e9f687e00d4b69c1b2a9ef19f348dbec6324cabc1c3a05f9e4c1',
  'src/server.js': '5a4e3c373ae27671cf0e21212a89d20094a0cd2383960d6a123dc6f8c3d49383',
  'src/lib/cacheIndexView.js': 'c2c314d2b50f315620f52ff2f633b78bfdb866898723e68c2bc744eeca978017',
  'src/lib/imapSync.js': '334ee32f5709b1ce573980940616cd7a012e72e3910393c8d6456de52fedcb59',
  'src/lib/matrixInboxStore.js': '606f0a55ca3a21fcb582ebe262ef84bb3849031a080e34c18db1dd323230b792',
  'src/lib/packetGate.js': '2fea59af911c177dc4f35b3b29b5984d07e1181128545ec64063fdf4ffba6d6a',
  'src/services/matrixInbox.js': '90aa5d355ba030bf117cc238beac400252009b043ff7dad69b0494f54240e981',
  'src/services/matrixInboxAi.js': '4bf769922fc251bee7ca0bd82868e269409693b6ca14f8f5772447bdbbb4183f',
  'src/services/matrixInboxScheduler.js': '85add4678209735d5f54f84576ecaa06b30d4a35940ff1b926cb83e9a88aba41',
  'src/services/matrixOverview.js': 'db51cdcd5e1f99760254e9da146e22149e6cc8eed337926564dc65fbd00ebc5c',
  'src/services/matrixThreadContext.js': '296520b058bbe6f090c3adc66954d219f7ccb0f15b3266fc4d4e4f43c58549f1',
  'src/services/matrixThreadReview.js': 'b7b871a98cd65d081206a31fdb1dd41bb98b8a86c9e9b1ab6250df3f4ec58d4a',
  'src/services/matrixThreadReconcile.js': '4cbb5183c50614de9426f1d5124b12336e0ff8ca27b11e9f5ad1c9cded333dcc',
  'src/routes/crm.js': 'e1462f04cb57c8cc10c0f3ad08743ff4cebd4f6add08df99065bcd1929e052df',
  'src/routes/matrix.js': 'e46c55ce7e60fbf01bcff7ba9062be972e96d3e06eb7ef11a5b7e0e2391e5bdd',
  'scripts/run-matrix-inbox-ai.js': 'a7c549ecc796af9bbb7cb1ae17ed1ed081d6dad3b3ba37f75dba5843576def38',
  'shared/matrix-inbox-ai.schema.json': 'c92a5b5cfcc7e2255ea6277b4b8ac1a013405fdf6c1bf2c336c7b12224f08ef6',
  'src/services/matrixStreamReview.js': 'bf6da9b52f48658aef5f67a49c087950c166d11715474a7782c248c521677c85',
  'src/services/matrixStreamText.js': '7dfefdbc3ba37888bf0736b36c792ec64afc54651dbaa1efeb1f2e7ca2c68658',
  'src/services/matrixStreamGate.js': '86f99c2672ae6d58ccb5a35aa5cab7b1b4ffa6b3b7132b091a856469cb678c57',
  'src/services/matrixStreamReadiness.js': 'cd96aa53541f2b4e75e07ebbd94795fe54a0eb88156864e87ed6811f2477d0ea',
  'src/services/matrixStreamFollowup.js': 'bd4e6721b12d7b75323bb0ef23d21c7ea117c7c26b39ba6042a4d237950a5c01',
  'src/services/matrixStreamDelivery.js': 'b2903c4047bd9356cc37d2ec6ca88d30379e2d1c690b8c15420215de833f4640',
  'src/services/matrixRelayFactory.js': 'e1b009fc8c73ccaac3a9a1758a238d2df8e4d1373ad1b09e649020aff10d10e7',
  'src/services/matrixStreamPreview.js': 'dc1ce43c146776131ae1db5dfe91c61247e854ca24c3ab2b4fa371b8942dcf0e',
  'src/services/matrixStreamCorrelation.js': '6e0a3ebf457f05629b8886afa5f98c32c7abe0f07a1bbed6f6ec7c07479b0877',
  'src/services/matrixThreadRoute.js': '24ab7b4be3787b24ac4e24043a530e74f85581fa9a0d00b593d010f7584858d6',
  'src/services/matrixThreadPreview.js': '6b7889bb0a1a3a90f18133d6f08e33fd98f0b0178405984204f4a02cae926b1c',
  'src/services/matrixThreadDelivery.js': 'a082edc6031ae8cc09b97c5e6dea2a64840fd2933700328cb4ae200d5e04d627',
  'scripts/matrix-bind-actor.js': '984f43dd17ea5163b434f154751a9b4312b44999b180ff7d59e422190587e28c',
  'deploy/systemd/packaging-system-relay.conf': '5091086e6698028688afc2366da45d5e214da9c1a0fdeb6901470de02f35fb49'
};

function repositoryContract() {
  const env = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  for (const line of [
    'MATRIX_STREAM_DB_PATH=./data/matrix-stream.db',
    'MATRIX_BRIDGE_TOKEN=',
    'MATRIX_DELIVERY_ENABLED=0',
    'MATRIX_RELAY_ENABLED=0',
    'MATRIX_STREAM_SEND_ENABLED=0',
    'MATRIX_RECIPIENT_MAX_AGE_DAYS=180',
    'MATRIX_MESSAGE_ID_DOMAIN=',
    'MATRIX_TEXT_PROVIDER=mock',
    'MATRIX_DKIM_SELECTOR=',
    'MATRIX_DAILY_ACCEPTED_LIMIT=5',
    'MATRIX_DOMAIN_COOLING_DAYS=90',
    'MATRIX_RECOMMEND_HOUR=9',
    'MATRIX_RECOMMEND_MINUTE=0',
    'SMTP_HOST=',
    'SMTP_PORT=465',
    'SMTP_SECURE=true',
    'SMTP_USER=',
    'SMTP_PASS=',
    'SMTP_FROM='
  ]) assert.ok(env.split(/\r?\n/).includes(line), `.env.example missing ${line}`);

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.strictEqual(manifest.scripts?.['verify:matrix-readonly-selection'], 'node scripts/verify-matrix-readonly-selection.js');

  const catalogPath = path.join(ROOT, 'docs/matrix-stream-catalog-2026-07-16.md');
  const catalog = fs.readFileSync(catalogPath, 'utf8');
  for (const marker of [
    '/api/matrix', 'matrix-bind-actor.js', '开发客户', '1,500',
    '来源分离', '不存在外发适配器', 'MATRIX_DELIVERY_ENABLED=0', 'MATRIX_RELAY_ENABLED=0',
    'MATRIX_VERIFY_FIXTURE=1', 'fail closed',
    '桌面端', '移动端', 'mx.quick', 'vm_debug_ci_pre_',
    'matrixStreamReview.js', 'matrixStreamDelivery.js', '两次确认',
    'MATRIX_STREAM_SEND_ENABLED=0', 'bot 运行面', 'delivery_enabled: false'
  ]) assert.ok(catalog.includes(marker), `catalog missing ${marker}`);

  const server = fs.readFileSync(path.join(ROOT, 'src/server.js'), 'utf8');
  assert.ok(server.includes("process.env.MATRIX_RELAY_ENABLED === '1'"), 'production relay must require the exact reviewed enable flag');
  assert.ok(server.includes('deliveryService: matrixDeliveryService'), 'delivery must be injected only through the main application router');
  assert.ok(!server.includes('/etc/packaging-system/smtp.env'), 'server source must not read protected config directly');
}

function createCandidateFixture(root) {
  const dbPath = path.join(root, 'matrix-stream-fixture.db');
  const db = new Database(dbPath);
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
  const insert = db.prepare(`
    INSERT INTO cache_records VALUES (
      @id,@company,@country,'',@domain,@url,@categories,@formats,@sizes,'medium',
      '', '', '', @contact,@priority,@score,@score,70,0.9,@status,@assessment,
      '核实公开联系入口','observed','audited',NULL,'2026-07-17T00:00:00.000Z','2026-07-17T00:00:00.000Z'
    )
  `);
  const rows = [
    { id: 1, company: 'Fixture Coffee', country: 'US', domain: 'fixture-coffee.test', url: 'https://fixture-coffee.test/', categories: '["coffee"]', formats: '["pouch"]', sizes: '[]', contact: 'https://fixture-coffee.test/contact', priority: 'P0', score: 90, status: 'valid', assessment: '官网确认咖啡品类。' },
    { id: 2, company: 'Fixture Tea', country: 'GB', domain: 'fixture-tea.test', url: 'https://fixture-tea.test/', categories: '["tea"]', formats: '["sachet"]', sizes: '[]', contact: 'https://fixture-tea.test/contact', priority: 'P1', score: 80, status: 'needs_review', assessment: '官网确认茶品类，联系人待核实。' },
    { id: 3, company: 'Fixture Fruit', country: 'VN', domain: 'fixture-fruit.test', url: 'https://fixture-fruit.test/', categories: '["fruit"]', formats: '["roll film"]', sizes: '[]', contact: 'https://fixture-fruit.test/contact', priority: 'P0', score: 92, status: 'valid', assessment: '官网确认水果加工品类。' }
  ];
  for (const row of rows) {
    insert.run(row);
    db.prepare('INSERT INTO cache_evidence VALUES (?,?,?,?,?,?,?,?)').run(row.id, row.id, `${row.url}products`, 'official_website', 'Products', '2026-07-17T00:00:00.000Z', row.assessment, `e-${row.id}`);
    db.prepare('INSERT INTO cache_discovery VALUES (?,?,?,?,?,?,?,?,?)').run(row.id, row.id, row.domain, 'official_directory', `https://directory.test/${row.id}`, row.url, 'official_directory', '2026-07-17T00:00:00.000Z', `d-${row.id}`);
  }
  db.prepare('INSERT INTO cache_relationships VALUES (1,3,?,?,?,?,?,?,?,?,?)').run(
    'Fixture Supplier', 'CN', 'laminated roll film', 'confirmed',
    'https://trade.example.com/public-record', 'public_trade_record',
    '2026-07-17T00:00:00.000Z', 'Public record names both organizations.', 'fixture-relationship'
  );
  db.close();
  fs.chmodSync(dbPath, 0o600);
  return dbPath;
}

function candidateInput({ root = ROOT, temporary, env = process.env } = {}) {
  const fixtureSetting = String(env.MATRIX_VERIFY_FIXTURE || '').trim();
  if (fixtureSetting && fixtureSetting !== '1') throw new Error('MATRIX_VERIFY_FIXTURE must be exactly 1 when enabled');
  const configuredPath = String(env.MATRIX_STREAM_DB_PATH || '').trim();
  if (fixtureSetting === '1') {
    if (configuredPath) throw new Error('MATRIX_VERIFY_FIXTURE cannot be combined with MATRIX_STREAM_DB_PATH');
    if (!temporary) throw new Error('temporary fixture directory required');
    return { dbPath: createCandidateFixture(temporary), source: 'explicit-fixture' };
  }
  const selected = configuredPath || './data/matrix-stream.db';
  return {
    dbPath: path.resolve(root, selected),
    source: configuredPath ? 'configured-readonly-database' : 'default-readonly-database'
  };
}

function inspectCandidates(dbPath) {
  const stat = fs.statSync(dbPath);
  const candidateMode = (stat.mode & 0o777).toString(8).padStart(3, '0');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  try {
    const candidateIntegrity = db.pragma('integrity_check', { simple: true });
    const candidateCount = db.prepare(`SELECT COUNT(*) AS count FROM cache_records r WHERE ${ELIGIBLE}`).get().count;
    const duplicateDomains = db.prepare(`
      SELECT COUNT(*) AS count FROM (
        SELECT lower(normalized_domain) FROM cache_records
        WHERE normalized_domain IS NOT NULL AND normalized_domain <> ''
        GROUP BY lower(normalized_domain) HAVING COUNT(*) > 1
      )
    `).get().count;
    const excludedCountries = db.prepare("SELECT COUNT(*) AS count FROM cache_records WHERE country_code IN ('CN','IN')").get().count;
    const missingEvidence = db.prepare(`
      SELECT COUNT(*) AS count FROM cache_records r
      WHERE ${BASE_WHERE} AND NOT EXISTS (
        SELECT 1 FROM cache_evidence e
        WHERE e.record_id = r.id AND e.source_type = 'official_website' AND trim(COALESCE(e.source_url, '')) <> ''
      )
    `).get().count;
    const missingDiscovery = db.prepare(`
      SELECT COUNT(*) AS count FROM cache_records r
      WHERE ${BASE_WHERE} AND NOT EXISTS (SELECT 1 FROM cache_discovery d WHERE d.record_id = r.id)
    `).get().count;
    const recommendationMissingOfficialEvidence = db.prepare(`
      SELECT COUNT(*) AS count FROM cache_records r WHERE ${ELIGIBLE}
      AND NOT EXISTS (
        SELECT 1 FROM cache_evidence e
        WHERE e.record_id = r.id AND e.source_type = 'official_website' AND trim(COALESCE(e.source_url, '')) <> ''
      )
    `).get().count;
    const recommendationMissingDiscovery = db.prepare(`
      SELECT COUNT(*) AS count FROM cache_records r WHERE ${ELIGIBLE}
      AND NOT EXISTS (SELECT 1 FROM cache_discovery d WHERE d.record_id = r.id)
    `).get().count;
    const recommendationMissingContact = db.prepare(`
      SELECT COUNT(*) AS count FROM cache_records r WHERE ${ELIGIBLE}
      AND trim(COALESCE(r.public_email, '')) = ''
      AND trim(COALESCE(r.public_phone, '')) = ''
      AND trim(COALESCE(r.public_whatsapp, '')) = ''
      AND trim(COALESCE(r.contact_url, '')) = ''
    `).get().count;
    const recommendationStaleReview = db.prepare(`
      SELECT COUNT(*) AS count FROM cache_records r WHERE ${ELIGIBLE} AND NOT (${CURRENT_REVIEW_WHERE})
    `).get().count;
    const nearbySql = [...NEARBY_COUNTRY_CODES].map(() => '?').join(',');
    const recommendationOutsideNearby = db.prepare(`
      SELECT COUNT(*) AS count FROM cache_records r WHERE ${ELIGIBLE}
      AND r.country_code NOT IN (${nearbySql})
    `).get(...NEARBY_COUNTRY_CODES).count;
    const supplierSignalCount = db.prepare('SELECT COUNT(*) AS count FROM cache_relationships').get().count;
    const supplierSignalProvenanceGaps = db.prepare(`
      SELECT COUNT(*) AS count FROM cache_relationships
      WHERE confidence NOT IN ('confirmed','public_lead')
         OR trim(COALESCE(supplier_name, '')) = ''
         OR trim(COALESCE(source_url, '')) = ''
         OR source_url NOT LIKE 'https://%'
         OR trim(COALESCE(source_type, '')) = ''
         OR julianday(observed_at) IS NULL
         OR trim(COALESCE(excerpt, '')) = ''
    `).get().count;
    return {
      candidateIntegrity, candidateMode, candidateCount,
      recommendationEligibleCount: candidateCount,
      recommendationMissingOfficialEvidence, recommendationMissingDiscovery,
      recommendationMissingContact, recommendationStaleReview,
      recommendationOutsideNearby, supplierSignalCount, supplierSignalProvenanceGaps,
      duplicateDomains, excludedCountries, missingEvidence, missingDiscovery
    };
  } finally {
    db.close();
  }
}

function recommendFromView(view) {
  return view.recommend({ limit: Number.MAX_SAFE_INTEGER, excludeIds: [] });
}

function recommendations(dbPath) {
  const view = createCacheIndexView({ dbPath });
  try { return recommendFromView(view); }
  finally { view.close(); }
}

function runtimeSurfaceFiles(roots = RUNTIME_SURFACE_ROOTS) {
  const files = [];
  const visit = target => {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) throw new Error(`runtime surface must not contain symlinks: ${target}`);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(target).sort()) visit(path.join(target, entry));
    } else if (stat.isFile()) files.push(target);
  };
  for (const root of roots) visit(path.resolve(root));
  return files;
}

function runtimeManifest() {
  return { ...RUNTIME_MANIFEST };
}

function validateRuntimeManifest({ files = runtimeSurfaceFiles(), root = ROOT, manifest = RUNTIME_MANIFEST } = {}) {
  const actual = files.map(file => path.relative(root, path.resolve(file)).split(path.sep).join('/')).sort();
  const expected = Object.keys(manifest).sort();
  const missing = expected.filter(file => !actual.includes(file));
  const unexpected = actual.filter(file => !expected.includes(file));
  if (missing.length || unexpected.length) {
    throw new Error(`runtime manifest set mismatch: missing=${missing.join(',') || '-'} unexpected=${unexpected.join(',') || '-'}`);
  }
  for (const relative of expected) {
    const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex');
    if (digest !== manifest[relative]) throw new Error(`runtime manifest hash mismatch: ${relative}`);
  }
  return true;
}

const CAPABILITY_PATTERNS = [
  /\bfetch\b/,
  /\baxios\b/,
  /\bundici\b/,
  /(?:from\s+|require\s*\(|import\s*\()\s*['"](?:node:)?(?:http|https|http2)['"]/,
  /(?:from\s+|require\s*\(|import\s*\()\s*['"](?:node:)?(?:net|tls|dgram)['"]/,
  /\b(?:WebSocket|EventSource)\b/,
  /(?:node:)?child_process/,
  /\b(?:curl|wget|ncat|socat)\b/,
  /\b(?:nodemailer|imapflow|SMTP_[A-Z0-9_]*|IMAP_[A-Z0-9_]*|WHATSAPP[A-Z0-9_]*)\b/,
  /\bsendMail\s*\(/
];
const APPROVED_CAPABILITY_SHA256 = {
  client: '54dbcf4f48533dbb8cd22431655fe10aefd8d76c1bb34ca07c45dca37c14858f',
  supervisor: '02c49cdd5705ea4f6362eb2ff36e8eef29e8532dad1944616b13f745f0a88e5b',
  inbox: 'd505f1abe96093499f0ec1245c39fec9e04c32647d2961187192393825072d0f',
  operations: '2e32706a6dcff90bea2949a1d10989c6c0f2b4242ec2058e2f3979d6f1ed6fe0',
  delivery: 'b2903c4047bd9356cc37d2ec6ca88d30379e2d1c690b8c15420215de833f4640'
};

function approvedCapabilitySource(kind, sourceValue) {
  const source = String(sourceValue);
  if (crypto.createHash('sha256').update(source).digest('hex') !== APPROVED_CAPABILITY_SHA256[kind]) return false;
  const unsafeEvaluation = /\beval\s*\(|\bFunction\s*\(|\bimport\s*\(/.test(source);
  if (unsafeEvaluation) return false;
  const urls = source.match(/https?:\/\/[^'"`\s)]+/gi) || [];
  if (['client', 'supervisor'].includes(kind) && urls.length) return false;
  if (['inbox', 'operations'].includes(kind) && urls.some(url => url !== 'https://open.feishu.cn/open-apis')) return false;
  if (kind === 'client') {
    const envNames = [...source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map(match => match[1]).sort();
    return JSON.stringify(envNames) === JSON.stringify([
      'MATRIX_API_BASE_URL', 'MATRIX_BRIDGE_TOKEN', 'MATRIX_CONTEXT_OPEN_ID', 'MATRIX_OWNER_OPEN_ID'
    ]) &&
      (source.match(/\bfetch\s*\(/g) || []).length === 1 &&
      (source.match(/\bfetch\s*\(url,\s*\{/g) || []).length === 1 &&
      source.includes("if (BASE_PATH !== '/api/matrix') throw new Error('MATRIX_API_BASE_URL path must be /api/matrix');") &&
      source.includes('const url = target(pathname, query);') &&
      source.includes('if (url.origin !== BASE.origin || !url.pathname.startsWith(`${BASE_PATH}/`))') &&
      !CAPABILITY_PATTERNS.slice(1).some(pattern => pattern.test(source));
  }
  if (kind === 'supervisor') {
    const spawnCalls = source.match(/\bspawn\s*\(/g) || [];
    const namedEnv = [...source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map(match => match[1]);
    const allowedEnv = new Set(['MATRIX_API_BASE_URL', 'MATRIX_RUNTIME_STATE_PATH', 'MATRIX_API_STARTUP_ATTEMPTS', 'MATRIX_BRIDGE_TOKEN', 'MATRIX_OWNER_OPEN_ID']);
    return namedEnv.every(name => allowedEnv.has(name)) &&
      (source.match(/\bfetch\b/g) || []).length === 2 &&
      (source.match(/\bfetchImpl\s*\(url,/g) || []).length === 1 &&
      source.includes('const url = healthUrl(baseUrl);') &&
      spawnCalls.length === 4 &&
      source.includes("spawn(process.execPath, ['/workspace/scripts/matrix-watch.js']") &&
      source.includes("spawn(process.execPath, ['/workspace/scripts/stream-watch.js']") &&
      source.includes("spawn(process.execPath, ['/workspace/scripts/matrix-inbox-watch.js']") &&
      source.includes("spawn('feishu-codex-bridge', ['run', '--bot', 'stream-node']") &&
      source.includes("return new URL('/api/matrix/ready', base.origin).href;") &&
      !/\b(?:exec|execFile|execSync|execFileSync|fork)\s*\(/.test(source) &&
      !CAPABILITY_PATTERNS.slice(1, 6).some(pattern => pattern.test(source)) &&
      !CAPABILITY_PATTERNS.slice(7).some(pattern => pattern.test(source));
  }
  if (kind === 'inbox') {
    return source.includes("const BASE_URL = 'https://open.feishu.cn/open-apis';") &&
      source.includes("projectName: 'build'") &&
      source.includes('client.claimInboxJob(openId)') &&
      source.includes('client.ackInboxJob(openId') &&
      source.includes('client.failInboxJob(openId') &&
      source.includes("execFileSync('feishu-codex-bridge', ['secrets', 'get']") &&
      !/SMTP_|IMAP_|WHATSAPP|STREAM_CHAT_ID/.test(source);
  }
  if (kind === 'operations') {
    return source.includes("const BASE_URL = 'https://open.feishu.cn/open-apis';") &&
      source.includes("const ORDER_PROJECT = process.env.STREAM_ORDER_PROJECT || 'vm_debug_ci';") &&
      source.includes("execFileSync('feishu-codex-bridge', ['secrets', 'get']") &&
      !/SMTP_|IMAP_|WHATSAPP/.test(source);
  }
  if (kind === 'delivery') {
    return source.includes('capabilities.matrixSend') &&
      source.includes('version.content_hash !== input.expectedContentHash') &&
      source.includes("state = 'ambiguous'") &&
      source.includes('recipient_source_url') &&
      source.includes('await transport.sendMail({') &&
      (source.match(/await transport\.sendMail\s*\(/g) || []).length === 1 &&
      !source.includes('attachments:') &&
      !/\binput\.(?:to|subject|smtpHost|callbackUrl|retry)\b/.test(source) &&
      !/\b(?:nodemailer|SMTP_[A-Z0-9_]*)\b/.test(source) &&
      !CAPABILITY_PATTERNS.slice(0, 8).some(pattern => pattern.test(source));
  }
  return false;
}

function outboundAdapterFiles(files = runtimeSurfaceFiles()) {
  const clientPath = path.join(ROOT, '.runtime/vm_debug_ci/workspace/scripts/matrix-client.js');
  const supervisorPath = path.join(ROOT, '.runtime/vm_debug_ci/workspace/scripts/matrix-runtime.js');
  const inboxPath = path.join(ROOT, '.runtime/vm_debug_ci/workspace/scripts/matrix-inbox-watch.js');
  const operationsPath = path.join(ROOT, '.runtime/vm_debug_ci/workspace/scripts/stream-watch.js');
  const deliveryPath = path.join(ROOT, 'src/services/matrixStreamDelivery.js');
  return files.filter(file => {
    const source = fs.readFileSync(file, 'utf8');
    if (!CAPABILITY_PATTERNS.some(pattern => pattern.test(source))) return false;
    if (path.resolve(file) === clientPath) return !approvedCapabilitySource('client', source);
    if (path.resolve(file) === supervisorPath) return !approvedCapabilitySource('supervisor', source);
    if (path.resolve(file) === inboxPath) return !approvedCapabilitySource('inbox', source);
    if (path.resolve(file) === operationsPath) return !approvedCapabilitySource('operations', source);
    if (path.resolve(file) === deliveryPath) return !approvedCapabilitySource('delivery', source);
    const relative = path.relative(ROOT, file).split(path.sep).join('/');
    const reviewedHash = RUNTIME_MANIFEST[relative];
    if (reviewedHash && crypto.createHash('sha256').update(source).digest('hex') === reviewedHash) return false;
    return true;
  });
}

function validateComposeConfig({ runCompose } = {}) {
  const composePath = path.join(ROOT, '.runtime/vm_debug_ci/compose.yaml');
  const execute = runCompose || (() => spawnSync('docker', ['compose', '-f', composePath, 'config'], {
    cwd: ROOT,
    env: {
      ...process.env,
      MATRIX_API_HOST_PORT: '8080',
      MATRIX_BRIDGE_TOKEN: 'sanitized-verifier-token',
      MATRIX_OWNER_OPEN_ID: 'ou_sanitized_verifier',
      STREAM_APP_ID: 'cli_sanitized_verifier',
      STREAM_CHAT_ID: 'oc_sanitized_verifier',
      MATRIX_INBOX_ATTACHMENT_ROOT: path.join(ROOT, 'runtime-data-matrix-inbox-private')
    },
    encoding: 'utf8'
  }));
  const result = execute();
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'docker compose config failed').trim());
  const config = String(result.stdout || '');
  assert.ok(config.includes('http://host.docker.internal:8080/api/matrix'), 'Compose API default did not resolve to port 8080');
  assert.ok(config.includes('/workspace/scripts/matrix-runtime.js') && config.includes('health'), 'Compose health gate missing');
  assert.ok(config.includes('host-gateway'), 'Compose host gateway missing');
  return config;
}

function duplicateSelectionCount(root) {
  const previousPath = process.env.DB_PATH;
  process.env.DB_PATH = path.join(root, 'idempotency-app.db');
  const dbModulePath = require.resolve('../src/db');
  delete require.cache[dbModulePath];
  const { db, initDb } = require('../src/db');
  const { createPacketGate } = require('../src/lib/packetGate');
  try {
    const originalLog = console.log;
    try {
      console.log = () => undefined;
      initDb();
    } finally {
      console.log = originalLog;
    }
    const at = '2026-07-17T00:00:00.000Z';
    const insertUser = db.prepare("INSERT INTO users (id, username, password, role, status, created_at) VALUES (?, ?, 'test-only', 'manager', 'active', ?)");
    insertUser.run(7001, 'matrix-verifier-actor', at);
    insertUser.run(7002, 'matrix-verifier-admin', at);
    const gate = createPacketGate({ db, now: () => at, candidateValidator: () => true });
    gate.bindActor({ feishuOpenId: 'ou-matrix-verifier', userId: 7001, boundByUserId: 7002 });
    const session = gate.createSession({
      actorUserId: 7001, feishuOpenId: 'ou-matrix-verifier', chatId: 'verification-chat',
      filters: {}, snapshotKey: 'a'.repeat(64), candidateIds: [1], expiresAt: '2026-07-18T00:00:00.000Z'
    });
    const input = {
      candidateId: 1, actorUserId: 7001, sessionId: session.id, expectedVersion: 1,
      idempotencyKey: 'matrix-verifier-event', nextAction: '核实公开证据'
    };
    gate.selectCandidate(input);
    gate.selectCandidate(input);
    return db.prepare("SELECT COUNT(*) AS count FROM matrix_selection_events WHERE idempotency_key = 'matrix-verifier-event'").get().count;
  } finally {
    db.close();
    delete require.cache[dbModulePath];
    if (previousPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = previousPath;
  }
}

function runFocusedTests() {
  for (const file of FOCUSED_TESTS) {
    const result = spawnSync(process.execPath, [file], {
      cwd: ROOT, env: { ...process.env, MATRIX_DELIVERY_ENABLED: '0' }, encoding: 'utf8'
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const detail = `${result.stdout || ''}\n${result.stderr || ''}`
        .replace(/password=\S+/gi, 'password=[redacted]')
        .trim();
      throw new Error(`${file} failed${detail ? `: ${detail}` : ''}`);
    }
    process.stdout.write(`${file}: passed\n`);
  }
}

function main() {
  repositoryContract();
  validateComposeConfig();
  validateRuntimeManifest();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-readonly-verifier-'));
  try {
    const input = candidateInput({ root: ROOT, temporary: root, env: process.env });
    const dbPath = input.dbPath;
    const metrics = inspectCandidates(dbPath);
    const selected = recommendations(dbPath);
    const adapters = outboundAdapterFiles();
    const idempotentEvents = duplicateSelectionCount(root);
    const delivery = process.env.MATRIX_DELIVERY_ENABLED || '0';

    assert.strictEqual(metrics.candidateIntegrity, 'ok');
    assert.strictEqual(metrics.candidateMode, '600');
    assert.strictEqual(metrics.duplicateDomains, 0);
    assert.strictEqual(metrics.excludedCountries, 0);
    assert.strictEqual(metrics.recommendationMissingOfficialEvidence, 0);
    assert.strictEqual(metrics.recommendationMissingDiscovery, 0);
    assert.strictEqual(metrics.recommendationMissingContact, 0);
    assert.strictEqual(metrics.recommendationStaleReview, 0);
    assert.strictEqual(metrics.recommendationOutsideNearby, 0);
    assert.strictEqual(metrics.supplierSignalProvenanceGaps, 0);
    assert.ok(selected.length <= 5);
    assert.ok(selected.every(row => NEARBY_COUNTRY_CODES.has(row.country_code)));
    assert.strictEqual(delivery, '0');
    assert.strictEqual(adapters.length, 0);
    assert.strictEqual(idempotentEvents, 1);

    runFocusedTests();
    process.stdout.write(`${JSON.stringify({
      candidate_count: metrics.candidateCount,
      recommendation_eligible_count: metrics.recommendationEligibleCount,
      candidate_integrity: metrics.candidateIntegrity,
      candidate_mode: metrics.candidateMode,
      duplicate_domains: metrics.duplicateDomains,
      excluded_countries: metrics.excludedCountries,
      ordinary_missing_official_evidence: metrics.missingEvidence,
      ordinary_missing_discovery: metrics.missingDiscovery,
      recommendation_missing_official_evidence: metrics.recommendationMissingOfficialEvidence,
      recommendation_missing_discovery: metrics.recommendationMissingDiscovery,
      recommendation_missing_contact: metrics.recommendationMissingContact,
      recommendation_stale_review: metrics.recommendationStaleReview,
      recommendation_outside_nearby: metrics.recommendationOutsideNearby,
      supplier_signal_count: metrics.supplierSignalCount,
      supplier_signal_provenance_gaps: metrics.supplierSignalProvenanceGaps,
      recommendations: selected.length,
      idempotent_selection_events: idempotentEvents,
      delivery_enabled: false,
      source: input.source
    }, null, 2)}\n`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`matrix read-only verification failed: ${error?.message || 'unknown error'}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  recommendations, recommendFromView, candidateInput, inspectCandidates,
  runtimeSurfaceFiles, runtimeManifest, validateRuntimeManifest,
  outboundAdapterFiles, validateComposeConfig, approvedCapabilitySource
};

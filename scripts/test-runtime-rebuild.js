const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');

const repoRoot = path.resolve(__dirname, '..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-rebuild-test-'));
const projectRoot = path.join(tmpRoot, 'project');
const dbPath = path.join(projectRoot, 'data', 'app.db');
const auditOut = path.join(tmpRoot, 'audit');
const bundleOut = path.join(tmpRoot, 'bundles');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function run(script, args, expectedStatus = 0) {
  const ret = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', script), ...args], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  assert.strictEqual(ret.status, expectedStatus, `${script} 状态异常\nstdout=${ret.stdout}\nstderr=${ret.stderr}`);
  return ret;
}

function setup() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'public', 'uploads', 'orders'), { recursive: true });
  for (const [name, value] of Object.entries({
    'product_prefill_map.json': '{}',
    'customer_bag_map.json': '{}',
    'material_options.json': '[]',
    'system_package_config.json': '{}'
  })) fs.writeFileSync(path.join(projectRoot, 'data', name), value);

  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY, username TEXT, updated_at TEXT);
    CREATE TABLE orders(id INTEGER PRIMARY KEY, customer_name TEXT, updated_at TEXT);
    CREATE TABLE work_orders(id INTEGER PRIMARY KEY, work_no TEXT, updated_at TEXT);
    CREATE TABLE cost_snapshots(id INTEGER PRIMARY KEY, name TEXT, updated_at TEXT);
    CREATE TABLE crm_message_attachments(id INTEGER PRIMARY KEY, storage_path TEXT);
    INSERT INTO users VALUES(1, 'tester', '2026-01-01');
    INSERT INTO orders VALUES(1, '示例', '2026-01-02');
    INSERT INTO work_orders VALUES(1, 'WO-1', '2026-01-03');
    INSERT INTO cost_snapshots VALUES(1, 'C-1', '2026-01-04');
    INSERT INTO crm_message_attachments VALUES(1, 'public/uploads/orders/missing.jpg');
  `);
  db.close();
  fs.writeFileSync(path.join(projectRoot, 'public', 'uploads', 'orders', 'a.bin'), 'same');
  fs.writeFileSync(path.join(projectRoot, 'public', 'uploads', 'orders', 'b.bin'), 'same');
}

function main() {
  setup();
  const before = { hash: sha256(dbPath), stat: fs.statSync(dbPath) };
  run('runtime-audit.js', ['--db', dbPath, '--root', projectRoot, '--out', auditOut]);
  const after = { hash: sha256(dbPath), stat: fs.statSync(dbPath) };
  assert.strictEqual(after.hash, before.hash, '审计不得修改数据库内容');
  assert.strictEqual(after.stat.mtimeMs, before.stat.mtimeMs, '审计不得修改数据库时间');
  const audit = JSON.parse(fs.readFileSync(path.join(auditOut, 'runtime-audit.json')));
  assert.strictEqual(audit.database.integrity, 'ok');
  assert.strictEqual(audit.database.tables.orders.count, 1);
  assert(audit.files.duplicateGroups.some(group => group.files.length === 2), '应报告重复文件');
  assert(audit.files.missingReferences.includes('public/uploads/orders/missing.jpg'), '应报告缺失附件');
  assert(fs.readFileSync(path.join(auditOut, 'runtime-audit.md'), 'utf8').includes('本次仅审计，未删除任何数据'));

  run('runtime-backup.js', ['--db', dbPath, '--root', projectRoot, '--out', bundleOut]);
  const bundles = fs.readdirSync(bundleOut).filter(name => name.startsWith('runtime-data-'));
  assert.strictEqual(bundles.length, 1);
  const bundle = path.join(bundleOut, bundles[0]);
  run('runtime-verify.js', ['--bundle', bundle]);
  const snapshot = new Database(path.join(bundle, 'database', 'app.db'), { readonly: true });
  assert.strictEqual(snapshot.prepare('SELECT count(*) n FROM orders').get().n, 1);
  snapshot.close();

  fs.appendFileSync(path.join(bundle, 'database', 'app.db'), 'tamper');
  run('runtime-verify.js', ['--bundle', bundle], 1);
  console.log('RUNTIME REBUILD TEST PASS');
}

try { main(); } finally { fs.rmSync(tmpRoot, { recursive: true, force: true }); }

#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function args(argv) { const o = {}; for (let i = 0; i < argv.length; i += 2) o[argv[i].replace(/^--/, '')] = argv[i + 1]; return o; }
function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) return [];
    return e.isDirectory() ? walk(p) : [p];
  });
}
function safeRel(root, value) {
  const absolute = path.resolve(root, value || '');
  return absolute === root || absolute.startsWith(`${root}${path.sep}`) ? path.relative(root, absolute).split(path.sep).join('/') : null;
}
function maxUpdated(db, table) {
  const columns = db.prepare(`PRAGMA table_info("${table}")`).all().map(x => x.name);
  if (!columns.includes('updated_at')) return null;
  return db.prepare(`SELECT max(updated_at) value FROM "${table}"`).get().value || null;
}
function main() {
  const opt = args(process.argv.slice(2));
  if (!opt.db || !opt.root || !opt.out) throw new Error('用法：--db <路径> --root <项目目录> --out <输出目录>');
  const root = path.resolve(opt.root); const dbPath = path.resolve(opt.db); const out = path.resolve(opt.out);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  let report;
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    const tableStats = {};
    for (const { name } of tables) tableStats[name] = { count: db.prepare(`SELECT count(*) count FROM "${name}"`).get().count, maxUpdatedAt: maxUpdated(db, name) };
    const refs = tableStats.crm_message_attachments
      ? db.prepare("SELECT storage_path FROM crm_message_attachments WHERE storage_path IS NOT NULL AND trim(storage_path) <> ''").all().map(x => safeRel(root, x.storage_path)).filter(Boolean)
      : [];
    const roots = [path.join(root, 'public', 'uploads'), path.join(root, 'data', 'uploads')];
    const files = roots.flatMap(walk);
    const groups = new Map();
    for (const file of files) { const key = `${fs.statSync(file).size}:${hash(file)}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(path.relative(root, file).split(path.sep).join('/')); }
    report = {
      formatVersion: 1, generatedAt: new Date().toISOString(), readOnly: true,
      database: { path: dbPath, size: fs.statSync(dbPath).size, integrity: db.pragma('integrity_check', { simple: true }), foreignKeyIssues: db.pragma('foreign_key_check').length, tables: tableStats },
      files: { scanned: files.length, duplicateGroups: [...groups.entries()].filter(([, f]) => f.length > 1).map(([signature, f]) => ({ signature, files: f })), missingReferences: refs.filter(r => !fs.existsSync(path.join(root, r))) }
    };
  } finally { db.close(); }
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(out, 'runtime-audit.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  const md = `# 运行数据只读审计报告\n\n> 本次仅审计，未删除任何数据。\n\n- 数据库完整性：${report.database.integrity}\n- 数据表数量：${Object.keys(report.database.tables).length}\n- 扫描文件：${report.files.scanned}\n- 重复文件组：${report.files.duplicateGroups.length}\n- 缺失附件引用：${report.files.missingReferences.length}\n`;
  fs.writeFileSync(path.join(out, 'runtime-audit.md'), md, { mode: 0o600 });
  console.log(`审计完成：${out}`);
}
try { main(); } catch (error) { console.error(`审计失败：${error.message}`); process.exit(1); }

#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
function args(argv) { const o = {}; for (let i = 0; i < argv.length; i += 2) o[argv[i].replace(/^--/, '')] = argv[i + 1]; return o; }
function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function main() {
  const bundle = path.resolve(args(process.argv.slice(2)).bundle || ''); if (!bundle || !fs.statSync(bundle).isDirectory()) throw new Error('用法：--bundle <数据包目录>');
  for (const rel of ['manifest.json', 'checksums.sha256', 'database/app.db']) if (!fs.existsSync(path.join(bundle, rel))) throw new Error(`缺少文件：${rel}`);
  const lines = fs.readFileSync(path.join(bundle, 'checksums.sha256'), 'utf8').trim().split('\n').filter(Boolean);
  for (const line of lines) { const match = line.match(/^([a-f0-9]{64})  (.+)$/); if (!match) throw new Error('校验和文件格式错误'); const file = path.resolve(bundle, match[2]); if (!file.startsWith(`${bundle}${path.sep}`) || !fs.existsSync(file)) throw new Error(`校验文件缺失：${match[2]}`); if (hash(file) !== match[1]) throw new Error(`校验和不一致：${match[2]}`); }
  const manifest = JSON.parse(fs.readFileSync(path.join(bundle, 'manifest.json')));
  if (manifest.goldenBaseline) {
    const baselinePath = path.join(bundle, manifest.goldenBaseline.path);
    if (!fs.existsSync(baselinePath) || hash(baselinePath) !== manifest.goldenBaseline.sha256) throw new Error('私密黄金基线缺失或哈希不一致');
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    if (baseline.status !== 'technical_baseline_confirmed' || !Array.isArray(baseline.cases) || baseline.cases.length !== manifest.goldenBaseline.cases) throw new Error('私密黄金基线内容无效');
  }
  const db = new Database(path.join(bundle, 'database', 'app.db'), { readonly: true, fileMustExist: true });
  let result;
  try { const integrity = db.pragma('integrity_check', { simple: true }); if (integrity !== 'ok') throw new Error(`数据库完整性失败：${integrity}`); for (const [table, count] of Object.entries(manifest.database.tables)) { const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table); if (!row) throw new Error(`缺少数据表：${table}`); if (db.prepare(`SELECT count(*) count FROM "${table}"`).get().count !== count) throw new Error(`记录数不一致：${table}`); } result = { status: 'healthy', verifiedAt: new Date().toISOString(), integrity, foreignKeyIssues: db.pragma('foreign_key_check').length }; } finally { db.close(); }
  fs.writeFileSync(path.join(bundle, 'verification.json'), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 }); console.log('数据包验证通过');
}
try { main(); } catch (e) { console.error(`验证失败：${e.message}`); process.exit(1); }

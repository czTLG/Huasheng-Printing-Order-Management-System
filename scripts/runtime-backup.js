#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const Database = require('better-sqlite3');
process.umask(0o077);

function args(argv) { const o = {}; for (let i = 0; i < argv.length; i += 2) o[argv[i].replace(/^--/, '')] = argv[i + 1]; return o; }
function walk(dir) { return fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => { const p = path.join(dir, e.name); return e.isSymbolicLink() ? [] : e.isDirectory() ? walk(p) : [p]; }) : []; }
function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function copyFile(root, stage, rel) { const src = path.resolve(root, rel); if (!src.startsWith(`${root}${path.sep}`) || !fs.existsSync(src) || !fs.statSync(src).isFile()) return false; const dst = path.join(stage, 'files', rel); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); return true; }
async function main() {
  const opt = args(process.argv.slice(2)); if (!opt.db || !opt.root || !opt.out) throw new Error('用法：--db <路径> --root <项目目录> --out <输出目录>');
  const root = path.resolve(opt.root), dbPath = path.resolve(opt.db), out = path.resolve(opt.out);
  if (out === root || out.startsWith(`${root}${path.sep}`)) throw new Error('备份输出目录不得位于源项目内部');
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const stage = fs.mkdtempSync(path.join(out, '.runtime-stage-'));
  try {
    fs.mkdirSync(path.join(stage, 'database'), { recursive: true });
    const source = new Database(dbPath, { readonly: true, fileMustExist: true });
    try { await source.backup(path.join(stage, 'database', 'app.db')); } finally { source.close(); }
    const configNames = ['product_prefill_map.json', 'customer_bag_map.json', 'material_options.json', 'system_package_config.json'];
    for (const name of configNames) { const src = path.join(root, 'data', name); if (!fs.existsSync(src)) throw new Error(`缺少必要配置：data/${name}`); const dst = path.join(stage, 'config', 'data', name); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }
    for (const file of [...walk(path.join(root, 'public', 'uploads')), ...walk(path.join(root, 'data', 'uploads'))]) copyFile(root, stage, path.relative(root, file));
    let goldenBaseline = null;
    if (opt.baseline) {
      const baselineSource = path.resolve(opt.baseline);
      if (!fs.existsSync(baselineSource) || !fs.statSync(baselineSource).isFile()) throw new Error('私密黄金基线不存在');
      const parsed = JSON.parse(fs.readFileSync(baselineSource, 'utf8'));
      if (parsed.format_version !== 1 || parsed.status !== 'technical_baseline_confirmed' || !Array.isArray(parsed.cases)) throw new Error('私密黄金基线格式或状态不合法');
      const target = path.join(stage, 'private', 'golden-baseline.json');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(baselineSource, target);
      goldenBaseline = { path: 'private/golden-baseline.json', sha256: hash(target), cases: parsed.cases.length, engineSha256: parsed.engine_sha256 || null };
    }
    const snap = new Database(path.join(stage, 'database', 'app.db'), { readonly: true }); const tables = {};
    try { for (const { name } of snap.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) tables[name] = snap.prepare(`SELECT count(*) count FROM "${name}"`).get().count; } finally { snap.close(); }
    let gitCommit = null; try { gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch {}
    const manifest = { formatVersion: 1, createdAt: new Date().toISOString(), gitCommit, database: { sourcePath: dbPath, tables }, goldenBaseline, missingFiles: [] };
    fs.writeFileSync(path.join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const listed = walk(stage).filter(f => !f.endsWith('checksums.sha256') && !f.endsWith('verification.json')).map(f => `${hash(f)}  ${path.relative(stage, f).split(path.sep).join('/')}`).sort();
    fs.writeFileSync(path.join(stage, 'checksums.sha256'), `${listed.join('\n')}\n`);
    fs.writeFileSync(path.join(stage, 'verification.json'), `${JSON.stringify({ status: 'pending' }, null, 2)}\n`);
    for (const file of walk(stage)) fs.chmodSync(file, 0o600);
    const secureDirs = dir => fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => { if (entry.isDirectory()) { const child = path.join(dir, entry.name); fs.chmodSync(child, 0o700); secureDirs(child); } });
    secureDirs(stage);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/T/, '_').slice(0, 15); let final = path.join(out, `runtime-data-${stamp}`); let n = 1; while (fs.existsSync(final)) final = path.join(out, `runtime-data-${stamp}-${n++}`);
    fs.renameSync(stage, final); console.log(`备份完成：${final}`);
  } catch (e) { fs.rmSync(stage, { recursive: true, force: true }); throw e; }
}
main().catch(e => { console.error(`备份失败：${e.message}`); process.exit(1); });

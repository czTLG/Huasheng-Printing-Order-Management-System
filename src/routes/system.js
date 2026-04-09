const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const nodemailer = require('nodemailer');
const { db, now, audit } = require('../db');
const { allowRoles } = require('../middleware/auth');

const router = express.Router();

router.post('/knowledge/incremental-update', allowRoles('super_admin'), (req, res) => {
  const { sourceType, sourceId, changeType, detail = '' } = req.body || {};
  if (!sourceType || !sourceId || !changeType) {
    return res.status(400).json({ error: 'sourceType/sourceId/changeType 必填' });
  }

  const stmt = db.prepare(`
    INSERT INTO knowledge_updates (source_type, source_id, change_type, detail, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(sourceType, String(sourceId), changeType, detail, now());

  audit({
    role: req.user.role,
    userName: req.user.userName,
    action: 'incremental_update',
    resourceType: 'knowledge',
    resourceId: result.lastInsertRowid,
    detail: `${sourceType}:${sourceId}:${changeType}`
  });

  res.json({ ok: true, updateId: result.lastInsertRowid, message: '已记录增量更新任务（演示版）' });
});

router.get('/audit-logs', allowRoles('super_admin'), (req, res) => {
  const rows = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200').all();
  res.json(rows);
});

router.get('/slow-apis', allowRoles('super_admin'), (req, res) => {
  const map = req.app?.locals?.apiSlowStats;
  if (!map || !(map instanceof Map)) return res.json({ rows: [] });
  const rows = [...map.entries()].map(([api, v]) => ({
    api,
    count: Number(v?.count || 0),
    avgMs: Math.round(Number(v?.total || 0) / Math.max(1, Number(v?.count || 0))),
    maxMs: Number(v?.max || 0)
  })).sort((a, b) => (b.avgMs - a.avgMs) || (b.maxMs - a.maxMs) || (b.count - a.count)).slice(0, 80);
  res.json({ rows });
});

router.post('/slow-apis/reset', allowRoles('super_admin'), (req, res) => {
  const map = req.app?.locals?.apiSlowStats;
  if (map && map instanceof Map) map.clear();
  res.json({ ok: true });
});

function buildSystemPackage(kind = 'data') {
  const root = path.join(__dirname, '..', '..');
  const outDir = path.join(root, 'archives');
  fs.mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const safeKind = ['data', 'system', 'all'].includes(kind) ? kind : 'data';
  const outName = `packaging_${safeKind}_${ts}.tar.gz`;
  const outPath = path.join(outDir, outName);

  const manifest = {
    generatedAt: now(),
    kind: safeKind,
    stats: {
      users: db.prepare('SELECT count(*) c FROM users').get().c,
      orders: db.prepare('SELECT count(*) c FROM orders').get().c,
      workOrders: db.prepare('SELECT count(*) c FROM work_orders').get().c,
      stageLogs: db.prepare('SELECT count(*) c FROM order_stage_logs').get().c
    }
  };
  const mfPath = path.join(outDir, `manifest_${safeKind}_${ts}.json`);
  fs.writeFileSync(mfPath, JSON.stringify(manifest, null, 2), 'utf8');

  const args = ['-czf', outPath];
  if (safeKind === 'data') args.push('data/app.db', path.relative(root, mfPath));
  else if (safeKind === 'system') args.push('src', 'public', 'scripts', 'package.json', 'package-lock.json', path.relative(root, mfPath));
  else args.push('src', 'public', 'scripts', 'data/app.db', 'package.json', 'package-lock.json', path.relative(root, mfPath));

  execFileSync('tar', args, { cwd: root, stdio: 'pipe' });
  const size = fs.statSync(outPath).size;
  return { outPath, outName, size, manifest };
}

async function sendPackageMail(to = '', pkg = null) {
  const host = process.env.SMTP_HOST || '';
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = String(process.env.SMTP_SECURE || 'true').toLowerCase() !== 'false';
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';
  const from = process.env.SMTP_FROM || user || '';
  if (!host || !user || !pass || !from) throw new Error('未配置SMTP');
  const transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
  await transporter.sendMail({
    from,
    to,
    subject: `系统打包文件 ${pkg?.outName || ''}`,
    text: `系统打包已生成\n文件: ${pkg?.outName || ''}\n大小: ${Math.round((pkg?.size || 0)/1024)} KB`,
    attachments: [{ filename: pkg?.outName || 'package.tar.gz', path: pkg?.outPath }]
  });
}

const PKG_CFG_PATH = path.join(__dirname, '..', '..', 'data', 'system_package_config.json');
function readPkgCfg(){
  try { return JSON.parse(fs.readFileSync(PKG_CFG_PATH,'utf8')); } catch(_) { return { enabled:false, email:'', kind:'data', weekday:0, hour:21, minute:0 }; }
}
function writePkgCfg(cfg={}){
  fs.mkdirSync(path.dirname(PKG_CFG_PATH), { recursive: true });
  fs.writeFileSync(PKG_CFG_PATH, JSON.stringify(cfg,null,2), 'utf8');
}

router.get('/package/config', allowRoles('super_admin','manager'), (req,res)=>{
  res.json(readPkgCfg());
});

router.post('/package/config', allowRoles('super_admin','manager'), (req,res)=>{
  const c=readPkgCfg();
  const next={
    enabled: !!req.body?.enabled,
    email: String(req.body?.email||c.email||'').trim(),
    kind: ['data','system','all'].includes(String(req.body?.kind||'')) ? String(req.body.kind) : (c.kind||'data'),
    weekday: Math.max(0, Math.min(6, Number(req.body?.weekday ?? c.weekday ?? 0))),
    hour: Math.max(0, Math.min(23, Number(req.body?.hour ?? c.hour ?? 21))),
    minute: Math.max(0, Math.min(59, Number(req.body?.minute ?? c.minute ?? 0)))
  };
  writePkgCfg(next);
  audit({ role:req.user.role, userName:req.user.userName, action:'save_package_config', resourceType:'system', resourceId:'package_config', detail: JSON.stringify(next) });
  res.json({ ok:true, config: next });
});

router.post('/package/build', allowRoles('super_admin','manager'), (req, res) => {
  try {
    const kind = String(req.body?.kind || 'data');
    const pkg = buildSystemPackage(kind);
    audit({ role: req.user.role, userName: req.user.userName, action: 'build_system_package', resourceType: 'system', resourceId: pkg.outName, detail: kind });
    res.json({ ok: true, file: pkg.outName, size: pkg.size, manifest: pkg.manifest });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || '打包失败') });
  }
});

router.post('/package/send', allowRoles('super_admin','manager'), async (req, res) => {
  try {
    const to = String(req.body?.to || '').trim();
    const kind = String(req.body?.kind || 'data');
    if (!to) return res.status(400).json({ error: '请填写邮箱' });
    const pkg = buildSystemPackage(kind);
    await sendPackageMail(to, pkg);
    audit({ role: req.user.role, userName: req.user.userName, action: 'send_system_package', resourceType: 'system', resourceId: pkg.outName, detail: `to=${to};kind=${kind}` });
    res.json({ ok: true, file: pkg.outName, size: pkg.size });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || '发送失败') });
  }
});

module.exports = router;
module.exports.buildSystemPackage = buildSystemPackage;
module.exports.sendPackageMail = sendPackageMail;
module.exports.readPkgCfg = readPkgCfg;

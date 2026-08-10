const express = require('express');
const fs = require('fs');
const path = require('path');
const { allowRoles } = require('../middleware/auth');
const { openStreamDeskStore, inspectOwnedPage } = require('../services/streamDeskStore');
const { createWechatDraftAdapter } = require('../services/wechatDraftAdapter');
const { createStreamMedia } = require('../services/streamMedia');

function createStreamDeskRouter({ audit, store = openStreamDeskStore(), wechat = createWechatDraftAdapter(), media = createStreamMedia() } = {}) {
  const router = express.Router();
  const roles = allowRoles('super_admin', 'stream_publisher');

  router.use(roles);
  router.use((_, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    next();
  });
  router.get('/summary', (_, res) => res.json({ ...store.summary(), wechat: wechat.readiness() }));
  router.get('/strategy', (_, res) => {
    const file = path.join(__dirname, '..', '..', 'config', 'stream-content-strategy.json');
    res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
  });
  router.get('/tasks', (req, res) => res.json({ tasks: store.listTasks({ status: String(req.query.status || 'ready'), limit: req.query.limit }) }));
  router.get('/calendar', (req, res) => res.json({ tasks: store.calendar({ from: req.query.from, to: req.query.to }) }));
  router.get('/analytics', (_, res) => res.json(store.analytics()));
  router.post('/inspect', allowRoles('super_admin'), async (req, res) => {
    try {
      res.json(await inspectOwnedPage(req.body?.sourceUrl));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  router.post('/sources', allowRoles('super_admin'), (req, res) => {
    try {
      const result = store.importSource(req.body || {}, req.user.userName);
      audit?.({ role: req.user.role, userName: req.user.userName, action: 'stream_source_import', resourceType: 'stream_source', resourceId: result.sourceId, detail: `tasks=${result.created}` });
      res.status(201).json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  router.post('/tasks/:id/action', (req, res) => {
    try {
      const result = store.recordAction(Number(req.params.id), String(req.body?.action || ''), req.user.userName, String(req.body?.detail || ''));
      audit?.({ role: req.user.role, userName: req.user.userName, action: `stream_task_${req.body?.action}`, resourceType: 'stream_task', resourceId: req.params.id, detail: String(req.body?.detail || '').slice(0, 500) });
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  router.post('/tasks/:id/metrics', (req, res) => {
    try {
      const result = store.recordMetrics(Number(req.params.id), req.body || {}, req.user.userName);
      audit?.({ role: req.user.role, userName: req.user.userName, action: 'stream_metrics_recorded', resourceType: 'stream_task', resourceId: req.params.id, detail: 'manual performance snapshot' });
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  router.post('/tasks/:id/media', async (req, res) => {
    try {
      const task = store.db.prepare('SELECT * FROM stream_tasks WHERE id=?').get(Number(req.params.id));
      if (!task) return res.status(404).json({ error: '任务不存在' });
      const result = await media.prepare(task);
      audit?.({ role: req.user.role, userName: req.user.userName, action: 'stream_media_prepared', resourceType: 'stream_task', resourceId: task.id, detail: `${result.width}x${result.height}` });
      res.json({ ok: true, width: result.width, height: result.height, downloadUrl: `/api/stream-desk/tasks/${task.id}/media` });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  router.get('/tasks/:id/media', (req, res) => {
    const task = store.db.prepare('SELECT * FROM stream_tasks WHERE id=?').get(Number(req.params.id));
    const file = task && media.locate(task);
    if (!file) return res.status(404).json({ error: '尚未生成平台配图' });
    res.download(file, `huasheng-${task.platform}-${task.id}.jpg`);
  });
  router.post('/tasks/:id/wechat-draft', async (req, res) => {
    try {
      const task = store.db.prepare("SELECT * FROM stream_tasks WHERE id=? AND platform='wechat'").get(Number(req.params.id));
      if (!task) return res.status(404).json({ error: '微信公众号任务不存在' });
      const result = await wechat.addDraft(task);
      store.recordAction(task.id, 'draft_saved', req.user.userName, `media_id=${result.mediaId}`);
      audit?.({ role: req.user.role, userName: req.user.userName, action: 'stream_wechat_draft', resourceType: 'stream_task', resourceId: task.id, detail: 'draft saved' });
      res.json({ ok: true, status: 'draft_saved' });
    } catch (error) {
      res.status(error.code === 'WECHAT_NOT_CONFIGURED' ? 503 : 502).json({ error: error.message });
    }
  });
  return router;
}

module.exports = { createStreamDeskRouter };

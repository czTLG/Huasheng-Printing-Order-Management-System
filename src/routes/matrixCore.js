'use strict';

const express = require('express');
const { normalizePermissions } = require('../lib/permissions');

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}
function allow(value, fields, label) {
  const input = object(value, label);
  const unknown = Object.keys(input).find(key => !fields.has(key));
  if (unknown) throw new Error(`unknown ${label} field: ${unknown}`);
  return input;
}
function id(value, label) { const result = Number(value); if (!Number.isInteger(result) || result <= 0) throw new Error(`${label} invalid`); return result; }
function fail(res, error) {
  const message = String(error?.message || 'invalid request');
  const status = /not found/.test(message) ? 404 : /stale|idempotency conflict/.test(message) ? 409 : /capability|binding mismatch|channel chat mismatch/.test(message) ? 403 : 400;
  return res.status(status).json({ error: { code: status === 409 ? 'conflict' : status === 403 ? 'forbidden' : 'invalid_request', message } });
}

function createMatrixCoreRouter({ db, items, tasks, schedule, channelPolicy } = {}) {
  if (!db || !items || !tasks || !schedule || !channelPolicy) throw new Error('matrix core dependencies required');
  const router = express.Router();

  function actorContext(req) {
    if (!req.user?.id) throw new Error('active actor binding required');
    const chatId = String(req.get('x-feishu-chat-id') || '').trim();
    const channel = channelPolicy.classifyChat(chatId);
    const binding = req.matrixBinding || db.prepare("SELECT id,feishu_open_id AS feishuOpenId FROM matrix_actor_bindings WHERE user_id=? AND status='active' ORDER BY id LIMIT 1").get(req.user.id);
    if (!binding) throw new Error('active actor binding required');
    return { actorUserId: req.user.id, bindingId: String(binding.id), chatId, channel };
  }
  function requireDecide(req) {
    const permissions = normalizePermissions(req.user.role, req.user.permissions);
    if (!permissions.capabilities?.matrixDecide) throw new Error('matrixDecide capability required');
  }

  router.get('/inquiries/:id/items', (req, res) => {
    try {
      allow(req.query, new Set(), 'query');
      const aggregate = items.aggregateInquiry(id(req.params.id, 'inquiry id'));
      res.json({ items: aggregate.items, aggregate });
    } catch (error) { fail(res, error); }
  });
  router.post('/inquiries/:id/items', (req, res) => {
    try {
      const body = allow(req.body, new Set(['itemKey', 'title', 'required', 'idempotencyKey']), 'body');
      const context = actorContext(req);
      const item = items.createItem({ inquiryId: id(req.params.id, 'inquiry id'), ...body, actorUserId: context.actorUserId });
      res.status(201).json({ kind: 'created', item, aggregate: items.aggregateInquiry(item.inquiryId) });
    } catch (error) { fail(res, error); }
  });
  router.post('/items/:id/specifications/:specificationId/bind', (req, res) => {
    try {
      const body = allow(req.body, new Set(['expectedItemVersion', 'idempotencyKey']), 'body');
      const context = actorContext(req);
      const item = items.bindSpecification({ itemId: id(req.params.id, 'item id'), specificationId: id(req.params.specificationId, 'specification id'), ...body, actorUserId: context.actorUserId });
      res.json({ item, aggregate: items.aggregateInquiry(item.inquiryId) });
    } catch (error) { fail(res, error); }
  });
  router.post('/items/:id/source-versions', (req, res) => {
    try {
      const body = allow(req.body, new Set(['sourceType', 'sourceId', 'sourceVersion', 'sourceContentHash', 'idempotencyKey']), 'body');
      const context = actorContext(req);
      const sourceVersionEvent = items.recordSourceVersion({ ...body, actorUserId: context.actorUserId });
      res.status(201).json({ kind: 'created', sourceVersionEvent });
    } catch (error) { fail(res, error); }
  });
  router.post('/items/:id/sources', (req, res) => {
    try {
      const body = allow(req.body, new Set(['sourceType', 'sourceId', 'idempotencyKey']), 'body');
      const context = actorContext(req);
      const itemSourceLink = items.linkSource({ itemId: id(req.params.id, 'item id'), ...body, actorUserId: context.actorUserId });
      res.status(201).json({ kind: 'created', itemSourceLink });
    } catch (error) { fail(res, error); }
  });
  router.post('/items/:id/source-version-bindings', (req, res) => {
    try {
      const body = allow(req.body, new Set(['itemSourceLinkId', 'sourceVersionEventId', 'sourceVersion', 'sourceContentHash', 'boundItemVersion', 'specificationId', 'specificationVersion', 'idempotencyKey']), 'body');
      const context = actorContext(req);
      const itemSourceLink = db.prepare('SELECT item_id FROM matrix_item_source_links WHERE id=?').get(body.itemSourceLinkId);
      if (!itemSourceLink || itemSourceLink.item_id !== id(req.params.id, 'item id')) throw new Error('source link item mismatch');
      const sourceVersionBinding = items.bindSourceVersion({ ...body, actorUserId: context.actorUserId });
      res.status(201).json({ kind: 'created', sourceVersionBinding });
    } catch (error) { fail(res, error); }
  });
  router.get('/tasks', (req, res) => {
    try {
      const query = allow(req.query, new Set(['channel', 'state', 'due_before', 'limit', 'cursor']), 'query');
      const context = actorContext(req);
      const channel = query.channel || context.channel;
      channelPolicy.assertBoundChat(channel, context.chatId);
      res.json(tasks.listTasks({ channel, state: query.state, dueBefore: query.due_before, limit: query.limit, afterId: query.cursor }));
    } catch (error) { fail(res, error); }
  });
  router.post('/tasks/digests/prepare', (req, res) => {
    try { const body = allow(req.body, new Set(['now', 'idempotencyKey']), 'body'); actorContext(req); res.json({ digests: schedule.prepareDueDigests(body) }); }
    catch (error) { fail(res, error); }
  });
  router.post('/tasks/digests/claim', (req, res) => {
    try { const body = allow(req.body, new Set(['channel', 'ownerToken', 'leaseMs', 'now']), 'body'); const context = actorContext(req); channelPolicy.assertBoundChat(body.channel, context.chatId); res.json({ claim: schedule.claimDigest(body) }); }
    catch (error) { fail(res, error); }
  });
  router.post('/tasks/digests/:id/ack', (req, res) => {
    try { const body = allow(req.body, new Set(['claimToken', 'receiptId', 'now']), 'body'); actorContext(req); res.json(schedule.ackDigest({ outboxId: id(req.params.id, 'outbox id'), ...body })); }
    catch (error) { fail(res, error); }
  });
  router.post('/tasks/digests/:id/nack', (req, res) => {
    try { const body = allow(req.body, new Set(['claimToken', 'outcome', 'now']), 'body'); actorContext(req); res.json(schedule.nackDigest({ outboxId: id(req.params.id, 'outbox id'), ...body })); }
    catch (error) { fail(res, error); }
  });
  router.post('/tasks/:id/decisions', (req, res) => {
    try {
      const body = allow(req.body, new Set(['expectedTaskVersion', 'affectedItemIds', 'question', 'recommendedOption', 'options', 'idempotencyKey']), 'body');
      const context = actorContext(req); requireDecide(req);
      const task = tasks.getTask(id(req.params.id, 'task id'));
      if (!task) throw new Error('task not found');
      channelPolicy.assertBoundChat(task.channel, context.chatId);
      res.status(201).json(tasks.createDecision({ taskId: task.id, ...body }));
    } catch (error) { fail(res, error); }
  });
  router.post('/decisions/:id/resolve', (req, res) => {
    try {
      const body = allow(req.body, new Set(['expectedDecisionVersion', 'option', 'cardEventId', 'idempotencyKey']), 'body');
      const context = actorContext(req); requireDecide(req);
      const decision = tasks.getDecision(id(req.params.id, 'decision id'));
      if (!decision) throw new Error('decision not found');
      const task = tasks.getTask(decision.taskId);
      channelPolicy.assertBoundChat(task.channel, context.chatId);
      res.json(tasks.resolveDecision({ decisionId: decision.id, ...body, actorUserId: context.actorUserId, bindingId: context.bindingId, channel: context.channel, chatId: context.chatId }));
    } catch (error) { fail(res, error); }
  });
  return router;
}

module.exports = { createMatrixCoreRouter };

'use strict';
const express = require('express');
function allow(value, fields, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be object`); const unknown = Object.keys(value).find(key => !fields.has(key)); if (unknown) throw new Error(`unknown ${label} field: ${unknown}`); return value; }
function fail(res, error) { const message = String(error?.message || 'invalid request'); res.status(/conflict|mismatch/.test(message) ? 409 : /not found/.test(message) ? 404 : 400).json({ error: { code: 'invalid_request', message } }); }
function createMatrixLedgerRouter({ db, conversationLedger } = {}) {
  const router = express.Router();
  router.post('/events', (req, res) => {
    try {
      const body = allow(req.body, new Set(['conversationId','platformNamespace','immutableChatId','immutableRootThreadId','immutableRootMessageId','idempotencyKey','eventKind','direction','channel','threadId','platformMessageId','editVersion','cardEventId','normalizedText','attachmentRefs','bindings','occurredAt','source']), 'body');
      const chatId = String(req.get('x-feishu-chat-id') || '').trim();
      if (!chatId || body.immutableChatId !== chatId) throw new Error('immutable chat id mismatch');
      const binding = req.matrixBinding || db.prepare("SELECT id FROM matrix_actor_bindings WHERE user_id=? AND status='active' ORDER BY id LIMIT 1").get(req.user.id);
      if (!binding) throw new Error('active actor binding required');
      const outcome = conversationLedger.append({ ...body, chatId, actorUserId: req.user.id, bindingId: String(binding.id) });
      res.status(outcome.kind === 'created' ? 201 : 200).json(outcome);
    } catch (error) { fail(res, error); }
  });
  router.get('/timeline', (req, res) => {
    try {
      const query = allow(req.query, new Set(['conversation_id','inquiry_id','item_id','limit']), 'query');
      res.json(conversationLedger.timeline({ conversationId: query.conversation_id, inquiryId: query.inquiry_id, itemId: query.item_id, limit: query.limit }));
    } catch (error) { fail(res, error); }
  });
  return router;
}
module.exports = { createMatrixLedgerRouter };

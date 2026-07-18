'use strict';

const DEFAULT_TASK_TYPES = Object.freeze({
  quote_followup: 'bill',
  customer_reply: 'bill',
  migration_review: 'bill',
  identity_review: 'bill',
  cost_review: 'vmci',
  freight_review: 'vmci',
  formula_review: 'vmci'
});

function exactId(value, label) {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 200) {
    throw new Error(`${label} must be an exact configured chat id`);
  }
  return value;
}

function createMatrixChannelPolicy({ billChatId, vmciChatId, taskTypes = DEFAULT_TASK_TYPES } = {}) {
  const bill = exactId(billChatId, 'bill chat id');
  const vmci = exactId(vmciChatId, 'vmci chat id');
  if (bill === vmci) throw new Error('bill and vmci chat ids must be distinct');
  const declared = new Map(Object.entries(taskTypes || {}));
  for (const [taskType, channel] of declared) {
    if (!taskType || !['bill', 'vmci'].includes(channel)) throw new Error('task type channel declaration invalid');
  }

  function classifyChat(chatId) {
    const exact = exactId(chatId, 'chat id');
    if (exact === bill) return 'bill';
    if (exact === vmci) return 'vmci';
    throw new Error('chat id is not an exact configured chat id');
  }
  function authoritativeChannel(taskType) {
    const channel = declared.get(String(taskType || ''));
    if (!channel) throw new Error('task type is not declared');
    return channel;
  }
  function assertBoundChat(channel, chatId) {
    if (classifyChat(chatId) !== channel) throw new Error('channel chat mismatch');
    return true;
  }
  function routeIncoming({ chatId, taskType } = {}) {
    const channel = classifyChat(chatId);
    const authoritative = authoritativeChannel(taskType);
    return { accepted: channel === authoritative, channel, authoritativeChannel: authoritative, handoffRequired: channel !== authoritative };
  }
  return { classifyChat, authoritativeChannel, assertBoundChat, routeIncoming };
}

module.exports = { createMatrixChannelPolicy };

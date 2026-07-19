'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

const DEFAULT_STORE_PATH = '/workspace/store/matrix-choice-contexts.json';
const MAX_RECORDS = 200;

function clockDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('invalid choice context clock');
  return date;
}

function parseScopedChoice(value) {
  const raw = String(value || '').trim().toUpperCase();
  const explicit = /^(?:候选\s*|开发客户\s*)[A-E]$/.test(raw);
  const normalized = raw.replace(/^候选\s*/, '').replace(/^开发客户\s*/, '');
  return /^[A-E]$/.test(normalized)
    ? { index: normalized.charCodeAt(0) - 65, explicit }
    : null;
}

function readRecords(storePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.records)) {
      throw new Error('invalid choice context store');
    }
    return parsed.records;
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function normalizeRecord(value) {
  const record = {
    message_id: String(value?.message_id || '').trim(),
    chat_id: String(value?.chat_id || '').trim(),
    kind: String(value?.kind || '').trim(),
    created_at: String(value?.created_at || '').trim(),
    expires_at: String(value?.expires_at || '').trim()
  };
  if (!record.message_id || !record.chat_id || record.kind !== 'candidate') {
    throw new Error('invalid choice context binding');
  }
  if (!Number.isFinite(Date.parse(record.created_at)) || !Number.isFinite(Date.parse(record.expires_at))) {
    throw new Error('invalid choice context timestamps');
  }
  if (Date.parse(record.expires_at) <= Date.parse(record.created_at)) {
    throw new Error('choice context must expire after creation');
  }
  return record;
}

function writeRecords(storePath, records) {
  const temporary = `${storePath}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, records })}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, storePath);
    fs.chmodSync(storePath, 0o600);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
}

function registerChoiceContext(value, { storePath = process.env.MATRIX_CHOICE_CONTEXT_PATH || DEFAULT_STORE_PATH, now = new Date() } = {}) {
  const record = normalizeRecord(value);
  const current = clockDate(now).getTime();
  const records = readRecords(storePath)
    .map(normalizeRecord)
    .filter(item => Date.parse(item.expires_at) > current && item.message_id !== record.message_id);
  records.push(record);
  writeRecords(storePath, records.slice(-MAX_RECORDS));
  return record;
}

function resolveChoiceContext({ messageId, chatId, now = new Date() } = {}, { storePath = process.env.MATRIX_CHOICE_CONTEXT_PATH || DEFAULT_STORE_PATH } = {}) {
  const targetMessage = String(messageId || '').trim();
  const targetChat = String(chatId || '').trim();
  if (!targetMessage || !targetChat) return null;
  const current = clockDate(now).getTime();
  const matches = readRecords(storePath)
    .map(normalizeRecord)
    .filter(record => record.message_id === targetMessage
      && record.chat_id === targetChat
      && Date.parse(record.expires_at) > current);
  return matches.length === 1 ? matches[0] : null;
}

module.exports = {
  DEFAULT_STORE_PATH,
  parseScopedChoice,
  registerChoiceContext,
  resolveChoiceContext
};

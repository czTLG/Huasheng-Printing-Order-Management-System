'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_TARGET = '/workspace/store/matrix-asset-context.json';
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const MAX_RECORDS = 200;

function requiredText(value, label) {
  const result = String(value || '').trim();
  if (!result || result.length > 256) throw new Error(`${label} required`);
  return result;
}

function positiveId(value) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1) throw new Error('record id must be a positive integer');
  return result;
}

function atomicWrite(target, payload) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(payload)}\n`, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, target);
    fs.chmodSync(target, 0o600);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
}

function createStore({ target = process.env.MATRIX_ASSET_CONTEXT_PATH || DEFAULT_TARGET, clock = () => Date.now(), ttlMs = DEFAULT_TTL_MS } = {}) {
  function millis() {
    const value = Number(clock());
    if (!Number.isFinite(value)) throw new Error('invalid context clock');
    return value;
  }

  function read() {
    try {
      const payload = JSON.parse(fs.readFileSync(target, 'utf8'));
      if (payload?.version !== 1 || !Array.isArray(payload.records)) return { valid: false, records: [] };
      return { valid: true, records: payload.records };
    } catch (error) {
      if (error?.code === 'ENOENT') return { valid: true, records: [] };
      return { valid: false, records: [] };
    }
  }

  function activeRecords(records, at) {
    return records.filter(record => Number.isInteger(record?.record_id)
      && typeof record.chat_id === 'string'
      && typeof record.operator_id === 'string'
      && Number.isFinite(Date.parse(record.created_at))
      && Date.parse(record.expires_at) > at);
  }

  function bind({ chatId, operatorId, recordId }) {
    const chat = requiredText(chatId, 'chat id');
    const operator = requiredText(operatorId, 'operator id');
    const id = positiveId(recordId);
    const at = millis();
    const state = read();
    const records = state.valid ? activeRecords(state.records, at) : [];
    const next = records.filter(record => record.chat_id !== chat || record.operator_id !== operator);
    next.push({
      chat_id: chat,
      operator_id: operator,
      record_id: id,
      created_at: new Date(at).toISOString(),
      expires_at: new Date(at + ttlMs).toISOString()
    });
    atomicWrite(target, { version: 1, records: next.slice(-MAX_RECORDS) });
    return { recordId: id };
  }

  function resolve({ chatId, operatorId }) {
    const chat = requiredText(chatId, 'chat id');
    const operator = requiredText(operatorId, 'operator id');
    const at = millis();
    const state = read();
    if (!state.valid) return null;
    const active = activeRecords(state.records, at);
    if (active.length !== state.records.length) atomicWrite(target, { version: 1, records: active.slice(-MAX_RECORDS) });
    const matches = active.filter(record => record.chat_id === chat && record.operator_id === operator);
    if (matches.length !== 1) return null;
    return { recordId: matches[0].record_id };
  }

  return { bind, resolve };
}

module.exports = { createStore };

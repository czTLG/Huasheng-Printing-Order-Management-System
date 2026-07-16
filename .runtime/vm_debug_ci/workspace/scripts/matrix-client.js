'use strict';

const BASE = new URL(String(process.env.MATRIX_API_BASE_URL || ''));
if (!['http:', 'https:'].includes(BASE.protocol) || BASE.username || BASE.password) throw new Error('valid MATRIX_API_BASE_URL is required');
const BASE_PATH = BASE.pathname.replace(/\/$/, '');
if (BASE_PATH !== '/api/matrix') throw new Error('MATRIX_API_BASE_URL path must be /api/matrix');

function operatorId(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 128) throw new Error('operator openId required');
  return text;
}

function exactObject(value, allowed, label) {
  const input = value == null ? {} : value;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(`${label} must be an object`);
  const unknown = Object.keys(input).find(key => !allowed.has(key));
  if (unknown) throw new Error(`unknown ${label} field: ${unknown}`);
  return input;
}

function positiveId(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${label} must be a positive integer`);
  return number;
}

function target(pathname, query) {
  const url = new URL(`${BASE.origin}${BASE_PATH}${pathname}`);
  if (url.origin !== BASE.origin || !url.pathname.startsWith(`${BASE_PATH}/`)) throw new Error('matrix URL outside fixed origin');
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url;
}

async function call(openId, pathname, { method = 'GET', query, body } = {}) {
  const token = String(process.env.MATRIX_BRIDGE_TOKEN || '');
  if (!token) throw new Error('MATRIX_BRIDGE_TOKEN is required');
  const url = target(pathname, query);
  const headers = {
    accept: 'application/json',
    'x-matrix-bridge-token': token,
    'x-feishu-open-id': operatorId(openId)
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
    signal: AbortSignal.timeout(10000)
  });
  if (response.status >= 300 && response.status < 400) {
    const error = new Error(`matrix API redirect refused (${response.status})`);
    error.status = response.status;
    throw error;
  }
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) throw new Error('matrix API returned non-JSON response');
  let payload;
  try { payload = await response.json(); } catch (_) { throw new Error('matrix API returned invalid JSON'); }
  if (!response.ok) {
    const error = new Error(`matrix API HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function facets(openId) {
  return call(openId, '/facets');
}

function createSession(openId, input) {
  const fields = new Set(['session_id', 'expected_version', 'chat_id', 'thread_id', 'filters', 'expires_at', 'page']);
  const body = { ...exactObject(input, fields, 'session') };
  if (body.session_id !== undefined) {
    const id = positiveId(body.session_id, 'session id');
    delete body.session_id;
    return call(openId, `/sessions/${id}`, { method: 'PATCH', body });
  }
  return call(openId, '/sessions', { method: 'POST', body });
}

function listCandidates(openId, filters = {}) {
  const query = exactObject(filters, new Set(['region', 'country', 'category', 'priority', 'status', 'page', 'page_size']), 'candidate filters');
  return call(openId, '/candidates', { query });
}

function candidateDetail(openId, candidateId) {
  return call(openId, `/candidates/${positiveId(candidateId, 'candidate id')}`);
}

function today(openId, filters = {}) {
  const query = exactObject(filters, new Set(['region', 'country', 'category', 'priority', 'status', 'page_size']), 'recommendation filters');
  return call(openId, '/recommendations/today', { query });
}

function selectCandidate(openId, input) {
  const body = exactObject(input, new Set(['candidate_id', 'session_id', 'expected_version', 'idempotency_key', 'next_action']), 'selection');
  return call(openId, '/selections', { method: 'POST', body });
}

function workItems(openId, filters = {}) {
  const query = exactObject(filters, new Set(['stage', 'limit']), 'work filters');
  return call(openId, '/work-items', { query });
}

module.exports = { facets, createSession, listCandidates, candidateDetail, today, selectCandidate, workItems };

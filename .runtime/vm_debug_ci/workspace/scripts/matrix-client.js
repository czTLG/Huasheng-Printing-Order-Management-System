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

function contextOpenId(fallback) {
  return operatorId(process.env.MATRIX_CONTEXT_OPEN_ID || process.env.MATRIX_OWNER_OPEN_ID || fallback);
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
  const fields = new Set(['session_id', 'expected_version', 'chat_id', 'thread_id', 'filters', 'snapshot_key', 'candidate_ids', 'expires_at', 'page']);
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

function candidateDetail(openId, candidateId, context = {}) {
  const query = exactObject(context, new Set(['session_id', 'chat_id', 'thread_id']), 'candidate context');
  return call(openId, `/candidates/${positiveId(candidateId, 'candidate id')}`, { query });
}

function rehydrateSession(openId, input = {}) {
  const query = exactObject(input, new Set(['session_id', 'chat_id', 'thread_id']), 'session context');
  const path = query.session_id === undefined ? '/sessions/current' : `/sessions/${positiveId(query.session_id, 'session id')}`;
  const { session_id: _sessionId, ...context } = query;
  return call(openId, path, { query: context });
}

function today(openId, filters = {}) {
  const query = exactObject(filters, new Set(['region', 'country', 'category', 'priority', 'status', 'page', 'page_size']), 'recommendation filters');
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

function claimInboxJob(openId) {
  return call(openId, '/inbox/jobs/claim', { method: 'POST', body: {} });
}

function inboxWorkbench(openId) {
  return call(openId, '/inbox/workbench');
}

function contextSearch(openId, query) {
  const value = String(query || '').trim();
  if (value.length < 2 || value.length > 160) throw new Error('context query must contain 2 to 160 characters');
  return call(contextOpenId(openId), '/context/search', { query: { query: value } });
}

function contextResolve(openId, text) {
  const value = String(text || '').trim();
  if (value.length < 2 || value.length > 2000) throw new Error('conversation context must contain 2 to 2000 characters');
  return call(contextOpenId(openId), '/context/resolve', { query: { text: value } });
}

function contextRecord(openId, recordId) {
  return call(contextOpenId(openId), `/context/records/${positiveId(recordId, 'context record id')}`);
}

function ackInboxJob(openId, jobId, input) {
  const body = exactObject(input, new Set(['lease_token', 'notification_uuid', 'status']), 'inbox acknowledgment');
  return call(openId, `/inbox/jobs/${positiveId(jobId, 'inbox job id')}/ack`, { method: 'POST', body });
}

function failInboxJob(openId, jobId, input) {
  const body = exactObject(input, new Set(['lease_token', 'error_code']), 'inbox failure');
  return call(openId, `/inbox/jobs/${positiveId(jobId, 'inbox job id')}/fail`, { method: 'POST', body });
}

module.exports = {
  facets,
  createSession,
  rehydrateSession,
  listCandidates,
  candidateDetail,
  today,
  selectCandidate,
  workItems,
  claimInboxJob,
  inboxWorkbench,
  contextSearch,
  contextResolve,
  contextRecord,
  ackInboxJob,
  failInboxJob
};

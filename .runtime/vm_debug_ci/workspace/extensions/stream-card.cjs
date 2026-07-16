'use strict';

const crypto = require('crypto');
const fs = require('fs');

const ACTIONS = ['mx.today', 'mx.pick', 'mx.page', 'mx.detail', 'mx.back', 'mx.select', 'mx.work', 'mx.filters', 'mx.region', 'mx.category'];
const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const SESSION_TTL_MS = 30 * 60 * 1000;
const REMINDER_SPOOL_PATH = '/workspace/store/matrix-reminder-pending.json';

async function deliverQueuedReminder({
  spoolPath = REMINDER_SPOOL_PATH,
  expectedChatId = process.env.STREAM_CHAT_ID,
  channel,
  sendManagedCard
}) {
  let raw;
  try { raw = fs.readFileSync(spoolPath, 'utf8'); }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
  const queued = JSON.parse(raw);
  const keys = Object.keys(queued || {}).sort();
  if (JSON.stringify(keys) !== JSON.stringify(['card', 'chat_id', 'id', 'version'])) throw new Error('invalid reminder spool fields');
  if (queued.version !== 1 || !queued.id || String(queued.chat_id) !== String(expectedChatId || '')) throw new Error('invalid reminder spool binding');
  if (!queued.card || typeof queued.card !== 'object' || Array.isArray(queued.card)) throw new Error('invalid reminder spool card');
  await sendManagedCard(channel, queued.chat_id, queued.card, '', false);
  fs.unlinkSync(spoolPath);
  return true;
}

function clip(value, maximum = 90) {
  const text = String(value == null || value === '' ? '待核实' : value).replace(/[\r\n]+/g, ' ').trim();
  const points = [...text];
  return points.length > maximum ? `${points.slice(0, maximum - 1).join('')}…` : text;
}

function eventId(session, candidate) {
  return crypto.createHash('sha256').update(`${session.id}:${session.version}:${candidate.id}:select`).digest('hex').slice(0, 24);
}

function sessionKey(chatId, openId) {
  return `${String(chatId || '')}\u0000${String(openId || '')}`;
}

function statusLabel(value) {
  return ({ valid: '有效', needs_review: '待核实' })[value] || '待核实';
}

function renderCandidates(state, cardHelpers) {
  const { card, md, note, hr, actions, button } = cardHelpers;
  const elements = [];
  state.candidates.slice(0, 5).forEach((candidate, index) => {
    const label = LETTERS[index];
    const categories = Array.isArray(candidate.categories) && candidate.categories.length ? candidate.categories.join('、') : '待核实';
    elements.push(md([
      `**${label}｜${clip(candidate.company_name, 26)}｜${clip(candidate.country_code, 4)}｜${clip(candidate.priority, 3)}**`,
      `推荐理由：${clip(candidate.assessment_cn, 36)}`,
      `品类：${clip(categories, 20)}`,
      `数据状态：${statusLabel(candidate.status)}`,
      `待核实：${Array.isArray(candidate.size_signals) && candidate.size_signals.length ? clip(candidate.size_signals.join('、'), 24) : '规格与联系人角色'}`,
      `下一步：${clip(candidate.next_action_cn, 28)}`
    ].join('\n')));
    elements.push(actions([
      button('查看详情', { a: 'mx.detail', s: state.session.id, v: state.session.version, c: candidate.id }, 'default'),
      button('选择', { a: 'mx.select', s: state.session.id, v: state.session.version, c: candidate.id, e: eventId(state.session, candidate) }, 'primary')
    ]));
    if (index < Math.min(4, state.candidates.length - 1)) elements.push(hr());
  });
  elements.push(actions([
    button('换一批', { a: 'mx.page', s: state.session.id, v: state.session.version }, 'default'),
    button('高级筛选', { a: 'mx.filters', s: state.session.id, v: state.session.version }, 'default'),
    button('查看进行中', { a: 'mx.work', s: state.session.id, v: state.session.version }, 'default')
  ]));
  elements.push(note('回复 A、B、C、D 或 E 可查看对应详情。'));
  return card(elements, { header: { title: '今日候选', template: 'blue' }, summary: '今日候选' });
}

function renderDetail(detail, state, cardHelpers, chatId) {
  const { card, md, note, actions, button, linkButton } = cardHelpers;
  const discovery = detail.discovery || {};
  const evidence = Array.isArray(detail.official_evidence) ? detail.official_evidence.slice(0, 3) : [];
  const formats = Array.isArray(detail.format_signals) && detail.format_signals.length ? detail.format_signals.join('、') : '待核实';
  const sizes = Array.isArray(detail.size_signals) && detail.size_signals.length ? detail.size_signals.join('、') : '待核实';
  const restricted = new Set(String(process.env.MATRIX_RESTRICTED_CHAT_IDS || '').split(',').map(item => item.trim()).filter(Boolean)).has(String(chatId));
  const contactTypes = Object.entries(detail.contacts || {}).filter(([, value]) => Boolean(value)).map(([key]) => key).join('、') || '待核实';
  const contactLine = restricted
    ? Object.entries(detail.contacts || {}).filter(([, value]) => Boolean(value)).map(([key, value]) => `${key}：${clip(value, 80)}`).join('\n') || '待核实'
    : `已发现类型：${contactTypes}；请在CRM详情中查看`;
  const evidenceLines = evidence.length ? evidence.map(item => `• ${clip(item.page_title || '证据', 30)}：${clip(item.source_url, 110)}`).join('\n') : '• 待核实';
  const elements = [md([
    `**${clip(detail.company_name, 60)}｜${clip(detail.country_code, 8)}｜${clip(detail.priority, 4)}**`,
    `发现渠道：${clip(discovery.discovered_via, 60)}`,
    `发现来源：${clip(discovery.discovery_url, 120)}`,
    `官网：${clip(detail.official_url, 120)}`,
    `证据：\n${evidenceLines}`,
    `已确认：品类 ${clip((detail.categories || []).join('、'), 70)}；形式 ${clip(formats, 70)}`,
    `待核实：规格 ${clip(sizes, 70)}；联系人角色`,
    `联系方式：${contactLine}`,
    `下一步：${clip(detail.next_action_cn, 80)}`
  ].join('\n'))];
  const crmBase = String(process.env.MATRIX_CRM_DETAIL_BASE_URL || '').replace(/\/$/, '');
  elements.push(actions([
    button('返回列表', { a: 'mx.back', s: state.session.id, v: state.session.version }, 'default'),
    button('选择', { a: 'mx.select', s: state.session.id, v: state.session.version, c: detail.id, e: eventId(state.session, detail) }, 'primary'),
    ...(crmBase ? [linkButton('CRM详情', `${crmBase}/${encodeURIComponent(detail.id)}`)] : [])
  ]));
  elements.push(note('公开信息可能变化，未确认项不会自动转为事实。'));
  return card(elements, { header: { title: '候选详情', template: 'blue' }, summary: '候选详情' });
}

function restartCard(cardHelpers) {
  return cardHelpers.card([cardHelpers.note('当前没有活动列表，请发送“开发客户”重新开始。')], { summary: '请重新开始' });
}

function infoCard(cardHelpers, message) {
  return cardHelpers.card([cardHelpers.note(clip(message, 180))], { summary: '操作提示' });
}

function renderFilters(facets, state, cardHelpers) {
  const { card, md, note, hr, actions, button } = cardHelpers;
  const regions = (facets.regions || []).filter(item => ['africa', 'americas', 'asia', 'europe', 'oceania'].includes(item.value));
  const countries = (facets.countries || []).filter(item => /^[A-Z]{2}$/.test(item.value) && !['CN', 'IN'].includes(item.value));
  const categories = (facets.categories || []).filter(item => item.value && !/广州|中国|China/i.test(String(item.value)));
  const regionButtons = regions.slice(0, 5).map(item => button(item.value, { a: 'mx.region', s: state.session.id, v: state.session.version, r: item.value }, 'default'));
  const countryButtons = countries.slice(0, 8).map(item => button(item.value, { a: 'mx.region', s: state.session.id, v: state.session.version, r: `country:${item.value}` }, 'default'));
  const categoryButtons = categories.slice(0, 8).map(item => button(clip(item.value, 24), { a: 'mx.category', s: state.session.id, v: state.session.version, k: item.value }, 'default'));
  return card([
    md('**海外地区**'), actions(regionButtons),
    hr(), md('**海外国家**'), actions(countryButtons),
    hr(), md('**品类**'), actions(categoryButtons),
    note('高级筛选仅提供海外地区、国家和品类，不使用城市自由输入。')
  ], { header: { title: '高级筛选', template: 'blue' }, summary: '高级筛选' });
}

function renderWorkItems(rows, cardHelpers) {
  const { card, md, note } = cardHelpers;
  const lines = (rows || []).slice(0, 10).map(row => `• #${row.candidate_id}｜${clip(row.stage, 24)}｜下一步：${clip(row.next_action, 70)}`);
  return card([md(lines.length ? lines.join('\n') : '暂无进行中项目'), note('这里只展示当前操作者负责的工作项。')], { summary: '进行中' });
}

function register(context) {
  if (process.env.MATRIX_DELIVERY_ENABLED !== '0') throw new Error('MATRIX_DELIVERY_ENABLED must be exactly 0');
  const { channel, dispatcher, sendManagedCard, card: cardHelpers } = context;
  const client = context.client || require('../scripts/matrix-client.js');
  const now = typeof context.now === 'function' ? context.now : () => Date.now();
  const sessions = new Map();
  const selectionEvents = new Map();
  const scheduleReminderPoll = context.scheduleReminderPoll || ((callback, delay) => setInterval(callback, delay));
  let reminderPollActive = false;
  const pollReminder = async () => {
    if (reminderPollActive) return;
    reminderPollActive = true;
    try {
      await deliverQueuedReminder({
        channel, sendManagedCard,
        spoolPath: context.reminderSpoolPath || REMINDER_SPOOL_PATH
      });
    } catch (error) {
      process.stderr.write(`[stream-card] reminder delivery failed: ${error?.message || 'unknown error'}\n`);
    } finally {
      reminderPollActive = false;
    }
  };
  const reminderTimer = scheduleReminderPoll(pollReminder, Math.max(1000, Number(context.reminderPollMs || 5000)));
  reminderTimer.unref?.();

  function clockMillis() {
    const value = now();
    const millis = value instanceof Date ? value.getTime() : Number(value);
    if (!Number.isFinite(millis)) throw new Error('invalid extension clock');
    return millis;
  }

  function invalidSessionError(error) {
    return Boolean(error?.matrixSessionInvalid)
      || Number(error?.status) === 409
      || /session.*(?:expired|stale)|(?:expired|stale).*session|callback (?:session expired|stale version|session context mismatch)/i.test(String(error?.message || ''));
  }

  function stateExpired(state) {
    const expiresAt = Date.parse(state?.session?.expires_at || '');
    return !Number.isFinite(expiresAt) || expiresAt <= clockMillis();
  }

  async function sessionBound(request) {
    try {
      return await request();
    } catch (error) {
      if ([400, 409].includes(Number(error?.status)) || invalidSessionError(error)) error.matrixSessionInvalid = true;
      throw error;
    }
  }

  async function start(msg) {
    const openId = String(msg.senderId || '').trim();
    if (!openId) throw new Error('operator openId required');
    const recommendation = await client.today(openId, { page_size: 5 });
    const session = await client.createSession(openId, {
      chat_id: msg.chatId,
      thread_id: msg.threadId || '',
      filters: { page_size: 5 },
      expires_at: new Date(clockMillis() + SESSION_TTL_MS).toISOString()
    });
    const state = {
      session,
      candidates: (recommendation.rows || []).slice(0, 5),
      snapshotKey: recommendation.snapshot_key || '',
      filters: { page_size: 5 }
    };
    sessions.set(sessionKey(msg.chatId, openId), state);
    await sendManagedCard(channel, msg.chatId, renderCandidates(state, cardHelpers), msg.messageId, Boolean(msg.threadId));
  }

  async function refreshSession(openId, state, chatId, threadId, patch = {}) {
    const filters = patch.filters || state.filters;
    const page = patch.page || state.session.page;
    const session = await sessionBound(() => client.createSession(openId, {
      session_id: state.session.id,
      expected_version: state.session.version,
      page,
      filters
    }));
    if (String(session.chat_id) !== String(chatId || '') || String(session.thread_id || '') !== String(threadId || '')) {
      throw new Error('callback session context mismatch');
    }
    state.session = session;
    state.filters = filters;
    return session;
  }

  async function sendForEvent(evt, card) {
    await sendManagedCard(channel, evt.chatId, card, evt.messageId, Boolean(evt.threadId));
  }

  function callbackState(evt, value, { allowReplay = false } = {}) {
    const openId = String(evt?.operator?.openId || '').trim();
    if (!openId) throw new Error('operator openId required');
    const key = sessionKey(evt.chatId, openId);
    const state = sessions.get(key);
    if (!state || stateExpired(state) || Number(value?.s) !== Number(state.session.id)) {
      sessions.delete(key);
      const error = new Error('callback session expired');
      error.matrixSessionInvalid = true;
      throw error;
    }
    if (String(state.session.chat_id) !== String(evt.chatId || '') || String(state.session.thread_id || '') !== String(evt.threadId || '')) {
      throw new Error('callback session context mismatch');
    }
    if (Number(value?.v) !== Number(state.session.version) && !(allowReplay && selectionEvents.has(String(value?.e || '')))) {
      throw new Error('callback stale version');
    }
    return { openId, state };
  }

  async function detailAction({ evt, value }) {
    const { openId, state } = callbackState(evt, value);
    const candidate = state.candidates.find(item => Number(item.id) === Number(value.c));
    if (!candidate) throw new Error('candidate not in active list');
    await refreshSession(openId, state, evt.chatId, evt.threadId);
    const detail = await sessionBound(() => client.candidateDetail(openId, candidate.id));
    await sendForEvent(evt, renderDetail(detail, state, cardHelpers, evt.chatId));
  }

  async function filterAction({ evt, value }) {
    const { openId, state } = callbackState(evt, value);
    await refreshSession(openId, state, evt.chatId, evt.threadId);
    const facets = await client.facets(openId);
    await sendForEvent(evt, renderFilters(facets, state, cardHelpers));
  }

  async function applyFilters({ evt, value }, kind) {
    const { openId, state } = callbackState(evt, value);
    const filters = { ...state.filters };
    if (kind === 'category') filters.category = String(value.k || '');
    else if (String(value.r || '').startsWith('country:')) filters.country = String(value.r).slice(8);
    else filters.region = String(value.r || '');
    delete filters.page;
    await refreshSession(openId, state, evt.chatId, evt.threadId, { filters, page: 1 });
    const result = await client.listCandidates(openId, { ...filters, page: 1, page_size: 5 });
    state.candidates = (result.rows || []).slice(0, 5);
    state.snapshotKey = result.snapshot_key || state.snapshotKey;
    await sendForEvent(evt, renderCandidates(state, cardHelpers));
  }

  async function pageAction({ evt, value }) {
    const { openId, state } = callbackState(evt, value);
    const page = Number(state.session.page || 1) + 1;
    await refreshSession(openId, state, evt.chatId, evt.threadId, { page });
    const result = await client.listCandidates(openId, { ...state.filters, page, page_size: 5 });
    state.candidates = (result.rows || []).slice(0, 5);
    state.snapshotKey = result.snapshot_key || state.snapshotKey;
    await sendForEvent(evt, renderCandidates(state, cardHelpers));
  }

  async function backAction({ evt, value }) {
    const { openId, state } = callbackState(evt, value);
    await refreshSession(openId, state, evt.chatId, evt.threadId);
    await sendForEvent(evt, renderCandidates(state, cardHelpers));
  }

  async function selectAction({ evt, value }) {
    const { openId, state } = callbackState(evt, value, { allowReplay: true });
    const key = String(value.e || '').trim();
    if (!key) throw new Error('action event id required');
    let input = selectionEvents.get(key);
    if (!input) {
      const candidate = state.candidates.find(item => Number(item.id) === Number(value.c));
      if (!candidate) throw new Error('candidate not in active list');
      input = {
        candidate_id: candidate.id,
        session_id: state.session.id,
        expected_version: Number(value.v),
        idempotency_key: key,
        next_action: candidate.next_action_cn || '核实公开信息'
      };
      selectionEvents.set(key, input);
    }
    const result = await client.selectCandidate(openId, input);
    if (Number(result.session_version) > Number(state.session.version)) state.session.version = result.session_version;
    await sendForEvent(evt, infoCard(cardHelpers, `已加入进行中｜候选 #${result.candidate_id}｜下一步：${result.next_action || input.next_action}`));
  }

  async function workAction({ evt, value }) {
    const { openId, state } = callbackState(evt, value);
    await refreshSession(openId, state, evt.chatId, evt.threadId);
    const result = await client.workItems(openId, {});
    await sendForEvent(evt, renderWorkItems(result.rows, cardHelpers));
  }

  async function todayAction({ evt }) {
    const openId = String(evt?.operator?.openId || '').trim();
    if (!openId) throw new Error('operator openId required');
    await start({ senderId: openId, chatId: evt.chatId, threadId: evt.threadId || '', messageId: evt.messageId });
  }

  const actionHandlers = {
    'mx.today': todayAction,
    'mx.pick': detailAction,
    'mx.page': pageAction,
    'mx.detail': detailAction,
    'mx.back': backAction,
    'mx.select': selectAction,
    'mx.work': workAction,
    'mx.filters': filterAction,
    'mx.region': payload => applyFilters(payload, 'region'),
    'mx.category': payload => applyFilters(payload, 'category')
  };
  for (const action of ACTIONS) {
    dispatcher.on(action, async payload => {
      try {
        await actionHandlers[action](payload);
      } catch (error) {
        if (invalidSessionError(error)) {
          sessions.delete(sessionKey(payload.evt?.chatId, payload.evt?.operator?.openId));
          await sendForEvent(payload.evt, restartCard(cardHelpers));
        } else {
          await sendForEvent(payload.evt, infoCard(cardHelpers, '操作未完成，请稍后重试。'));
        }
      }
    });
  }

  return {
    async onMessage({ msg }) {
      const text = String(msg?.content || '').trim();
      if (text === '开发客户') {
        await start(msg);
        return true;
      }
      if (/^[A-E]$/.test(text)) {
        const openId = String(msg?.senderId || '').trim();
        const key = sessionKey(msg?.chatId, openId);
        const state = sessions.get(key);
        if (!state || stateExpired(state)) {
          sessions.delete(key);
          await sendManagedCard(channel, msg.chatId, restartCard(cardHelpers), msg.messageId, Boolean(msg.threadId));
          return true;
        }
        const candidate = state.candidates[LETTERS.indexOf(text)];
        if (!candidate) {
          await sendManagedCard(channel, msg.chatId, restartCard(cardHelpers), msg.messageId, Boolean(msg.threadId));
          return true;
        }
        try {
          await refreshSession(openId, state, msg.chatId, msg.threadId);
          const detail = await sessionBound(() => client.candidateDetail(openId, candidate.id));
          await sendManagedCard(channel, msg.chatId, renderDetail(detail, state, cardHelpers, msg.chatId), msg.messageId, Boolean(msg.threadId));
        } catch (error) {
          if (!invalidSessionError(error)) throw error;
          sessions.delete(key);
          await sendManagedCard(channel, msg.chatId, restartCard(cardHelpers), msg.messageId, Boolean(msg.threadId));
        }
        return true;
      }
      return false;
    }
  };
}

module.exports = { register, deliverQueuedReminder };

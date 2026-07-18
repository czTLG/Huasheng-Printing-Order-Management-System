'use strict';

const crypto = require('crypto');
const fs = require('fs');

const ACTIONS = ['mx.today', 'mx.pick', 'mx.quick', 'mx.page', 'mx.detail', 'mx.back', 'mx.select', 'mx.work', 'mx.filters', 'mx.region', 'mx.category', 'mx.review', 'mx.revise', 'mx.approve', 'mx.preview', 'mx.confirm', 'mx.reply_draft', 'mx.retry_translation'];
const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const SESSION_TTL_MS = 30 * 60 * 1000;
const REVISION_TTL_MS = 10 * 60 * 1000;
const REMINDER_SPOOL_PATH = '/workspace/store/matrix-reminder-pending.json';
const REMINDER_INFLIGHT_PATH = '/workspace/store/matrix-reminder-inflight.json';
const REMINDER_RECEIPT_PATH = '/workspace/store/matrix-reminder-receipt.json';
const REPLY_SPOOL_PATH = '/workspace/store/matrix-reply-pending.json';
const REPLY_INFLIGHT_PATH = '/workspace/store/matrix-reply-inflight.json';
const QUALIFICATION_PATTERN = /(?:\b(?:ISO\s*\d*|GMP|HACCP|BRC|HALAL|SMETA|BSCI|FSSC|FDA|QS)\b|认证|资质|certificat)/i;

function readOptionalJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

function writeJsonAtomic(targetPath, value) {
  const temporary = `${targetPath}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, targetPath);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
}

function writeReceiptAtomic(receiptPath, receipt) {
  writeJsonAtomic(receiptPath, receipt);
}

function validateReminder(record, expectedChatId, state) {
  const keys = Object.keys(record || {}).sort();
  const expected = ['attempted_at', 'card', 'chat_id', 'date', 'id', 'version'];
  if (JSON.stringify(keys) !== JSON.stringify(expected)) throw new Error(`invalid reminder ${state} fields`);
  if (record.version !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(record.date) || !/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(record.id) || String(record.chat_id) !== String(expectedChatId || '')) throw new Error(`invalid reminder ${state} binding`);
  if (!record.card || typeof record.card !== 'object' || Array.isArray(record.card)) throw new Error(`invalid reminder ${state} card`);
  if (record.attempted_at !== null && !Number.isFinite(Date.parse(record.attempted_at))) throw new Error(`invalid reminder ${state} attempt time`);
  return record;
}

async function deliverQueuedReminder({
  spoolPath = REMINDER_SPOOL_PATH,
  inflightPath = REMINDER_INFLIGHT_PATH,
  receiptPath = REMINDER_RECEIPT_PATH,
  expectedChatId = process.env.STREAM_CHAT_ID,
  channel,
  sendManagedCard,
  writeReceipt = writeReceiptAtomic,
  removeInflight = file => fs.unlinkSync(file),
  clock = () => new Date()
}) {
  const priorReceipt = readOptionalJson(receiptPath);
  const existingInflight = readOptionalJson(inflightPath);
  if (existingInflight) {
    validateReminder(existingInflight, expectedChatId, 'inflight');
    if (priorReceipt?.id === existingInflight.id) {
      removeInflight(inflightPath);
      return { status: 'delivered', id: existingInflight.id };
    }
    return { status: 'ambiguous', id: existingInflight.id, manual_reconciliation: true };
  }

  const queued = readOptionalJson(spoolPath);
  if (!queued) return false;
  validateReminder(queued, expectedChatId, 'pending');
  if (priorReceipt?.id === queued.id) {
    fs.unlinkSync(spoolPath);
    return { status: 'delivered', id: queued.id };
  }

  fs.renameSync(spoolPath, inflightPath);
  const attemptedAt = clock();
  const attemptedDate = attemptedAt instanceof Date ? attemptedAt : new Date(attemptedAt);
  if (!Number.isFinite(attemptedDate.getTime())) throw new Error('invalid reminder delivery clock');
  const inflight = { ...queued, attempted_at: attemptedDate.toISOString() };
  writeJsonAtomic(inflightPath, inflight);
  const sent = await sendManagedCard(channel, inflight.chat_id, inflight.card, '', false, 'chat_id', inflight.id);
  writeReceipt(receiptPath, {
    version: 1, date: inflight.date, id: inflight.id, chat_id: inflight.chat_id,
    message_id: String(sent?.messageId || ''), delivered_at: new Date().toISOString()
  });
  removeInflight(inflightPath);
  return { status: 'delivered', id: inflight.id };
}

function validateReplyRecord(record, expectedChatId) {
  const keys = Object.keys(record || {}).sort();
  const expected = ['card', 'chat_id', 'claim_token', 'id', 'notification_key', 'version'];
  if (JSON.stringify(keys) !== JSON.stringify(expected)) throw new Error('invalid reply notification record fields');
  if (record.version !== 1 || !Number.isInteger(record.id) || record.id < 1
      || !/^[0-9a-f-]{36}$/i.test(record.notification_key)
      || !/^[0-9a-f-]{36}$/i.test(record.claim_token)
      || String(record.chat_id) !== String(expectedChatId || '')) throw new Error('invalid reply notification record binding');
  if (!record.card || typeof record.card !== 'object' || Array.isArray(record.card)) throw new Error('invalid reply notification card');
  return record;
}

async function deliverQueuedReply({
  client, openId = process.env.MATRIX_OWNER_OPEN_ID,
  spoolPath = REPLY_SPOOL_PATH, inflightPath = REPLY_INFLIGHT_PATH,
  expectedChatId = process.env.STREAM_CHAT_ID, channel, sendManagedCard
}) {
  const resolved = (record, result) => {
    const state = String(result?.delivery_state || '');
    if (!['pending', 'delivered', 'manual_review'].includes(state)) throw new Error('notification state unresolved');
    fs.unlinkSync(inflightPath);
    return { status: state === 'pending' ? 'retry_pending' : state, id: record.id };
  };
  const existingInflight = readOptionalJson(inflightPath);
  if (existingInflight) {
    const record = validateReplyRecord(existingInflight, expectedChatId);
    const status = await client.notificationStatus(openId, record.id, { claim_token: record.claim_token });
    if (status?.delivery_state !== 'inflight' || status?.can_deliver !== true) return resolved(record, status);
    const result = await client.nackNotification(openId, record.id, { claim_token: record.claim_token, outcome: 'ambiguous' });
    return resolved(record, result);
  }
  const queued = readOptionalJson(spoolPath);
  if (!queued) return false;
  const record = validateReplyRecord(queued, expectedChatId);
  fs.renameSync(spoolPath, inflightPath);
  const status = await client.notificationStatus(openId, record.id, { claim_token: record.claim_token });
  if (status?.delivery_state !== 'inflight' || status?.can_deliver !== true) return resolved(record, status);
  let sent;
  try {
    sent = await sendManagedCard(channel, record.chat_id, record.card, '', false, 'chat_id', record.notification_key);
  } catch (error) {
    const outcome = error?.definiteDeliveryFailure === true ? 'failed' : 'ambiguous';
    const result = await client.nackNotification(openId, record.id, { claim_token: record.claim_token, outcome });
    return resolved(record, result);
  }
  const receiptId = String(sent?.messageId || record.notification_key);
  const result = await client.ackNotification(openId, record.id, { claim_token: record.claim_token, receipt_id: receiptId });
  return resolved(record, result);
}

function clip(value, maximum = 90) {
  const text = String(value == null || value === '' ? '待核实' : value).replace(/[\r\n]+/g, ' ').trim();
  const points = [...text];
  return points.length > maximum ? `${points.slice(0, maximum - 1).join('')}…` : text;
}

function eventId(session, candidate) {
  return crypto.createHash('sha256').update(`${session.id}:${session.version}:${candidate.id}:select`).digest('hex').slice(0, 24);
}

function sessionKey(chatId, openId, threadId = '') {
  return `${String(chatId || '')}\u0000${String(threadId || '')}\u0000${String(openId || '')}`;
}

function parseQuickChoice(value) {
  const text = String(value || '').trim().toUpperCase().replace(/^开发客户\s*/, '');
  return /^[A-E]$/.test(text) ? LETTERS.indexOf(text) : null;
}

function statusLabel(value) {
  return ({ valid: '有效', needs_review: '待核实' })[value] || '待核实';
}

function stageLabel(value) {
  return ({ observed: '已观察', recommendation_ready: '推荐就绪', selected: '已选择', draft_pending: '草稿待处理', review_pending: '审核待处理', suppressed: '已抑制' })[value] || '待核实';
}

function confirmedSignals(values) {
  const signals = Array.isArray(values) ? values.map(value => String(value || '').trim()).filter(value => value && !QUALIFICATION_PATTERN.test(value)) : [];
  const isSpecification = value => /\d+(?:[.,]\d+)?\s*(?:μm|um|microns?|mm|cm|kg|mg|g|ml|cl|l|oz|lbs?|inches?|inch)\b/i.test(value)
    || /\d+(?:[.,]\d+)?\s*["”]/.test(value)
    || /\d+(?:[.,]\d+)?\s*[x×*]\s*\d+(?:[.,]\d+)?/i.test(value);
  return {
    specifications: signals.filter(isSpecification),
    observations: signals.filter(value => !isSpecification(value))
  };
}

function withoutQualification(value) {
  const segments = String(value || '').split(/[，,；;。]/).map(item => item.trim()).filter(Boolean);
  const visible = segments.filter(item => !QUALIFICATION_PATTERN.test(item));
  return visible.join('，') || '产品与规模依据见公开来源';
}

function renderCandidates(state, cardHelpers) {
  const { card, md, note, hr, actions, button } = cardHelpers;
  if (!state.candidates.length) return card([md('当前筛选条件下没有达到公开证据标准的候选。'), note('可稍后重试或调整高级筛选。')], { header: { title: '暂无合格候选', template: 'blue' }, summary: '暂无合格候选' });
  const elements = [];
  state.candidates.slice(0, 5).forEach((candidate, index) => {
    const label = LETTERS[index];
    const categories = Array.isArray(candidate.categories) && candidate.categories.length ? candidate.categories.join('、') : '待核实';
    const signals = confirmedSignals(candidate.size_signals);
    elements.push(md([
      `**${label}｜${clip(candidate.company_name, 26)}｜${clip(candidate.country_code, 4)}｜${clip(candidate.priority, 3)}**`,
      `推荐理由：${clip(withoutQualification(candidate.assessment_cn), 28)}`,
      `品类：${clip(categories, 16)}`,
      `数据状态：${statusLabel(candidate.status)}｜阶段：${stageLabel(candidate.stage_code)}`,
      ...(signals.specifications.length ? [`已确认规格：${clip(signals.specifications.join('、'), 12)}`] : []),
      ...(signals.observations.length ? [`已确认公开信号：${clip(signals.observations.join('、'), 12)}`] : []),
      `待核实：${signals.specifications.length ? '联系人角色' : '规格与联系人角色'}`,
      `下一步：${clip(candidate.next_action_cn, 28)}`
    ].join('\n')));
    elements.push(actions([
      button(`查看 ${label}`, { a: 'mx.detail', s: state.session.id, v: state.session.version, c: candidate.id }, 'default')
    ]));
    if (index < Math.min(4, state.candidates.length - 1)) elements.push(hr());
  });
  elements.push(actions([
    button('换一批', { a: 'mx.page', s: state.session.id, v: state.session.version }, 'default'),
    button('高级筛选', { a: 'mx.filters', s: state.session.id, v: state.session.version }, 'default'),
    button('查看进行中', { a: 'mx.work', s: state.session.id, v: state.session.version }, 'default')
  ]));
  elements.push(note('也可 @智能桓 回复 A-E 查看详情；确认后才会加入进行中。'));
  return card(elements, { header: { title: '今日候选', template: 'blue' }, summary: '今日候选' });
}

function renderDetail(detail, state, cardHelpers, chatId) {
  const { card, md, note, actions, button, linkButton } = cardHelpers;
  const discovery = detail.discovery || {};
  const evidence = Array.isArray(detail.official_evidence) ? detail.official_evidence.slice(0, 3) : [];
  const formats = Array.isArray(detail.format_signals) && detail.format_signals.length ? detail.format_signals.join('、') : '待核实';
  const signals = confirmedSignals(detail.size_signals);
  const restricted = new Set(String(process.env.MATRIX_RESTRICTED_CHAT_IDS || '').split(',').map(item => item.trim()).filter(Boolean)).has(String(chatId));
  const contactTypes = Object.entries(detail.contacts || {}).filter(([, value]) => Boolean(value)).map(([key]) => key).join('、') || '待核实';
  const contactLine = restricted
    ? Object.entries(detail.contacts || {}).filter(([, value]) => Boolean(value)).map(([key, value]) => `${key}：${clip(value, 80)}`).join('\n') || '待核实'
    : `已发现类型：${contactTypes}；请在CRM详情中查看`;
  const evidenceLines = evidence.length ? evidence.map(item => `• ${clip(item.page_title || '证据', 30)}：${clip(item.source_url, 110)}`).join('\n') : '• 待核实';
  const supplier = detail.supplier_signal;
  const supplierState = ({ confirmed: '已确认', public_lead: '公开线索' })[supplier?.confidence] || '未知';
  const supplierLine = supplier
    ? `${supplierState}｜${clip(supplier.supplier_name, 48)}｜${clip(supplier.supplied_category, 52)}\n来源：${clip(supplier.source_url, 110)}`
    : '未知｜尚无可靠公开关系证据';
  const strategy = detail.strategy_signal;
  const strategyLine = strategy
    ? `切入产品：${clip(strategy.entry_product, 60)}\n差异点：${clip(strategy.differentiation_angle, 70)}\n首轮目标：${clip(strategy.first_contact_goal, 70)}\n待确认：${clip((strategy.questions || []).join('；'), 90)}\n风险：${clip((strategy.risks || []).join('；'), 90)}`
    : `切入产品：${clip(formats, 60)}\n首轮目标：${clip(detail.next_action_cn, 70)}\n待确认：规格、用量和现有方案`;
  const elements = [md([
    `**${clip(detail.company_name, 60)}｜${clip(detail.country_code, 8)}｜${clip(detail.priority, 4)}**`,
    `阶段：${stageLabel(detail.stage_code)}`,
    `\n**为什么推荐**\n${clip(withoutQualification(detail.assessment_cn), 110)}\n规模信号：${clip(detail.scale_tier, 30)}`,
    `\n**产品结构**\n品类：${clip((detail.categories || []).join('、'), 70)}\n形式：${clip(formats, 70)}${signals.specifications.length ? `\n规格：${clip(signals.specifications.join('、'), 70)}` : ''}${signals.observations.length ? `\n公开信号：${clip(signals.observations.join('、'), 70)}` : ''}`,
    `\n**供应链线索**\n${supplierLine}`,
    `\n**开发策略**\n${strategyLine}`,
    `\n**公开来源**\n发现渠道：${clip(discovery.discovered_via, 60)}\n发现来源：${clip(discovery.discovery_url, 110)}\n官网：${clip(detail.official_url, 110)}\n证据：\n${evidenceLines}`,
    `联系方式：${contactLine}`,
    `建议下一步：${clip(detail.next_action_cn, 80)}`
  ].join('\n'))];
  const crmBase = String(process.env.MATRIX_CRM_DETAIL_BASE_URL || '').replace(/\/$/, '');
  elements.push(actions([
    button('返回列表', { a: 'mx.back', s: state.session.id, v: state.session.version }, 'default'),
    button('确认选择', { a: 'mx.select', s: state.session.id, v: state.session.version, c: detail.id, e: eventId(state.session, detail) }, 'primary'),
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

function actionKey(kind, ...values) {
  return crypto.createHash('sha256').update([kind, ...values].map(value => String(value ?? '')).join('\u0000')).digest('hex');
}

function versionAction(version, action, extra = {}) {
  return {
    a: action,
    w: Number(version.work_item_id),
    x: Number(version.id),
    v: Number(version.work_item_version),
    h: String(version.content_hash || ''),
    ...extra
  };
}

function renderVersionReview(version, cardHelpers) {
  const { card, md, note, actions, button } = cardHelpers;
  const quality = (() => { try { return JSON.parse(version.quality_json); } catch (_) { return null; } })();
  const score = Number.isFinite(Number(version.quality_score)) ? Number(version.quality_score) : Number(quality?.score || 0);
  return card([
    md(`**收件人**：${clip(version.recipient_email, 100)}\n**主题**：${clip(version.subject, 100)}\n**质量评分**：${score}/100`),
    md(`**英文草稿**\n${clip(version.body_en, 360)}`),
    md(`**中文翻译**\n${clip(version.body_cn, 280)}`),
    actions([
      button('确认采用', versionAction(version, 'mx.approve'), 'primary'),
      button('修改草稿', versionAction(version, 'mx.revise'), 'default'),
      button('暂不处理', versionAction(version, 'mx.review'), 'default')
    ]),
    note('尚未发送。确认采用仅记录审批，仍需打开最终预览并再次确认。')
  ], { header: { title: `草稿 v${Number(version.revision || 1)} 待审阅`, template: 'blue' }, summary: '草稿待审阅' });
}

function renderApproved(version, cardHelpers) {
  const { card, md, note, actions, button } = cardHelpers;
  return card([
    md(`**首次确认已记录**\n收件人：${clip(version.recipient_email, 100)}\n主题：${clip(version.subject, 100)}\n状态：尚未发送`),
    actions([
      button('查看最终预览', versionAction(version, 'mx.preview', { r: 0 }), 'primary'),
      button('修改草稿', versionAction(version, 'mx.revise'), 'default')
    ]),
    note('最终预览会重新展示质量与发送门禁；只有第二次确认才可能提交。')
  ], { header: { title: '已审批，等待最终确认', template: 'blue' }, summary: '等待最终确认' });
}

function reasonList(value) {
  const values = [
    ...(Array.isArray(value?.reasons) ? value.reasons : []),
    ...(Array.isArray(value?.hardFailures) ? value.hardFailures : []),
    ...(Array.isArray(value?.hard_failures) ? value.hard_failures : [])
  ].map(item => String(item || '').trim()).filter(Boolean);
  return [...new Set(values)];
}

const REASON_FIELDS = ['reasons', 'hardFailures', 'hard_failures'];

function strictReasonProjection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false, reasons: [] };
  const reasons = [];
  for (const key of REASON_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    if (!Array.isArray(value[key])) return { valid: false, reasons: [] };
    for (const item of value[key]) {
      if (typeof item !== 'string') return { valid: false, reasons: [] };
      const reason = item.trim();
      if (!reason || [...reason].length > 256 || /[\r\n\0]/.test(reason)) return { valid: false, reasons: [] };
      reasons.push(reason);
    }
  }
  return { valid: true, reasons: [...new Set(reasons)] };
}

function gateProjection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { state: 'unknown', reasons: [] };
  const reasonProjection = strictReasonProjection(value);
  if (value.ok === false) return { state: 'blocked', reasons: reasonProjection.valid ? reasonProjection.reasons : [] };
  if (!reasonProjection.valid) return { state: 'unknown', reasons: [] };
  if (reasonProjection.reasons.length) return { state: 'blocked', reasons: reasonProjection.reasons };
  if (value.ok === true) return { state: 'passed', reasons: [] };
  return { state: 'unknown', reasons: [] };
}

function renderFinalPreview(preview, cardHelpers, retry = 0) {
  const { card, md, note, actions, button } = cardHelpers;
  const version = preview?.version || {};
  const quality = preview?.quality || {};
  const components = Object.entries(quality.components || {}).slice(0, 8).map(([name, item]) => {
    const reasons = reasonList(item);
    return `${clip(name, 28)} ${Number(item?.points || 0)}/${Number(item?.maximum || 0)}${reasons.length ? `：${clip(reasons.join(','), 90)}` : ''}`;
  });
  const gateLine = (label, value) => {
    const projection = gateProjection(value);
    if (projection.state === 'unknown') return `${label}：提交时复核`;
    if (projection.state === 'blocked') return `${label}：阻断 ${clip(projection.reasons.join(',') || '未提供明确原因', 130)}`;
    return `${label}：通过`;
  };
  const requiredGates = [preview?.duplicate, preview?.cooling, preview?.quota, preview?.readiness, preview?.policy];
  const gatesPassed = requiredGates.every(value => gateProjection(value).state === 'passed');
  const topLevelReasons = strictReasonProjection(preview);
  const confirmAllowed = preview?.allowed === true && gatesPassed && topLevelReasons.valid && topLevelReasons.reasons.length === 0;
  const elements = [
    md(`**收件人**：${clip(version.recipient_email, 100)}\n**主题**：${clip(version.subject, 100)}\n**质量评分**：${Number(quality.score ?? version.quality_score ?? 0)}/100`),
    md(`**质量组成**\n${components.length ? components.join('\n') : '暂无组成明细'}\n${reasonList(quality).length ? `硬性原因：${clip(reasonList(quality).join(','), 130)}` : ''}`),
    md([
      gateLine('重复检查', preview.duplicate),
      gateLine('冷却期', preview.cooling),
      gateLine('当日配额', preview.quota),
      gateLine('发送方就绪', preview.readiness),
      gateLine('国家/渠道政策', preview.policy),
      ...(!topLevelReasons.valid
        ? ['最终状态：提交时复核']
        : topLevelReasons.reasons.length ? [`最终原因：${clip(topLevelReasons.reasons.join(','), 150)}`] : [])
    ].join('\n'))
  ];
  if (confirmAllowed) {
    const cardEventId = `mx-card-${actionKey('confirm-card', version.work_item_id, version.id, version.content_hash, retry).slice(0, 24)}`;
    elements.push(actions([button('确认发送', versionAction({ ...version, work_item_version: preview.work_item_version }, 'mx.confirm', { d: cardEventId, r: Number(retry || 0) }), 'primary')]));
    elements.push(note('第二次确认将提交当前不可变版本；重复点击使用同一幂等键。'));
  } else {
    elements.push(note('当前门禁未全部明确通过，未提供确认发送操作，也不会提交发送。'));
  }
  return card(elements, { header: { title: confirmAllowed ? '最终预览' : '最终预览已阻断', template: confirmAllowed ? 'blue' : 'red' }, summary: '最终预览' });
}

function renderDeliveryResult(result, versionValue, cardHelpers) {
  const { card, md, note, actions, button } = cardHelpers;
  if (result?.state === 'accepted') return card([
    md('**邮件服务器已接受**\n已记录一次受控提交结果。'),
    note('此状态表示服务器已接受，不展示服务器原始响应或消息标识。')
  ], { header: { title: '提交已接受', template: 'green' }, summary: '提交已接受' });
  if (result?.state === 'failed') return card([
    md('**明确失败**\n本次未被邮件服务器接受。'),
    actions([button('重新预览', { ...versionValue, a: 'mx.preview', r: Number(versionValue.r || 0) + 1 }, 'default')]),
    note('再次尝试前会重新打开最终预览，并使用新的人工确认幂等键。')
  ], { header: { title: '提交失败', template: 'red' }, summary: '提交失败' });
  if (result?.state === 'ambiguous') return card([
    md('**提交结果不明确**\n可能已被服务器接收，禁止自动或按钮重试。'),
    note('请人工核对后再处理；不展示原始服务器诊断。')
  ], { header: { title: '需要人工核对', template: 'orange' }, summary: '提交结果不明确' });
  throw new Error('invalid delivery result');
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
  const revisionContexts = new Map();
  const scheduleReminderPoll = context.scheduleReminderPoll || ((callback, delay) => setInterval(callback, delay));
  const clearReminderPoll = context.clearReminderPoll || (timer => clearInterval(timer));
  const logReminder = context.logReminder || (message => process.stderr.write(`${message}\n`));
  let reminderPollActive = false;
  const pollReminder = async () => {
    if (reminderPollActive) return;
    reminderPollActive = true;
    try {
      const result = await deliverQueuedReminder({
        channel, sendManagedCard,
        spoolPath: context.reminderSpoolPath || REMINDER_SPOOL_PATH,
        inflightPath: context.reminderInflightPath || REMINDER_INFLIGHT_PATH,
        receiptPath: context.reminderReceiptPath || REMINDER_RECEIPT_PATH,
        writeReceipt: context.writeReminderReceipt || writeReceiptAtomic,
        removeInflight: context.removeReminderInflight || (file => fs.unlinkSync(file))
      });
      if (result?.status === 'ambiguous') {
        logReminder(`[stream-card] reminder delivery ambiguous: ${result.id}; manual reconciliation required`);
      }
      await deliverQueuedReply({
        client, openId: process.env.MATRIX_OWNER_OPEN_ID,
        channel, sendManagedCard,
        spoolPath: context.replySpoolPath || REPLY_SPOOL_PATH,
        inflightPath: context.replyInflightPath || REPLY_INFLIGHT_PATH,
        expectedChatId: process.env.STREAM_CHAT_ID
      });
    } catch (error) {
      logReminder(`[stream-card] reminder delivery failed: ${error?.message || 'unknown error'}`);
    } finally {
      reminderPollActive = false;
    }
  };
  const reminderTimer = scheduleReminderPoll(pollReminder, Math.max(1000, Number(context.reminderPollMs || 5000)));
  reminderTimer.unref?.();
  let disposed = false;

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

  async function freshState(msg) {
    const openId = String(msg.senderId || '').trim();
    if (!openId) throw new Error('operator openId required');
    const recommendation = await client.today(openId, { page_size: 5 });
    const session = await client.createSession(openId, {
      chat_id: msg.chatId,
      thread_id: msg.threadId || '',
      filters: { page_size: 5 },
      snapshot_key: recommendation.rows?.length ? (recommendation.snapshot_key || '') : '',
      candidate_ids: (recommendation.rows || []).slice(0, 5).map(row => row.id),
      expires_at: new Date(clockMillis() + SESSION_TTL_MS).toISOString()
    });
    const state = {
      session,
      candidates: (recommendation.rows || []).slice(0, 5),
      snapshotKey: recommendation.rows?.length ? (recommendation.snapshot_key || '') : '',
      filters: { page_size: 5 }
    };
    sessions.set(sessionKey(msg.chatId, openId, msg.threadId), state);
    return state;
  }

  async function start(msg) {
    const state = await freshState(msg);
    await sendManagedCard(channel, msg.chatId, renderCandidates(state, cardHelpers), msg.messageId, Boolean(msg.threadId));
  }

  async function refreshSession(openId, state, chatId, threadId, expectedVersion, patch = {}) {
    const filters = patch.filters || state.filters;
    const page = patch.page || state.session.page;
    const session = await sessionBound(() => client.createSession(openId, {
      session_id: state.session.id,
      expected_version: expectedVersion,
      page,
      filters,
      snapshot_key: patch.snapshotKey === undefined ? state.snapshotKey : patch.snapshotKey,
      candidate_ids: (patch.candidates || state.candidates).map(row => row.id)
    }));
    if (String(session.chat_id) !== String(chatId || '') || String(session.thread_id || '') !== String(threadId || '')) {
      throw new Error('callback session context mismatch');
    }
    state.session = session;
    state.filters = filters;
    return session;
  }

  async function restoreState(openId, chatId, threadId, sessionId) {
    const session = await sessionBound(() => client.rehydrateSession(openId, {
      ...(sessionId ? { session_id: sessionId } : {}), chat_id: chatId, thread_id: threadId || ''
    }));
    if (String(session.chat_id) !== String(chatId || '') || String(session.thread_id || '') !== String(threadId || '')) throw new Error('callback session context mismatch');
    const state = { session, candidates: (session.candidates || []).slice(0, 5), snapshotKey: session.snapshot_key || '', filters: session.filters || {} };
    sessions.set(sessionKey(chatId, openId, threadId), state);
    return state;
  }

  async function stateForQuick(msg) {
    const openId = String(msg.senderId || '').trim();
    if (!openId) throw new Error('operator openId required');
    const key = sessionKey(msg.chatId, openId, msg.threadId);
    let state = sessions.get(key);
    if (state && stateExpired(state)) {
      sessions.delete(key);
      state = null;
    }
    if (!state) {
      try { state = await restoreState(openId, msg.chatId, msg.threadId, null); }
      catch (_) { state = null; }
    }
    if (state && stateExpired(state)) {
      sessions.delete(key);
      state = null;
    }
    return state || freshState(msg);
  }

  async function openQuick(msg, index) {
    const openId = String(msg.senderId || '').trim();
    const state = await stateForQuick(msg);
    const candidate = state.candidates[index];
    if (!candidate) {
      await sendManagedCard(channel, msg.chatId, renderCandidates(state, cardHelpers), msg.messageId, Boolean(msg.threadId));
      return;
    }
    const detail = await sessionBound(() => client.candidateDetail(openId, candidate.id, {
      session_id: state.session.id, chat_id: msg.chatId, thread_id: msg.threadId || ''
    }));
    await sendManagedCard(channel, msg.chatId, renderDetail(detail, state, cardHelpers, msg.chatId), msg.messageId, Boolean(msg.threadId));
  }

  async function sendForEvent(evt, card) {
    await sendManagedCard(channel, evt.chatId, card, evt.messageId, Boolean(evt.threadId));
  }

  async function callbackState(evt, value, { allowReplay = false } = {}) {
    const openId = String(evt?.operator?.openId || '').trim();
    if (!openId) throw new Error('operator openId required');
    const expectedVersion = Number(value?.v);
    const key = sessionKey(evt.chatId, openId, evt.threadId);
    let state = sessions.get(key);
    if (!state) state = await restoreState(openId, evt.chatId, evt.threadId, value?.s);
    if (!state || stateExpired(state) || Number(value?.s) !== Number(state.session.id)) {
      sessions.delete(key);
      const error = new Error('callback session expired');
      error.matrixSessionInvalid = true;
      throw error;
    }
    if (String(state.session.chat_id) !== String(evt.chatId || '') || String(state.session.thread_id || '') !== String(evt.threadId || '')) {
      throw new Error('callback session context mismatch');
    }
    if (expectedVersion !== Number(state.session.version) && !allowReplay) {
      throw new Error('callback stale version');
    }
    return { openId, state, expectedVersion };
  }

  async function detailAction({ evt, value }) {
    const { openId, state } = await callbackState(evt, value);
    const candidate = state.candidates.find(item => Number(item.id) === Number(value.c));
    if (!candidate) throw new Error('candidate not in active list');
    const detail = await sessionBound(() => client.candidateDetail(openId, candidate.id, { session_id: state.session.id, chat_id: evt.chatId, thread_id: evt.threadId || '' }));
    await sendForEvent(evt, renderDetail(detail, state, cardHelpers, evt.chatId));
  }

  async function filterAction({ evt, value }) {
    const { openId, state } = await callbackState(evt, value);
    const facets = await client.facets(openId);
    await sendForEvent(evt, renderFilters(facets, state, cardHelpers));
  }

  async function applyFilters({ evt, value }, kind) {
    const { openId, state, expectedVersion } = await callbackState(evt, value);
    const filters = { ...state.filters };
    if (kind === 'category') filters.category = String(value.k || '');
    else if (String(value.r || '').startsWith('country:')) filters.country = String(value.r).slice(8);
    else filters.region = String(value.r || '');
    delete filters.page;
    const result = await client.today(openId, { ...filters, page: 1, page_size: 5 });
    const candidates = (result.rows || []).slice(0, 5);
    const snapshotKey = candidates.length ? (result.snapshot_key || state.snapshotKey) : '';
    await refreshSession(openId, state, evt.chatId, evt.threadId, expectedVersion, { filters, page: 1, candidates, snapshotKey });
    state.candidates = candidates;
    state.snapshotKey = snapshotKey;
    await sendForEvent(evt, renderCandidates(state, cardHelpers));
  }

  async function pageAction({ evt, value }) {
    const { openId, state, expectedVersion } = await callbackState(evt, value);
    const page = Number(state.session.page || 1) + 1;
    const result = await client.today(openId, { ...state.filters, page, page_size: 5 });
    const candidates = (result.rows || []).slice(0, 5);
    const snapshotKey = result.snapshot_key || '';
    if (snapshotKey !== state.snapshotKey) {
      const error = new Error('recommendation snapshot changed');
      error.matrixSessionInvalid = true;
      throw error;
    }
    if (!candidates.length) {
      await sendForEvent(evt, infoCard(cardHelpers, '当前条件下没有更多合格候选。'));
      return;
    }
    await refreshSession(openId, state, evt.chatId, evt.threadId, expectedVersion, { page, candidates, snapshotKey });
    state.candidates = candidates;
    state.snapshotKey = snapshotKey;
    await sendForEvent(evt, renderCandidates(state, cardHelpers));
  }

  async function backAction({ evt, value }) {
    const { openId, state } = await callbackState(evt, value);
    await sendForEvent(evt, renderCandidates(state, cardHelpers));
  }

  async function selectAction({ evt, value }) {
    const { openId, state } = await callbackState(evt, value, { allowReplay: true });
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
    if (typeof client.createVersion !== 'function') throw new Error('version review service unavailable');
    const version = await client.createVersion(openId, result.work_item_id, {
      expected_work_version: 1,
      idempotency_key: `${key}:version`
    });
    await sendForEvent(evt, renderVersionReview(version, cardHelpers));
  }

  function reviewActionValue(evt, value) {
    const openId = String(evt?.operator?.openId || '').trim();
    const workItemId = Number(value?.w);
    const versionId = Number(value?.x);
    const expectedWorkVersion = Number(value?.v);
    const contentHash = String(value?.h || '').trim();
    if (!openId || !Number.isInteger(workItemId) || workItemId < 1
        || !Number.isInteger(versionId) || versionId < 1
        || !Number.isInteger(expectedWorkVersion) || expectedWorkVersion < 1
        || !/^[a-f0-9]{64}$/i.test(contentHash)) throw new Error('invalid review action');
    return { openId, workItemId, versionId, expectedWorkVersion, contentHash };
  }

  async function deferReviewAction({ evt, value }) {
    reviewActionValue(evt, value);
    revisionContexts.delete(sessionKey(evt.chatId, evt.operator.openId, evt.threadId));
    await sendForEvent(evt, infoCard(cardHelpers, '已暂不处理；尚未发送。需要时可从进行中项目重新打开。'));
  }

  async function reviseAction({ evt, value }) {
    const binding = reviewActionValue(evt, value);
    revisionContexts.set(sessionKey(evt.chatId, binding.openId, evt.threadId), {
      ...binding,
      expiresAt: clockMillis() + REVISION_TTL_MS
    });
    await sendForEvent(evt, cardHelpers.card([
      cardHelpers.md('请回复“修改：……”说明需要调整的内容。'),
      cardHelpers.note('编辑上下文仅绑定当前会话、操作者和话题，10 分钟后自动失效；回复“取消”可立即清理。')
    ], { header: { title: '等待修改说明', template: 'blue' }, summary: '等待修改说明' }));
  }

  async function approveAction({ evt, value }) {
    const binding = reviewActionValue(evt, value);
    revisionContexts.delete(sessionKey(evt.chatId, binding.openId, evt.threadId));
    if (typeof client.approveVersion !== 'function') throw new Error('approval service unavailable');
    const version = await client.approveVersion(binding.openId, binding.workItemId, binding.versionId, {
      expected_work_version: binding.expectedWorkVersion,
      expected_content_hash: binding.contentHash,
      idempotency_key: actionKey('approve', binding.openId, binding.workItemId, binding.versionId, binding.expectedWorkVersion, binding.contentHash)
    });
    await sendForEvent(evt, renderApproved(version, cardHelpers));
  }

  async function previewAction({ evt, value }) {
    const binding = reviewActionValue(evt, value);
    if (typeof client.versionPreview !== 'function') throw new Error('preview service unavailable');
    const preview = await client.versionPreview(binding.openId, binding.workItemId, binding.versionId);
    await sendForEvent(evt, renderFinalPreview(preview, cardHelpers, Number(value?.r || 0)));
  }

  async function confirmAction({ evt, value }) {
    const binding = reviewActionValue(evt, value);
    const cardEventId = String(value?.d || '').trim();
    const retry = Number(value?.r || 0);
    if (!cardEventId || cardEventId.length > 256 || /[\r\n\0]/.test(cardEventId)
        || !Number.isInteger(retry) || retry < 0) throw new Error('invalid final confirmation');
    if (typeof client.confirmSend !== 'function') throw new Error('confirmation service unavailable');
    const result = await client.confirmSend(binding.openId, binding.workItemId, binding.versionId, {
      expected_work_version: binding.expectedWorkVersion,
      expected_content_hash: binding.contentHash,
      chat_id: String(evt.chatId || ''),
      card_event_id: cardEventId,
      idempotency_key: actionKey('confirm', binding.openId, binding.workItemId, binding.versionId, binding.expectedWorkVersion, binding.contentHash, retry)
    });
    await sendForEvent(evt, renderDeliveryResult(result, value, cardHelpers));
  }

  async function workAction({ evt, value }) {
    const { openId, state } = await callbackState(evt, value);
    const result = await client.workItems(openId, {});
    await sendForEvent(evt, renderWorkItems(result.rows, cardHelpers));
  }

  async function todayAction({ evt }) {
    const openId = String(evt?.operator?.openId || '').trim();
    if (!openId) throw new Error('operator openId required');
    await start({ senderId: openId, chatId: evt.chatId, threadId: evt.threadId || '', messageId: evt.messageId });
  }

  async function quickAction({ evt, value }) {
    const index = Number(value?.i);
    if (!Number.isInteger(index) || index < 0 || index >= LETTERS.length) throw new Error('invalid quick choice');
    await openQuick({
      senderId: evt?.operator?.openId, chatId: evt?.chatId,
      threadId: evt?.threadId || '', messageId: evt?.messageId
    }, index);
  }

  async function replyDraftAction({ evt, value }) {
    const openId = String(evt?.operator?.openId || '').trim();
    const notificationId = Number(value?.n);
    if (!openId || !Number.isInteger(notificationId) || notificationId < 1) throw new Error('valid reply draft action required');
    if (typeof client.startReplyDraft !== 'function') throw new Error('reply draft service unavailable');
    const result = await client.startReplyDraft(openId, notificationId);
    if (!result || result.state !== 'draft_pending' || Number(result.notification_id) !== notificationId) {
      throw new Error('invalid reply draft result');
    }
    await sendForEvent(evt, cardHelpers.card([
      cardHelpers.md(`工作项 #${Number(result.work_item_id)} 已进入 **draft_pending**。`),
      cardHelpers.note('尚未发送；请继续人工审阅草稿。')
    ], { summary: '回复草稿待审阅' }));
  }

  async function retryTranslationAction({ evt, value }) {
    const openId = String(evt?.operator?.openId || '').trim();
    const notificationId = Number(value?.n);
    if (!openId || !Number.isInteger(notificationId) || notificationId < 1) throw new Error('valid translation retry action required');
    if (typeof client.retryTranslation !== 'function') throw new Error('translation retry service unavailable');
    const result = await client.retryTranslation(openId, notificationId);
    if (!result || Number(result.notification_id) !== notificationId
        || !['ready', 'pending'].includes(result.translation_status)) throw new Error('invalid translation retry result');
    await sendForEvent(evt, infoCard(cardHelpers,
      `translation_status=${result.translation_status}；${result.translation_status === 'ready' ? '请重新查看回复通知。' : '翻译仍待处理，未生成推测内容。'}`));
  }

  const actionHandlers = {
    'mx.today': todayAction,
    'mx.pick': detailAction,
    'mx.quick': quickAction,
    'mx.page': pageAction,
    'mx.detail': detailAction,
    'mx.back': backAction,
    'mx.select': selectAction,
    'mx.work': workAction,
    'mx.filters': filterAction,
    'mx.region': payload => applyFilters(payload, 'region'),
    'mx.category': payload => applyFilters(payload, 'category'),
    'mx.review': deferReviewAction,
    'mx.revise': reviseAction,
    'mx.approve': approveAction,
    'mx.preview': previewAction,
    'mx.confirm': confirmAction,
    'mx.reply_draft': replyDraftAction,
    'mx.retry_translation': retryTranslationAction
  };
  for (const action of ACTIONS) {
    dispatcher.on(action, async payload => {
      try {
        await actionHandlers[action](payload);
      } catch (error) {
        if (invalidSessionError(error)) {
          sessions.delete(sessionKey(payload.evt?.chatId, payload.evt?.operator?.openId, payload.evt?.threadId));
          await sendForEvent(payload.evt, restartCard(cardHelpers));
        } else {
          await sendForEvent(payload.evt, infoCard(cardHelpers, '操作未完成，请稍后重试。'));
        }
      }
    });
  }

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      clearReminderPoll(reminderTimer);
    },
    async onMessage({ msg }) {
      const text = String(msg?.content || '').trim();
      const revisionKey = sessionKey(msg?.chatId, msg?.senderId, msg?.threadId);
      const revision = revisionContexts.get(revisionKey);
      if (revision) {
        if (revision.expiresAt <= clockMillis()) {
          revisionContexts.delete(revisionKey);
        } else if (text === '取消') {
          revisionContexts.delete(revisionKey);
          await sendManagedCard(channel, msg.chatId, infoCard(cardHelpers, '已取消修改并清理编辑上下文；尚未发送。'), msg.messageId, Boolean(msg.threadId));
          return true;
        } else if (text.startsWith('修改：')) {
          const instruction = text.slice('修改：'.length).trim();
          if (!instruction) {
            await sendManagedCard(channel, msg.chatId, infoCard(cardHelpers, '修改说明不能为空，请回复“修改：……”或“取消”。'), msg.messageId, Boolean(msg.threadId));
            return true;
          }
          if (typeof client.reviseVersion !== 'function') throw new Error('revision service unavailable');
          const version = await client.reviseVersion(revision.openId, revision.workItemId, {
            expected_work_version: revision.expectedWorkVersion,
            base_version_id: revision.versionId,
            revision_instruction: instruction,
            idempotency_key: actionKey('revise', revision.openId, revision.workItemId, revision.versionId, revision.expectedWorkVersion, instruction)
          });
          revisionContexts.delete(revisionKey);
          await sendManagedCard(channel, msg.chatId, renderVersionReview(version, cardHelpers), msg.messageId, Boolean(msg.threadId));
          return true;
        }
      }
      if (text === '开发客户') {
        await start(msg);
        return true;
      }
      const quickIndex = parseQuickChoice(text);
      if (quickIndex !== null) {
        try {
          await openQuick(msg, quickIndex);
        } catch (error) {
          if (!invalidSessionError(error)) throw error;
          sessions.delete(sessionKey(msg?.chatId, msg?.senderId, msg?.threadId));
          await sendManagedCard(channel, msg.chatId, restartCard(cardHelpers), msg.messageId, Boolean(msg.threadId));
        }
        return true;
      }
      return false;
    }
  };
}

module.exports = { register, deliverQueuedReminder, deliverQueuedReply, parseQuickChoice };

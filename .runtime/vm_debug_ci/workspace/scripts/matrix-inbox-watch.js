#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const BASE_URL = 'https://open.feishu.cn/open-apis';
const DEFAULT_BRIDGE_ROOT = '/home/node/.feishu-codex-bridge';
const DEFAULT_ATTACHMENT_ROOT = '/refs/matrix-inbox-attachments';
const DEFAULT_STATE_PATH = '/workspace/store/matrix-inbox-watch-state.json';

function value(input, fallback = '-') {
  const result = String(input == null || input === '' ? fallback : input).trim();
  return result || fallback;
}

function clip(input, maximum = 500) {
  const points = [...value(input)];
  return points.length > maximum ? `${points.slice(0, maximum - 1).join('')}…` : points.join('');
}

const CLASS_LABELS = Object.freeze({
  quote_request: '客户询价', customer_reply: '客户回复', sample_request: '样品请求',
  technical_question: '技术问题', logistics_question: '运输/交付问题', payment_question: '付款问题',
  delivery_notice: '快递/物流通知', supplier_service: '供应商服务', advertising: '广告', system_notice: '系统通知'
});

function translationBlocks(lines) {
  const input = Array.isArray(lines) ? lines.filter(Boolean).map(String) : [];
  if (!input.length) return [{ tag: 'div', text: { tag: 'lark_md', content: '**逐段中文翻译**\n翻译处理中，完成前不会把本邮件标记为已处理。' } }];
  const blocks = [];
  let current = '';
  for (const line of input) {
    const next = `${current ? `${current}\n` : ''}• ${line}`;
    if (next.length > 2500 && current) { blocks.push(current); current = `• ${line}`; }
    else current = next;
  }
  if (current) blocks.push(current);
  return blocks.map((content, index) => ({
    tag: 'div', text: { tag: 'lark_md', content: `**逐段中文翻译${blocks.length > 1 ? `（${index + 1}/${blocks.length}）` : ''}**\n${content}` }
  }));
}

function resolveProjectChatId({ appId, projectName, bridgeRoot = DEFAULT_BRIDGE_ROOT }) {
  const projectsPath = path.join(bridgeRoot, 'bots', String(appId || ''), 'projects.json');
  const parsed = JSON.parse(fs.readFileSync(projectsPath, 'utf8'));
  const projects = Array.isArray(parsed) ? parsed : parsed.projects;
  if (!Array.isArray(projects)) throw new Error('invalid bot projects registry');
  const matches = projects.filter(project => project?.name === projectName && project?.chatId);
  if (matches.length === 0) throw new Error(`project not found: ${projectName}`);
  if (matches.length > 1) throw new Error(`multiple projects found: ${projectName}`);
  return matches[0].chatId;
}

function buildInboxCard(job) {
  const analysis = job?.analysis || {};
  const attachmentCount = Array.isArray(job?.attachments) ? job.attachments.length : 0;
  const warningCount = (job?.attachments || []).filter(item => item.availability_state !== 'available').length;
  const messageClass = value(analysis.message_class || job.message_class, 'customer_reply');
  const missing = Array.isArray(analysis.missing_information) ? analysis.missing_information.filter(Boolean) : [];
  const quoteAction = messageClass === 'quote_request' || job.workflow_state === 'quote_required';
  return {
    config: { wide_screen_mode: true },
    header: {
      template: warningCount ? 'orange' : 'blue',
      title: { tag: 'plain_text', content: '新邮件回复' }
    },
    elements: [
      {
        tag: 'div',
        fields: [
          { is_short: true, text: { tag: 'lark_md', content: `**客户/公司**\n${clip(job.customer_name || '待关联', 80)}` } },
          { is_short: true, text: { tag: 'lark_md', content: `**国家**\n${clip(job.customer_country || '待核实', 40)}` } },
          { is_short: true, text: { tag: 'lark_md', content: `**联系人**\n${clip(job.sender_name || job.sender_email, 80)}` } },
          { is_short: true, text: { tag: 'lark_md', content: `**收到时间**\n${clip(job.received_at, 40)}` } }
        ]
      },
      { tag: 'div', fields: [
        { is_short: true, text: { tag: 'lark_md', content: `**邮件类型**\n${CLASS_LABELS[messageClass] || messageClass}` } },
        { is_short: true, text: { tag: 'lark_md', content: `**处理队列**\n${clip(job.workflow_state || '待判断', 60)}` } }
      ] },
      { tag: 'div', text: { tag: 'lark_md', content: `**主题**\n${clip(job.subject, 300)}` } },
      { tag: 'hr' },
      ...translationBlocks(analysis.line_translation_cn),
      { tag: 'div', text: { tag: 'lark_md', content: `**英文原文（核对）**\n${clip(job.original_preview, 1800)}` } },
      { tag: 'div', text: { tag: 'lark_md', content: `**中文摘要**\n${clip(analysis.summary_cn || (job.analysis_state === 'failed' ? '分析暂不可用，邮件已经保存。' : '分析处理中'), 500)}` } },
      { tag: 'div', text: { tag: 'lark_md', content: `**缺少信息**\n${missing.length ? missing.join('、') : '无；可以进入内部复核'}` } },
      { tag: 'div', text: { tag: 'lark_md', content: `**关联状态**\n${clip(job.correlation_state, 40)}${job.inquiry_title ? `｜${clip(job.inquiry_title, 100)}` : ''}` } },
      { tag: 'div', text: { tag: 'lark_md', content: `**建议下一步**\n${clip(analysis.suggested_next_action_cn || '查看完整邮件和附件后决定下一步。', 300)}` } },
      { tag: 'div', text: { tag: 'lark_md', content: `**附件**\n${attachmentCount} 个${warningCount ? `｜${warningCount} 个需要人工检查` : '｜图片/文件将在本卡下方发送'}` } },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content: quoteAction
        ? '**主管动作**\n已建立报价待办；可 @智能桓 回复“处理这封报价”。价格与回信仍需确认。'
        : '**主管动作**\n可 @智能桓 回复“生成建议回复”。确认正文后才允许对外发送。' } },
      { tag: 'note', elements: [{ tag: 'plain_text', content: '是否归档：仅在待办完成后确认；归档只标记本邮件已处理，不影响客户档案。' }] }
    ]
  };
}

function shanghaiDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shanghaiHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false }).format(now));
}

function shouldSendDailyWorkbench(now = new Date(), lastDate = '') {
  return shanghaiHour(now) >= 9 && shanghaiDate(now) !== String(lastDate || '');
}

function buildWorkbenchCard(workbench) {
  const counts = workbench?.counts || {};
  const items = Array.isArray(workbench?.items) ? workbench.items.slice(0, 12) : [];
  const itemElements = items.length ? items.flatMap((item, index) => [{
    tag: 'div', text: { tag: 'lark_md', content: [
      `**${index + 1}. ${value(item.customer_name, '待关联客户')}**`,
      `国家/地区：${value(item.country, '待核实')}｜优先级：${value(item.priority, 'C')}`,
      `状态：${({
        all_item_prices_recorded_pending_forwarder_and_final_review: '六项价格已齐，待货代与最终复核',
        blocked_missing_authoritative_spec_and_cost_basis: '缺权威规格与成本依据',
        quote_in_progress: '核价进行中', quote_required: '待建立报价', awaiting_our_reply: '客户已回复，待我方处理',
        first_contact_unanswered: '首次来信，尚未回复', waiting_customer: '我方已回复，等待客户',
        outreach_waiting: '已外联，等待回复', archive_review: '待确认归档'
      })[item.state] || value(item.state, '待判断')}`,
      item.message_count ? `往来：共 ${item.message_count} 封｜收 ${item.inbound_count}｜发 ${item.outbound_count}｜最近收件 ${value(item.last_inbound_at)}` : '',
      item.background_state ? `背景：${item.background_state === 'researched' ? '已核验' : item.background_state === 'profile_available' ? '已有档案' : item.background_state === 'official_source_identified' ? '已找到官网，待深读' : '待调查'}` : '',
      item.website_hint ? `公开入口：[打开官网](${item.website_hint})` : '',
      `中文摘要：${value(item.summary_cn, '等待完整中文分析')}`,
      `下一步：${Array.isArray(item.next_actions) ? item.next_actions.join('；') : value(item.next_action_cn || item.suggested_next_action_cn, '人工检查')}`
    ].filter(Boolean).join('\n') }
  }, ...(index < items.length - 1 ? [{ tag: 'hr' }] : [])]) : [{ tag: 'div', text: { tag: 'lark_md', content: '当前没有未完成邮件待办。' } }];
  return {
    config: { wide_screen_mode: true },
    header: { template: Number(counts.quote_review || 0) > 0 ? 'orange' : 'green', title: { tag: 'plain_text', content: `${shanghaiDate()} 邮件主管总览` } },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: `**重点事项 ${Number(counts.active_supervisor || 0)}｜待回复 ${Number(counts.reply_review || 0)}｜待报价 ${Number(counts.quote_review || 0)}｜等客户 ${Number(counts.waiting_customer || 0)}｜外联等待 ${Number(counts.outreach_waiting || 0)}｜待归档 ${Number(counts.archive_review || 0)}**` } },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content: '**优先处理（最多 12 条）**' } },
      ...itemElements,
      { tag: 'note', elements: [{ tag: 'plain_text', content: '广告和 7 月前历史邮件已过滤；报价与回信必须确认后才能对外发送。' }] }
    ]
  };
}

function loadState(statePath = DEFAULT_STATE_PATH) {
  try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (_) { return {}; }
}

function saveState(state, statePath = DEFAULT_STATE_PATH) {
  const temporary = `${statePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, statePath);
}

function dailyUuid(date) {
  const hex = crypto.createHash('sha256').update(`matrix-inbox-workbench:${date}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function resolveAttachment(attachment, attachmentRoot) {
  const storageKey = String(attachment?.storage_key || '');
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}\/\d+$/i.test(storageKey)) {
    const error = new Error('invalid attachment storage key');
    error.code = 'attachment_integrity';
    throw error;
  }
  const root = fs.realpathSync(attachmentRoot);
  const expected = path.resolve(root, storageKey);
  let actual;
  try { actual = fs.realpathSync(expected); }
  catch (_) {
    const error = new Error('attachment unavailable');
    error.code = 'attachment_unavailable';
    throw error;
  }
  if (!actual.startsWith(`${root}${path.sep}`)) {
    const error = new Error('attachment escapes private root');
    error.code = 'attachment_integrity';
    throw error;
  }
  const stat = fs.statSync(actual);
  if (!stat.isFile() || stat.size !== Number(attachment.file_size)) {
    const error = new Error('attachment size mismatch');
    error.code = 'attachment_integrity';
    throw error;
  }
  const digest = crypto.createHash('sha256').update(fs.readFileSync(actual)).digest('hex');
  if (digest !== attachment.sha256) {
    const error = new Error('attachment digest mismatch');
    error.code = 'attachment_integrity';
    throw error;
  }
  return actual;
}

async function runOne({ client, openId, chatId, attachmentRoot = DEFAULT_ATTACHMENT_ROOT, deliverCard, deliverAttachment }) {
  const claimed = await client.claimInboxJob(openId);
  const job = claimed?.job || null;
  if (!job) return { status: 'idle' };
  try {
    const cardMessageId = await deliverCard(chatId, buildInboxCard(job), job.notification_uuid);
    for (const attachment of job.attachments || []) {
      if (attachment.availability_state !== 'available') continue;
      const absolutePath = resolveAttachment(attachment, attachmentRoot);
      await deliverAttachment({
        chatId,
        replyTo: cardMessageId,
        absolutePath,
        filename: attachment.original_file_name,
        mimeType: attachment.detected_mime_type
      });
    }
    await client.ackInboxJob(openId, job.id, {
      lease_token: job.lease_token,
      notification_uuid: job.notification_uuid,
      status: 'delivered'
    });
    return { status: 'delivered', job_id: job.id };
  } catch (error) {
    const errorCode = ['attachment_integrity', 'attachment_unavailable'].includes(error?.code)
      ? error.code
      : error?.code === 'feishu_rate_limited' ? 'feishu_rate_limited' : 'delivery_failed';
    await client.failInboxJob(openId, job.id, { lease_token: job.lease_token, error_code: errorCode });
    return { status: 'failed', job_id: job.id, error_code: errorCode };
  }
}

function readAppSecret(appId) {
  const id = `app-${appId}`;
  const output = execFileSync('feishu-codex-bridge', ['secrets', 'get'], {
    input: JSON.stringify({ ids: [id] }), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
  });
  const secret = JSON.parse(output).values?.[id];
  if (!secret) throw new Error('app secret unavailable');
  return secret;
}

async function tenantToken(appId) {
  const response = await fetch(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: appId, app_secret: readAppSecret(appId) })
  });
  const body = await response.json();
  if (!response.ok || body.code !== 0 || !body.tenant_access_token) throw new Error('tenant token unavailable');
  return body.tenant_access_token;
}

async function apiJson(url, token, options) {
  const response = await fetch(url, {
    ...options,
    headers: { authorization: `Bearer ${token}`, ...(options?.headers || {}) }
  });
  const body = await response.json();
  if (!response.ok || body.code !== 0) {
    const error = new Error('Feishu API request failed');
    if (response.status === 429 || body.code === 99991400) error.code = 'feishu_rate_limited';
    throw error;
  }
  return body;
}

async function deliverCard(appId, chatId, card, uuid) {
  const token = await tenantToken(appId);
  const body = await apiJson(`${BASE_URL}/im/v1/messages?receive_id_type=chat_id`, token, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ receive_id: chatId, msg_type: 'interactive', content: JSON.stringify(card), uuid })
  });
  return body.data?.message_id || '';
}

async function uploadAttachment(appId, { replyTo, absolutePath, filename, mimeType }) {
  const token = await tenantToken(appId);
  const bytes = fs.readFileSync(absolutePath);
  const isImage = String(mimeType || '').startsWith('image/');
  const form = new FormData();
  if (isImage) {
    form.append('image_type', 'message');
    form.append('image', new Blob([bytes], { type: mimeType }), filename);
  } else {
    form.append('file_type', 'stream');
    form.append('file_name', filename);
    form.append('file', new Blob([bytes], { type: mimeType || 'application/octet-stream' }), filename);
  }
  const uploaded = await apiJson(`${BASE_URL}/im/v1/${isImage ? 'images' : 'files'}`, token, { method: 'POST', body: form });
  const key = isImage ? uploaded.data?.image_key : uploaded.data?.file_key;
  if (!key) throw new Error('Feishu upload key unavailable');
  const content = isImage ? { image_key: key } : { file_key: key };
  await apiJson(`${BASE_URL}/im/v1/messages/${encodeURIComponent(replyTo)}/reply`, token, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ msg_type: isImage ? 'image' : 'file', content: JSON.stringify(content) })
  });
}

async function main() {
  const appId = String(process.env.STREAM_APP_ID || '');
  const openId = String(process.env.MATRIX_OWNER_OPEN_ID || '');
  if (!appId || !openId) throw new Error('inbox relay environment incomplete');
  const chatId = resolveProjectChatId({ appId, projectName: 'build' });
  const client = require('./matrix-client.js');
  const pollMs = Math.max(15000, Number(process.env.MATRIX_INBOX_RELAY_POLL_MS || 60000));
  const statePath = process.env.MATRIX_INBOX_RELAY_STATE_PATH || DEFAULT_STATE_PATH;
  const instantEnabled = process.env.MATRIX_INBOX_INSTANT_ENABLED === '1';
  const dailyWorkbenchEnabled = process.env.MATRIX_INBOX_DAILY_WORKBENCH_ENABLED === '1';
  while (true) {
    const result = instantEnabled ? await runOne({
      client, openId, chatId,
      attachmentRoot: process.env.MATRIX_INBOX_ATTACHMENT_ROOT || DEFAULT_ATTACHMENT_ROOT,
      deliverCard: (target, card, uuid) => deliverCard(appId, target, card, uuid),
      deliverAttachment: input => uploadAttachment(appId, input)
    }) : { status: 'idle' };
    if (result.status === 'delivered') process.stdout.write(`[matrix-inbox] delivered job #${result.job_id}\n`);
    if (result.status === 'failed') process.stderr.write(`[matrix-inbox] job #${result.job_id} failed: ${result.error_code}\n`);
    const state = loadState(statePath);
    const current = new Date();
    if (dailyWorkbenchEnabled && shouldSendDailyWorkbench(current, state.last_workbench_date)) {
      const workbench = await client.inboxWorkbench(openId);
      if (workbench.overall_ready !== true) {
        process.stdout.write(`[matrix-inbox] daily workbench held: ${Number(workbench.incomplete_count || 0)} incomplete\n`);
        await new Promise(resolve => setTimeout(resolve, pollMs));
        continue;
      }
      const date = shanghaiDate(current);
      await deliverCard(appId, chatId, buildWorkbenchCard(workbench), dailyUuid(date));
      saveState({ ...state, last_workbench_date: date }, statePath);
      process.stdout.write(`[matrix-inbox] delivered daily workbench ${date}\n`);
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`[matrix-inbox] fatal: ${error?.code || error?.name || 'error'}\n`);
  process.exit(1);
});

module.exports = {
  resolveProjectChatId,
  buildInboxCard,
  resolveAttachment,
  runOne,
  deliverCard,
  uploadAttachment,
  buildWorkbenchCard,
  shanghaiDate,
  shouldSendDailyWorkbench
};

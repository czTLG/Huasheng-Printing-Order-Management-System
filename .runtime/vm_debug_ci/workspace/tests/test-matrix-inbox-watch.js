'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const watcher = require('../scripts/matrix-inbox-watch.js');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-inbox-watch-'));
  try {
    const bridgeRoot = path.join(root, 'bridge');
    const botDir = path.join(bridgeRoot, 'bots', 'app-test');
    fs.mkdirSync(botDir, { recursive: true });
    fs.writeFileSync(path.join(botDir, 'projects.json'), JSON.stringify({
      version: 1,
      projects: [
        { name: 'vm_debug_ci', chatId: 'vm-chat' },
        { name: 'build', chatId: 'build-chat' }
      ]
    }));
    assert.strictEqual(watcher.resolveProjectChatId({ appId: 'app-test', projectName: 'build', bridgeRoot }), 'build-chat');
    fs.writeFileSync(path.join(botDir, 'projects.json'), JSON.stringify({ version: 1, projects: [{ name: 'vm_debug_ci', chatId: 'vm-chat' }] }));
    assert.throws(() => watcher.resolveProjectChatId({ appId: 'app-test', projectName: 'build', bridgeRoot }), /project not found/);
    fs.writeFileSync(path.join(botDir, 'projects.json'), JSON.stringify({ version: 1, projects: [{ name: 'build', chatId: 'one' }, { name: 'build', chatId: 'two' }] }));
    assert.throws(() => watcher.resolveProjectChatId({ appId: 'app-test', projectName: 'build', bridgeRoot }), /multiple projects/);

    const attachmentRoot = path.join(root, 'attachments');
    const storageKey = '11111111-1111-4111-8111-111111111111/0';
    const absolute = path.join(attachmentRoot, storageKey);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    const content = Buffer.from('fixture-image');
    fs.writeFileSync(absolute, content);
    const job = {
      id: 7,
      notification_uuid: '11111111-1111-5111-8111-111111111111',
      lease_token: 'lease-7',
      customer_name: 'Fixture Ltd.',
      customer_country: 'Vietnam',
      sender_name: 'Buyer',
      sender_email: 'buyer@example.test',
      subject: 'Re: Product request',
      received_at: '2026-07-19T02:00:00.000Z',
      original_preview: 'Please see our product image.',
      correlation_state: 'exact_header',
      analysis_state: 'ready',
      analysis: {
        message_class: 'quote_request',
        summary_cn: '客户发送了产品图片并要求复核。',
        line_translation_cn: ['客户请求报价｜原文：Please quote this pouch.', '提到附件图片｜原文：See attached image.'],
        missing_information: ['袋子尺寸'],
        suggested_next_action_cn: '查看图片并确认规格。',
        suggested_customer_reply_en: 'Thank you. We will review the product image.'
      },
      attachments: [{
        attachment_id: 1,
        storage_key: storageKey,
        original_file_name: 'product.png',
        detected_mime_type: 'image/png',
        file_size: content.length,
        sha256: crypto.createHash('sha256').update(content).digest('hex'),
        availability_state: 'available',
        quarantine_reason: ''
      }]
    };
    const cardText = JSON.stringify(watcher.buildInboxCard(job));
    for (const expected of ['新邮件回复', 'Fixture Ltd.', '邮件类型', '询价', '逐段中文翻译', '客户请求报价', '缺少信息', '袋子尺寸', '中文摘要', '客户发送了产品图片', '建立报价待办', '是否归档']) {
      assert.match(cardText, new RegExp(expected));
    }
    const workbenchText = JSON.stringify(watcher.buildWorkbenchCard({
      counts: { reply_review: 2, quote_review: 1, missing_information: 3, archive_review: 1 },
      items: [{ state: 'quote_required', customer_name: 'Fixture Ltd.', country: 'Singapore', summary_cn: '客户请求报价。', next_action_cn: '建立内部核价。' }]
    }));
    for (const expected of ['主管总览', '待回复', '待报价', '等客户', '待归档', 'Singapore', '客户请求报价']) assert.match(workbenchText, new RegExp(expected));
    assert.strictEqual(watcher.shouldSendDailyWorkbench(new Date('2026-07-19T01:11:00.000Z'), ''), true);
    assert.strictEqual(watcher.shouldSendDailyWorkbench(new Date('2026-07-19T01:11:00.000Z'), '2026-07-19'), false);

    const sentCards = [];
    const sentAttachments = [];
    const ackCalls = [];
    const failCalls = [];
    const client = {
      claimInboxJob: async () => ({ ok: true, job }),
      ackInboxJob: async (...args) => { ackCalls.push(args); return { ok: true }; },
      failInboxJob: async (...args) => { failCalls.push(args); return { ok: true }; }
    };
    const result = await watcher.runOne({
      client,
      openId: 'owner',
      chatId: 'build-chat',
      attachmentRoot,
      deliverCard: async (chatId, card, uuid) => { sentCards.push({ chatId, card, uuid }); return 'card-message'; },
      deliverAttachment: async input => { sentAttachments.push(input); return 'attachment-message'; }
    });
    assert.strictEqual(result.status, 'delivered');
    assert.strictEqual(sentCards[0].chatId, 'build-chat');
    assert.strictEqual(sentAttachments[0].replyTo, 'card-message');
    assert.strictEqual(ackCalls.length, 1);
    assert.strictEqual(failCalls.length, 0);

    const badJob = { ...job, id: 8, lease_token: 'lease-8', attachments: [{ ...job.attachments[0], sha256: '0'.repeat(64) }] };
    const badFails = [];
    const badResult = await watcher.runOne({
      client: {
        claimInboxJob: async () => ({ ok: true, job: badJob }),
        ackInboxJob: async () => { throw new Error('must not ack'); },
        failInboxJob: async (...args) => { badFails.push(args); return { ok: true }; }
      },
      openId: 'owner', chatId: 'build-chat', attachmentRoot,
      deliverCard: async () => 'card-message',
      deliverAttachment: async () => 'attachment-message'
    });
    assert.strictEqual(badResult.status, 'failed');
    assert.strictEqual(badFails[0][2].error_code, 'attachment_integrity');

    console.log('PASS matrix inbox watch');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

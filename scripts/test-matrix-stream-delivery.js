'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-stream-delivery-'));
process.env.DB_PATH = path.join(root, 'app.db');

const { db, initDb } = require('../src/db');
const review = require('../src/services/matrixStreamReview');
const { createMatrixStreamDelivery } = require('../src/services/matrixStreamDelivery');

initDb();

const NOW = '2026-07-18T01:00:00.000Z';
const senderId = 701;

function seedApprovedFixture(index = 1, { lowQuality = false } = {}) {
  db.prepare(`
    INSERT INTO users (id, username, password, role, status, permissions_json, created_at)
    VALUES (?, ?, 'test-only', 'foreign_trade_crm_admin', 'active', ?, ?)
  `).run(senderId + index - 1, `matrix-delivery-${index}`, JSON.stringify({ modules: { crm: true }, capabilities: { matrixSend: true } }), NOW);
  const actorUserId = senderId + index - 1;
  const bindingId = Number(db.prepare(`
    INSERT INTO matrix_actor_bindings (feishu_open_id, user_id, status, bound_by, bound_at)
    VALUES (?, ?, 'active', ?, ?)
  `).run(`ou-delivery-${index}`, actorUserId, actorUserId, NOW).lastInsertRowid);
  const workItemId = Number(db.prepare(`
    INSERT INTO matrix_work_items (
      candidate_id, stage, owner_user_id, current_summary, next_action,
      version, created_at, updated_at, stream_state
    ) VALUES (?, 'selected', ?, '', '', 1, ?, ?, 'selected')
  `).run(9000 + index, actorUserId, NOW, NOW).lastInsertRowid);

  const organization = index === 1 ? 'alpha' : `alpha${index}`;
  const organizationDomain = `${organization}.test`;
  const company = index === 1 ? 'Alpha Coffee' : `Alpha ${index} Coffee`;

  const recipient = {
    email: `sales@${organizationDomain}`,
    sourceUrl: `https://${organizationDomain}/contact`,
    verifiedAt: '2026-07-17T00:00:00.000Z',
    kind: 'public_company'
  };
  const sourceSnapshot = {
    organization_domain: organizationDomain,
    recipient_email: recipient.email,
    source_url: recipient.sourceUrl,
    country_code: 'VN',
    company,
    categories: ['coffee'],
    products: ['250g roasted coffee', '500g roasted coffee'],
    entryProduct: 'high-barrier valve pouch',
    supportedClaims: ['stable repeat printing'],
    evidenceIds: [11, 12]
  };
  db.prepare(`
    INSERT INTO matrix_stream_recipient_evidence (
      work_item_id, organization_domain, recipient_email, source_url, verified_at,
      snapshot_json, status, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(workItemId, organizationDomain, recipient.email, recipient.sourceUrl, recipient.verifiedAt,
    JSON.stringify(sourceSnapshot), actorUserId, NOW);

  const approvedBody = lowQuality ? 'Hello' : `Dear ${company} team,\nWe reviewed your 250g and 500g roasted coffee range. We would like to discuss high-barrier valve pouches with stable repeat printing. Could you share your current structure and annual volume?\nBest regards`;
  const created = review.createInitialVersion(db, {
    actorUserId,
    workItemId,
    expectedWorkVersion: 1,
    recipient,
    subject: lowQuality ? 'Hello' : `250g and 500g coffee pouch options for ${company}`,
    bodyEn: approvedBody,
    bodyCn: lowQuality ? '你好' : '您好，我们查看了贵司250g和500g烘焙咖啡产品，希望沟通高阻隔带阀袋及稳定套色。请问当前材料结构和年用量？',
    strategySummary: 'official evidence reviewed',
    sourceSnapshot,
    idempotencyKey: `delivery-version-create-${index}`
  });
  const version = review.approveVersion(db, {
    actorUserId,
    workItemId,
    versionId: created.id,
    expectedWorkVersion: 2,
    expectedContentHash: created.content_hash,
    idempotencyKey: `delivery-version-approve-${index}`
  });

  db.prepare(`
    INSERT OR IGNORE INTO matrix_stream_sender_checks (
      sender_domain, checked_at, expires_at, spf_ok, dkim_ok, dmarc_ok,
      tls_ok, smtp_ok, detail_json
    ) VALUES ('sender.test', '2026-07-18T00:00:00.000Z', '2026-07-19T00:00:00.000Z', 1, 1, 1, 1, 1, '{}')
  `).run();
  db.prepare(`
    INSERT OR REPLACE INTO matrix_stream_country_policies (
      country_code, channel, status, sender_identity_required, opt_out_required,
      reviewed_by, reviewed_at, expires_at, source_urls_json
    ) VALUES ('VN', 'email', 'approved', 1, 1, ?, '2026-07-17T00:00:00.000Z',
      '2026-08-17T00:00:00.000Z', '["https://authority.test/policy"]')
  `).run(actorUserId);
  return { actorUserId, bindingId, workItemId, version, approvedBody };
}

function confirmationInput(fixture, key) {
  return {
    actorUserId: fixture.actorUserId,
    bindingId: fixture.bindingId,
    workItemId: fixture.workItemId,
    versionId: fixture.version.id,
    expectedWorkVersion: 3,
    expectedContentHash: fixture.version.content_hash,
    chatId: `chat-${key}`,
    cardEventId: `card-${key}`,
    idempotencyKey: key
  };
}

(async () => {
  try {
    const fixture = seedApprovedFixture();
    const accepted = [];
    const service = createMatrixStreamDelivery({
      db,
      fromAddress: 'sales@sender.test',
      messageIdDomain: 'sender.test',
      clock: () => new Date(NOW),
      transport: {
        sendMail: async mail => {
          accepted.push(mail);
          return { accepted: [mail.to], rejected: [], messageId: mail.messageId };
        }
      }
    });
    const input = confirmationInput(fixture, 'send-1');
    const result = await service.confirm(input);
    assert.strictEqual(result.state, 'accepted');
    assert.strictEqual(accepted.length, 1);
    assert.deepStrictEqual(Object.keys(accepted[0]).sort(), ['from', 'headers', 'messageId', 'subject', 'text', 'to'].sort());
    assert.strictEqual(accepted[0].from, 'sales@sender.test');
    assert.strictEqual(accepted[0].to, 'sales@alpha.test');
    assert.strictEqual(accepted[0].subject, fixture.version.subject);
    assert.strictEqual(accepted[0].text, fixture.approvedBody);
    assert.match(accepted[0].messageId, /^<matrix-stream-/);
    assert.deepStrictEqual(accepted[0].headers, { 'X-Matrix-Stream-Version': String(fixture.version.id) });
    assert.deepStrictEqual(await service.confirm(input), result);
    assert.strictEqual(accepted.length, 1);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM matrix_stream_reply_checks').get().count, 1);
    assert.ok(!JSON.stringify(result).includes(accepted[0].messageId));
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM matrix_stream_events').all()).includes(accepted[0].messageId));

    const failedFixture = seedApprovedFixture(2);
    let failedCalls = 0;
    const failedService = createMatrixStreamDelivery({
      db, fromAddress: 'sales@sender.test', messageIdDomain: 'sender.test', clock: () => new Date(NOW),
      transport: {
        sendMail: async mail => {
          failedCalls += 1;
          if (failedCalls === 1) {
            const error = new Error('550 raw server detail SMTP_PASS=secret');
            error.responseCode = 550;
            throw error;
          }
          return { accepted: [mail.to], rejected: [] };
        }
      }
    });
    const failed = await failedService.confirm(confirmationInput(failedFixture, 'send-failed-1'));
    assert.deepStrictEqual(failed, { state: 'failed', error_class: 'recipient_rejected', work_item_version: 3 });
    const deliberateRetry = await failedService.confirm(confirmationInput(failedFixture, 'send-failed-2'));
    assert.strictEqual(deliberateRetry.state, 'accepted');
    assert.strictEqual(failedCalls, 2, 'definite failure permits one new deliberate key only');
    const failedRows = db.prepare('SELECT * FROM matrix_stream_jobs WHERE work_item_id = ? ORDER BY id').all(failedFixture.workItemId);
    assert.deepStrictEqual(failedRows.map(row => row.state), ['failed', 'accepted']);
    assert.ok(!JSON.stringify(failedRows).includes('SMTP_PASS'));
    assert.ok(!JSON.stringify(failedRows).includes('raw server detail'));

    const ambiguousFixture = seedApprovedFixture(3);
    let ambiguousCalls = 0;
    const ambiguousService = createMatrixStreamDelivery({
      db, fromAddress: 'sales@sender.test', messageIdDomain: 'sender.test', clock: () => new Date(NOW),
      transport: { sendMail: async () => {
        ambiguousCalls += 1;
        const error = new Error('socket timeout host=private SMTP_USER=secret');
        error.code = 'ETIMEDOUT';
        throw error;
      } }
    });
    const ambiguous = await ambiguousService.confirm(confirmationInput(ambiguousFixture, 'send-ambiguous-1'));
    assert.strictEqual(ambiguous.state, 'ambiguous');
    await assert.rejects(
      () => ambiguousService.confirm(confirmationInput(ambiguousFixture, 'send-ambiguous-2')),
      /ambiguous blocks resend/
    );
    assert.strictEqual(ambiguousCalls, 1, 'ambiguous delivery must never retry internally or under a new key');
    const ambiguousRow = db.prepare('SELECT * FROM matrix_stream_jobs WHERE work_item_id = ?').get(ambiguousFixture.workItemId);
    assert.ok(!JSON.stringify(ambiguousRow).includes('SMTP_USER'));
    assert.ok(!JSON.stringify(ambiguousRow).includes('private'));

    const forbiddenFixture = seedApprovedFixture(4);
    db.prepare('UPDATE users SET permissions_json = ? WHERE id = ?')
      .run(JSON.stringify({ modules: { crm: true }, capabilities: { matrixSend: false } }), forbiddenFixture.actorUserId);
    let forbiddenCalls = 0;
    const forbiddenService = createMatrixStreamDelivery({
      db, fromAddress: 'sales@sender.test', messageIdDomain: 'sender.test', clock: () => new Date(NOW),
      transport: { sendMail: async () => { forbiddenCalls += 1; return { accepted: [] }; } }
    });
    await assert.rejects(() => forbiddenService.confirm(confirmationInput(forbiddenFixture, 'send-forbidden')), /matrixSend capability/);
    assert.strictEqual(forbiddenCalls, 0);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM matrix_stream_jobs WHERE work_item_id = ?').get(forbiddenFixture.workItemId).count, 0);

    const concurrentFixture = seedApprovedFixture(5);
    let concurrentCalls = 0;
    let releaseTransport;
    let enterTransport;
    const entered = new Promise(resolve => { enterTransport = resolve; });
    const release = new Promise(resolve => { releaseTransport = resolve; });
    const concurrentService = createMatrixStreamDelivery({
      db, fromAddress: 'sales@sender.test', messageIdDomain: 'sender.test', clock: () => new Date(NOW),
      transport: { sendMail: async mail => {
        concurrentCalls += 1;
        enterTransport();
        await release;
        return { accepted: [mail.to], rejected: [] };
      } }
    });
    const concurrentInput = confirmationInput(concurrentFixture, 'send-concurrent');
    const concurrentFirst = concurrentService.confirm(concurrentInput);
    await entered;
    const concurrentSecond = concurrentService.confirm(concurrentInput);
    releaseTransport();
    const concurrentResults = await Promise.all([concurrentFirst, concurrentSecond]);
    assert.deepStrictEqual(concurrentResults[0], concurrentResults[1]);
    assert.strictEqual(concurrentResults[0].state, 'accepted');
    assert.strictEqual(concurrentCalls, 1);

    const extraFixture = seedApprovedFixture(6);
    let extraCalls = 0;
    const extraService = createMatrixStreamDelivery({
      db, fromAddress: 'sales@sender.test', messageIdDomain: 'sender.test', clock: () => new Date(NOW),
      transport: { sendMail: async () => { extraCalls += 1; return { accepted: [] }; } }
    });
    for (const field of ['recipient', 'body', 'smtpHost', 'callbackUrl', 'attachment', 'retry']) {
      await assert.rejects(
        () => extraService.confirm({ ...confirmationInput(extraFixture, `send-extra-${field}`), [field]: true }),
        /unknown delivery confirmation field/
      );
    }
    assert.strictEqual(extraCalls, 0);

    function gateProbe(fixture) {
      let calls = 0;
      return {
        get calls() { return calls; },
        service: createMatrixStreamDelivery({
          db, fromAddress: 'sales@sender.test', messageIdDomain: 'sender.test', clock: () => new Date(NOW),
          transport: { sendMail: async mail => { calls += 1; return { accepted: [mail.to], rejected: [] }; } }
        })
      };
    }

    const hashFixture = seedApprovedFixture(7);
    const hashProbe = gateProbe(hashFixture);
    await assert.rejects(
      () => hashProbe.service.confirm({ ...confirmationInput(hashFixture, 'send-stale-hash'), expectedContentHash: 'f'.repeat(64) }),
      /content hash mismatch/
    );
    assert.strictEqual(hashProbe.calls, 0);

    const bindingFixture = seedApprovedFixture(8);
    db.prepare("UPDATE matrix_actor_bindings SET status='revoked', revoked_at=? WHERE id=?").run(NOW, bindingFixture.bindingId);
    const bindingProbe = gateProbe(bindingFixture);
    await assert.rejects(() => bindingProbe.service.confirm(confirmationInput(bindingFixture, 'send-revoked-binding')), /active actor binding/);
    assert.strictEqual(bindingProbe.calls, 0);

    const ownerFixture = seedApprovedFixture(9);
    db.prepare('UPDATE matrix_work_items SET owner_user_id=? WHERE id=?').run(senderId, ownerFixture.workItemId);
    const ownerProbe = gateProbe(ownerFixture);
    await assert.rejects(() => ownerProbe.service.confirm(confirmationInput(ownerFixture, 'send-wrong-owner')), /not authorized/);
    assert.strictEqual(ownerProbe.calls, 0);

    const currentFixture = seedApprovedFixture(10);
    db.prepare('UPDATE matrix_work_items SET current_stream_version_id=NULL WHERE id=?').run(currentFixture.workItemId);
    const currentProbe = gateProbe(currentFixture);
    await assert.rejects(() => currentProbe.service.confirm(confirmationInput(currentFixture, 'send-not-current')), /not current/);
    assert.strictEqual(currentProbe.calls, 0);

    const provenanceFixture = seedApprovedFixture(11);
    db.prepare("UPDATE matrix_stream_recipient_evidence SET status='revoked' WHERE id=?").run(provenanceFixture.version.recipient_evidence_id);
    const provenanceProbe = gateProbe(provenanceFixture);
    await assert.rejects(() => provenanceProbe.service.confirm(confirmationInput(provenanceFixture, 'send-revoked-source')), /recipient provenance/);
    assert.strictEqual(provenanceProbe.calls, 0);

    const qualityFixture = seedApprovedFixture(12, { lowQuality: true });
    assert.ok(qualityFixture.version.quality_score < 80);
    const qualityProbe = gateProbe(qualityFixture);
    await assert.rejects(() => qualityProbe.service.confirm(confirmationInput(qualityFixture, 'send-low-quality')), /quality final gate/);
    assert.strictEqual(qualityProbe.calls, 0);

    const suppressedFixture = seedApprovedFixture(13);
    db.prepare("UPDATE matrix_work_items SET stage='suppressed', stream_state='suppressed' WHERE id=?").run(suppressedFixture.workItemId);
    const suppressedProbe = gateProbe(suppressedFixture);
    await assert.rejects(() => suppressedProbe.service.confirm(confirmationInput(suppressedFixture, 'send-suppressed')), /suppressed/);
    assert.strictEqual(suppressedProbe.calls, 0);

    const readinessFixture = seedApprovedFixture(14);
    db.prepare("UPDATE matrix_stream_sender_checks SET expires_at='2026-07-18T00:30:00.000Z' WHERE sender_domain='sender.test'").run();
    const readinessProbe = gateProbe(readinessFixture);
    await assert.rejects(() => readinessProbe.service.confirm(confirmationInput(readinessFixture, 'send-expired-readiness')), /sender readiness/);
    assert.strictEqual(readinessProbe.calls, 0);
    db.prepare("UPDATE matrix_stream_sender_checks SET expires_at='2026-07-19T00:00:00.000Z' WHERE sender_domain='sender.test'").run();

    const policyFixture = seedApprovedFixture(15);
    db.prepare("UPDATE matrix_stream_country_policies SET status='blocked' WHERE country_code='VN' AND channel='email'").run();
    const policyProbe = gateProbe(policyFixture);
    await assert.rejects(() => policyProbe.service.confirm(confirmationInput(policyFixture, 'send-blocked-policy')), /country channel policy/);
    assert.strictEqual(policyProbe.calls, 0);
    db.prepare("UPDATE matrix_stream_country_policies SET status='approved' WHERE country_code='VN' AND channel='email'").run();

    const coolingFixture = seedApprovedFixture(16);
    db.prepare(`
      INSERT INTO matrix_stream_jobs (
        work_item_id, version_id, idempotency_key, content_hash, message_id, state,
        attempt_count, error_class, redacted_diagnostic, created_by, created_at, updated_at
      ) VALUES (?, ?, 'cooling-history', ?, '<cooling-history@sender.test>', 'accepted', 1, '', '', ?, ?, ?)
    `).run(coolingFixture.workItemId, coolingFixture.version.id, '0'.repeat(64), coolingFixture.actorUserId, NOW, NOW);
    const coolingProbe = gateProbe(coolingFixture);
    await assert.rejects(() => coolingProbe.service.confirm(confirmationInput(coolingFixture, 'send-cooling')), /domain_cooling_90_days/);
    assert.strictEqual(coolingProbe.calls, 0);

    const quotaFixture = seedApprovedFixture(17);
    db.prepare(`
      INSERT INTO matrix_stream_jobs (
        work_item_id, version_id, idempotency_key, content_hash, message_id, state,
        attempt_count, error_class, redacted_diagnostic, created_by, created_at, updated_at
      ) VALUES (?, ?, 'quota-history', ?, '<quota-history@sender.test>', 'accepted', 1, '', '', ?, ?, ?)
    `).run(fixture.workItemId, fixture.version.id, '1'.repeat(64), fixture.actorUserId, NOW, NOW);
    const quotaProbe = gateProbe(quotaFixture);
    await assert.rejects(() => quotaProbe.service.confirm(confirmationInput(quotaFixture, 'send-quota')), /daily_accepted_limit_5/);
    assert.strictEqual(quotaProbe.calls, 0);

    console.log('matrix stream delivery tests passed');
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

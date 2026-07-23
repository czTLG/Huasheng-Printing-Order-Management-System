'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-ledger-command-'));
process.env.DB_PATH = path.join(root, 'app.db');

const { createMatrixLedgerCommand } = require('../src/services/matrixLedgerCommand');
const { db, initDb } = require('../src/db');
const review = require('../src/services/matrixStreamReview');
const { createMatrixStreamPreview } = require('../src/services/matrixStreamPreview');
const { createMatrixStreamDelivery } = require('../src/services/matrixStreamDelivery');

const NOW = '2026-07-18T01:00:00.000Z';
const exactBody = 'Dear UNITEA Kazakhstan procurement team,\nWe reviewed your public tea range and would like to discuss one tea pouch with a zipper and roll-film SKU. Could you share the current material structure and annual volume?\nBest regards';
const exactChinese = '您好，\n我们查看了贵司公开的茶产品系列，希望沟通一个带有拉链的茶袋和卷膜SKU。请问能否提供当前材料结构和年用量？\n此致敬礼';

initDb();

function jobCount() {
  return db.prepare('SELECT COUNT(*) AS count FROM matrix_stream_jobs').get().count;
}

function seed() {
  const actorUserId = 760;
  db.prepare(`
    INSERT INTO users (id, username, password, role, status, permissions_json, created_at)
    VALUES (?, 'matrix-ledger-command', 'test-only', 'foreign_trade_crm_admin', 'active', ?, ?)
  `).run(actorUserId, JSON.stringify({ modules: { crm: true }, capabilities: { matrixSend: true } }), NOW);
  const bindingId = Number(db.prepare(`
    INSERT INTO matrix_actor_bindings (feishu_open_id, user_id, status, bound_by, bound_at)
    VALUES ('ou-ledger-command', ?, 'active', ?, ?)
  `).run(actorUserId, actorUserId, NOW).lastInsertRowid);
  const customerId = Number(db.prepare(`
    INSERT INTO customers (name, contact, active, created_at, updated_at)
    VALUES ('UNITEA Kazakhstan', 'procurement@unitea.kz', 1, ?, ?)
  `).run(NOW, NOW).lastInsertRowid);
  const candidateId = 76001;
  db.prepare(`
    INSERT INTO matrix_customer_links (canonical_customer_id, source_kind, source_id, normalized_domain, confidence, created_at)
    VALUES (?, 'candidate', ?, 'unitea.kz', 'reviewed', ?)
  `).run(customerId, String(candidateId), NOW);
  const contactId = Number(db.prepare(`
    INSERT INTO matrix_contacts (
      canonical_customer_id, channel, address, role, source_url, verified_at, status, created_at, updated_at
    ) VALUES (?, 'email', 'procurement@unitea.kz', 'procurement', 'https://unitea.kz/contact', ?, 'active', ?, ?)
  `).run(customerId, '2026-07-17T00:00:00.000Z', NOW, NOW).lastInsertRowid);
  const workItemId = Number(db.prepare(`
    INSERT INTO matrix_work_items (
      candidate_id, stage, owner_user_id, current_summary, next_action, version, created_at, updated_at, stream_state
    ) VALUES (?, 'selected', ?, '', '', 1, ?, ?, 'selected')
  `).run(candidateId, actorUserId, NOW, NOW).lastInsertRowid);
  const recipient = {
    email: 'procurement@unitea.kz',
    sourceUrl: 'https://unitea.kz/contact',
    verifiedAt: '2026-07-17T00:00:00.000Z',
    kind: 'public_company'
  };
  const sourceSnapshot = {
    organization_domain: 'unitea.kz',
    recipient_email: recipient.email,
    source_url: recipient.sourceUrl,
    country_code: 'KZ',
    company: 'UNITEA Kazakhstan',
    categories: ['tea'],
    products: ['tea pouch with zipper', 'tea roll film'],
    entryProduct: 'tea pouch with a zipper and roll-film',
    supportedClaims: [],
    evidenceIds: [1, 2, 3],
    strategy_match: { passed: true, score: 100, threshold: 75, blockers: [], localized_route_status: 'ready' }
  };
  db.prepare(`
    INSERT INTO matrix_stream_recipient_evidence (
      work_item_id, organization_domain, recipient_email, source_url, verified_at,
      snapshot_json, status, created_by, created_at
    ) VALUES (?, 'unitea.kz', ?, ?, ?, ?, 'active', ?, ?)
  `).run(workItemId, recipient.email, recipient.sourceUrl, recipient.verifiedAt, JSON.stringify(sourceSnapshot), actorUserId, NOW);
  const created = review.createInitialVersion(db, {
    actorUserId,
    workItemId,
    expectedWorkVersion: 1,
    recipient,
    subject: 'Tea pouch and roll-film review for one UNITEA SKU',
    bodyEn: exactBody,
    bodyCn: exactChinese,
    strategySummary: 'official research reviewed',
    sourceSnapshot,
    idempotencyKey: 'ledger-command-version-create'
  });
  const version = review.approveVersion(db, {
    actorUserId,
    workItemId,
    versionId: created.id,
    expectedWorkVersion: 2,
    expectedContentHash: created.content_hash,
    idempotencyKey: 'ledger-command-version-approve'
  });
  db.prepare(`
    INSERT INTO matrix_stream_sender_checks (
      sender_domain, checked_at, expires_at, spf_ok, dkim_ok, dmarc_ok, tls_ok, smtp_ok, detail_json
    ) VALUES ('sender.test', '2026-07-18T00:00:00.000Z', '2026-07-19T00:00:00.000Z', 1, 1, 1, 1, 1, '{"selector":"selector"}')
  `).run();
  db.prepare(`
    INSERT INTO matrix_stream_country_policies (
      country_code, channel, status, sender_identity_required, opt_out_required,
      reviewed_by, reviewed_at, expires_at, source_urls_json
    ) VALUES ('KZ', 'email', 'approved', 1, 1, ?, '2026-07-17T00:00:00.000Z',
      '2026-08-17T00:00:00.000Z', '["https://authority.test/policy"]')
  `).run(actorUserId);
  return { actorUserId, bindingId, customerId, contactId, workItemId, version };
}

(async () => {
  try {
    const fixture = seed();
    const deliveries = [];
    const previewService = createMatrixStreamPreview({
      db,
      clock: () => new Date(NOW),
      senderDomain: 'sender.test',
      dkimSelector: 'selector',
      readinessService: { check: async () => ({ ok: true, hardFailures: [] }) }
    });
    const deliveryService = createMatrixStreamDelivery({
      db,
      fromAddress: 'sales@sender.test',
      messageIdDomain: 'sender.test',
      dkimSelector: 'selector',
      clock: () => new Date(NOW),
      transport: { sendMail: async mail => {
        assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM matrix_lifecycle_events WHERE event_type = 'delivery_confirmed'").get().count, 1);
        deliveries.push(mail);
        return { accepted: [mail.to], rejected: [] };
      } }
    });
    const command = createMatrixLedgerCommand({ db, reviewService: review, previewService, deliveryService, clock: () => new Date(NOW) });

    assert.strictEqual(jobCount(), 0, 'candidate selection must create no delivery jobs');
    const preview = await command.finalPreview({
      actorUserId: fixture.actorUserId,
      customerId: fixture.customerId,
      versionId: fixture.version.id
    });
    assert.deepStrictEqual(preview, {
      customer_id: fixture.customerId,
      customer_name: 'UNITEA Kazakhstan',
      contact_id: fixture.contactId,
      recipient: 'procurement@unitea.kz',
      subject: 'Tea pouch and roll-film review for one UNITEA SKU',
      body_en: exactBody,
      body_cn: exactChinese,
      attachments: [],
      version_id: fixture.version.id,
      content_hash: fixture.version.content_hash,
      allowed: true,
      blockers: []
    });
    assert.strictEqual(jobCount(), 0, 'opening a preview must create no delivery jobs');

    const common = {
      actorUserId: fixture.actorUserId,
      bindingId: fixture.bindingId,
      customerId: fixture.customerId,
      versionId: fixture.version.id,
      expectedContentHash: fixture.version.content_hash,
      chatId: 'chat-ledger-command',
      cardEventId: 'card-ledger-command',
      idempotencyKey: 'ledger-command-confirm-1'
    };
    await assert.rejects(
      () => command.confirmDelivery({ ...common, confirmationText: '确认采用' }),
      /exact confirmation required/
    );
    assert.strictEqual(jobCount(), 0, '确认采用 must create no delivery jobs');
    const result = await command.confirmDelivery({ ...common, confirmationText: ' 确认发送 UNITEA Kazakhstan ' });
    assert.strictEqual(result.state, 'accepted');
    assert.strictEqual(jobCount(), 1, 'only the exact confirmation creates one delivery job');
    assert.strictEqual(deliveries.length, 1);
    assert.deepStrictEqual(await command.confirmDelivery({ ...common, confirmationText: '确认发送 UNITEA Kazakhstan' }), result);
    assert.strictEqual(jobCount(), 1, 'repeated exact confirmation must replay one job');
    console.log('matrix ledger command tests passed');
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

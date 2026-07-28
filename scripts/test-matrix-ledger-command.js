'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
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
const { MATRIX_MAIL_SIGNATURE, renderMatrixMail } = require('../src/services/matrixMailRender');

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
  const version = created;
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
  return { actorUserId, bindingId, customerId, contactId, workItemId, version, sourceSnapshot };
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
        assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM matrix_lifecycle_events WHERE event_type = 'delivery_confirmed' AND actor_user_id = ?").get(fixture.actorUserId).count, 1);
        deliveries.push(mail);
        return { accepted: [mail.to], rejected: [] };
      } }
    });
    let evidenceCurrent = true;
    const command = createMatrixLedgerCommand({
      db, reviewService: review, previewService, deliveryService, clock: () => new Date(NOW),
      currentEvidence: async () => {
        if (!evidenceCurrent) throw new Error('official evidence changed');
        return { sourceSnapshot: fixture.sourceSnapshot };
      }
    });

    assert.strictEqual(jobCount(), 0, 'candidate selection must create no delivery jobs');
    const preview = await command.finalPreview({
      actorUserId: fixture.actorUserId,
      customerId: fixture.customerId,
      versionId: fixture.version.id
    });
    assert.strictEqual(
      db.prepare('SELECT status FROM matrix_stream_versions WHERE id = ?').get(fixture.version.id).status,
      'draft',
      'opening the final preview must not approve the draft'
    );
    const renderedMail = renderMatrixMail({ bodyEn: exactBody });
    assert.deepStrictEqual(preview, {
      customer_id: fixture.customerId,
      customer_name: 'UNITEA Kazakhstan',
      contact_id: fixture.contactId,
      recipient: 'procurement@unitea.kz',
      subject: 'Tea pouch and roll-film review for one UNITEA SKU',
      body_en: exactBody,
      body_cn: exactChinese,
      mail: {
        template_version: renderedMail.templateVersion,
        text: renderedMail.text,
        html: renderedMail.html,
        logo_url: MATRIX_MAIL_SIGNATURE.logoUrl,
        render_hash: renderedMail.renderHash
      },
      attachments: [],
      version_id: fixture.version.id,
      content_hash: fixture.version.content_hash,
      allowed: true,
      blockers: []
    });
    assert.strictEqual(jobCount(), 0, 'opening a preview must create no delivery jobs');
    evidenceCurrent = false;
    await assert.rejects(
      () => command.finalPreview({ actorUserId: fixture.actorUserId, customerId: fixture.customerId, versionId: fixture.version.id }),
      /official evidence changed/
    );
    assert.strictEqual(jobCount(), 0, 'withdrawn evidence must block without creating a delivery job');
    evidenceCurrent = true;

    const originalVersion = db.prepare('SELECT * FROM matrix_stream_versions WHERE id = ?').get(fixture.version.id);
    const priorVersionId = Number(db.prepare(`
      INSERT INTO matrix_stream_versions (
        work_item_id, recipient_evidence_id, revision, recipient_email, recipient_source_url, recipient_verified_at,
        subject, body_en, body_cn, strategy_summary, source_snapshot_json, content_hash, quality_score, quality_json,
        status, created_by, approved_by, approved_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'superseded', ?, ?, ?, ?, ?)
    `).run(
      originalVersion.work_item_id, originalVersion.recipient_evidence_id, originalVersion.revision + 100,
      originalVersion.recipient_email, originalVersion.recipient_source_url, originalVersion.recipient_verified_at,
      originalVersion.subject, originalVersion.body_en, originalVersion.body_cn, originalVersion.strategy_summary,
      originalVersion.source_snapshot_json, `${originalVersion.content_hash.slice(0, 63)}0`, originalVersion.quality_score,
      originalVersion.quality_json, originalVersion.created_by, originalVersion.approved_by, originalVersion.approved_at,
      originalVersion.created_at, originalVersion.updated_at
    ).lastInsertRowid);
    db.prepare(`
      INSERT INTO matrix_stream_jobs (
        work_item_id, version_id, idempotency_key, content_hash, message_id, state, attempt_count, error_class,
        redacted_diagnostic, created_by, owner_token, lease_expires_at, recipient_domain, sender_email,
        reservation_day, created_at, updated_at
      ) VALUES (?, ?, 'ledger-prior-ambiguous', ?, '<prior@sender.test>', 'ambiguous', 1, '', '', ?, '', '', 'unitea.kz', 'sales@sender.test', '2026-07-18', ?, ?)
    `).run(fixture.workItemId, priorVersionId, `${originalVersion.content_hash.slice(0, 63)}0`, fixture.actorUserId, NOW, NOW);
    const ambiguousPreview = await command.finalPreview({ actorUserId: fixture.actorUserId, customerId: fixture.customerId, versionId: fixture.version.id });
    assert.strictEqual(ambiguousPreview.allowed, false);
    assert.ok(ambiguousPreview.blockers.includes('existing_ambiguous_delivery'));
    await assert.rejects(
      () => command.confirmDelivery({
        actorUserId: fixture.actorUserId, bindingId: fixture.bindingId, customerId: fixture.customerId,
        versionId: fixture.version.id, expectedContentHash: fixture.version.content_hash,
        confirmationText: '确认发送 UNITEA Kazakhstan', chatId: 'blocked-chat', cardEventId: 'blocked-card', idempotencyKey: 'blocked-prior-domain'
      }),
      /final preview blocked/
    );
    assert.strictEqual(deliveries.length, 0, 'an ambiguous delivery for a prior version must block before transport');
    db.prepare("DELETE FROM matrix_stream_jobs WHERE idempotency_key = 'ledger-prior-ambiguous'").run();

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
    const collisionKey = `matrix-ledger-confirm:${crypto.createHash('sha256').update('ledger-command-collision').digest('hex')}`;
    db.prepare(`
      INSERT INTO matrix_lifecycle_events (
        canonical_customer_id, event_type, source_kind, source_id, actor_user_id,
        before_json, after_json, idempotency_key, created_at
      ) VALUES (?, 'delivery_confirmed', 'matrix_stream_version', ?, ?, '{}', '{}', ?, ?)
    `).run(fixture.customerId, String(fixture.version.id), fixture.actorUserId + 1, collisionKey, NOW);
    await assert.rejects(
      () => command.confirmDelivery({ ...common, idempotencyKey: 'ledger-command-collision', confirmationText: '确认发送 UNITEA Kazakhstan' }),
      /idempotency conflict/
    );
    assert.strictEqual(jobCount(), 0, 'a mismatched approval event must fail before delivery');
    await assert.rejects(
      () => command.confirmDelivery({ ...common, confirmationText: '确认采用' }),
      /exact confirmation required/
    );
    assert.strictEqual(jobCount(), 0, '确认采用 must create no delivery jobs');
    await assert.rejects(
      () => command.confirmDelivery({ ...common, confirmationText: 'card:confirm_delivery', idempotencyKey: 'ledger-command-spoofed-card' }),
      /exact confirmation required/
    );
    const result = await command.confirmDelivery({ ...common, confirmationText: ' 确认发送 UNITEA Kazakhstan ' });
    assert.strictEqual(result.state, 'accepted');
    assert.strictEqual(
      db.prepare('SELECT status FROM matrix_stream_versions WHERE id = ?').get(fixture.version.id).status,
      'approved',
      'the exact final confirmation must atomically persist approval before delivery'
    );
    assert.strictEqual(jobCount(), 1, 'only the exact confirmation creates one delivery job');
    assert.strictEqual(
      db.prepare(`
        SELECT COUNT(*) AS total FROM matrix_tasks
        WHERE canonical_customer_id = ? AND task_type = 'check_reply' AND state = 'pending'
      `).get(fixture.customerId).total,
      1,
      'accepted canonical delivery must create one canonical check-reply task'
    );
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

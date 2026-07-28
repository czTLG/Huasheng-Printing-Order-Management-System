'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-intake-bridge-'));
process.env.DB_PATH = path.join(dir, 'app.db');
const { db, initDb } = require('../src/db');
const { createMatrixLedgerStore } = require('../src/services/matrixLedgerStore');
const reviewService = require('../src/services/matrixStreamReview');
const { createMatrixIntakeBridge } = require('../src/services/matrixIntakeBridge');

const NOW = new Date('2026-07-28T08:00:00.000Z');

(async () => {
  try {
    initDb();
    db.prepare(`
      INSERT INTO users (id, username, password, role, status, created_at)
      VALUES (101, 'matrix-test', 'test-only', 'foreign_trade_crm_admin', 'active', '2026-07-28 08:00:00')
    `).run();
    const candidate = {
      id: 71,
      company_name: 'Nutty Nuts Foodstuff Factory LLC',
      normalized_domain: 'nutty-nuts.com',
      public_email: 'sales@nutty-nuts.com',
      contact_url: 'https://www.nutty-nuts.com/pages/contact',
      contact_role: 'public sales',
      status: 'valid',
      audit_state: 'audited',
      audited_at: '2026-07-27T08:00:00.000Z',
      updated_at: '2026-07-27T08:00:00.000Z'
    };
    const sourceSnapshot = {
      candidateId: 71,
      organization_domain: 'nutty-nuts.com',
      recipient_email: 'sales@nutty-nuts.com',
      source_url: 'https://www.nutty-nuts.com/pages/contact',
      company: 'Nutty Nuts Foodstuff Factory LLC',
      categories: ['nuts', 'snacks'],
      products: ['nuts', 'snacks', 'pillow pouches', 'roll film'],
      entryProduct: 'pillow pouch and roll film',
      supportedClaims: [
        'We are Huasheng Packaging Co., Ltd., a flexible packaging manufacturer in China.',
        '我们是华胜包装有限公司，一家位于中国的软包装制造商。',
        'For these applications, we focus on moisture protection and print consistency.',
        '针对这些应用，我们重点关注防潮和印刷一致性。'
      ],
      evidenceIds: [1, 2, 3],
      localizedRouteSet: {
        status: 'ready',
        commit: '650d7b3',
        verifiedAt: '2026-07-27T09:00:00.000Z',
        urls: { application: 'https://gdhspack.com/ar/applications/snack-packaging' }
      }
    };
    const publicCandidate = {
      id: 72,
      company_name: 'Hock Xeng Sdn Bhd',
      normalized_domain: 'hockxeng.com',
      public_email: 'hockxeng@gmail.com',
      contact_url: 'https://www.hockxeng.com/contact-us/',
      contact_role: 'public business',
      status: 'valid',
      audit_state: 'audited',
      audited_at: '2026-07-28T07:00:00.000Z',
      updated_at: '2026-07-28T07:00:00.000Z'
    };
    const publicProvenance = {
      evidence_mode: 'official_public_mailbox',
      corroboration: {
        source_url: 'https://example-exhibition.test/hock-xeng',
        source_class: 'official_exhibition',
        observed_at: '2026-07-28T07:10:00.000Z',
        email: 'hockxeng@gmail.com',
        organization_name: 'Hock Xeng Sdn Bhd',
        official_domain: 'hockxeng.com',
        identity_matches: { address: true, phone: true }
      }
    };
    const publicSnapshot = {
      ...sourceSnapshot,
      candidateId: 72,
      organization_domain: 'hockxeng.com',
      recipient_email: 'hockxeng@gmail.com',
      source_url: 'https://www.hockxeng.com/contact-us/',
      company: 'Hock Xeng Sdn Bhd',
      categories: ['spices', 'seasonings'],
      products: ['spices', 'seasonings', 'seasoning pouches', 'roll film'],
      entryProduct: 'spice pouch and roll film',
      recipient_provenance: publicProvenance
    };
    const bridge = createMatrixIntakeBridge({
      db,
      store: createMatrixLedgerStore({ db, clock: () => NOW }),
      reviewService,
      clock: () => NOW,
      prepareCandidate: async value => value.id === 72 ? ({
        organizationDomain: 'hockxeng.com',
        recipient: {
          email: 'hockxeng@gmail.com',
          sourceUrl: 'https://www.hockxeng.com/contact-us/',
          verifiedAt: '2026-07-28T07:00:00.000Z',
          kind: 'public_company'
        },
        sourceSnapshot: publicSnapshot
      }) : ({
        organizationDomain: 'nutty-nuts.com',
        recipient: {
          email: 'sales@nutty-nuts.com',
          sourceUrl: 'https://www.nutty-nuts.com/pages/contact',
          verifiedAt: '2026-07-27T08:00:00.000Z',
          kind: 'public_company'
        },
        sourceSnapshot
      })
    });
    const input = {
      candidate,
      actorUserId: 101,
      subject: 'Pillow pouch and roll-film options for Nutty Nuts snacks',
      bodyEn: 'Dear Nutty Nuts Team,\n\nWe reviewed your nuts and snacks, including pillow pouches and roll film.\n\nWe are Huasheng Packaging Co., Ltd., a flexible packaging manufacturer in China.\n\nFor these applications, we focus on moisture protection and print consistency.\n\nIf you have a current project, could you share one specification, product photo or sample?\n\nBest regards,\nGavin',
      bodyCn: '您好，Nutty Nuts 团队：\n\n我们查看了贵司的坚果和零食产品，包括枕式袋和卷膜。\n\n我们是华胜包装有限公司，一家位于中国的软包装制造商。\n\n针对这些应用，我们重点关注防潮和印刷一致性。\n\n如果贵司有当前项目，能否提供一份规格、产品图片或样品？\n\n此致\nGavin',
      strategySummary: '以公开产品和现有零售包装为切入点。',
      attachmentManifest: [],
      idempotencyKey: 'intake:nutty-nuts:final-v1'
    };

    await assert.rejects(() => bridge.create({
      ...input,
      subject: 'Hello',
      bodyEn: 'Generic message',
      bodyCn: '普通消息',
      idempotencyKey: 'intake:nutty-nuts:blocked'
    }), /quality gate blocked/);
    assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM customers').get().count, 0);
    assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM matrix_work_items').get().count, 0);
    assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM matrix_stream_versions').get().count, 0);

    const created = await bridge.create(input);
    assert.strictEqual(created.status, 'draft');
    assert.strictEqual(created.work_item_version, 2);
    assert.ok(created.customer_id > 0);
    assert.ok(created.version_id > 0);
    assert.strictEqual((await bridge.create(input)).resolution, 'replayed');
    assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM customers').get().count, 1);
    assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM matrix_stream_versions').get().count, 1);
    await assert.rejects(
      () => bridge.create({ ...input, idempotencyKey: 'intake:nutty-nuts:refresh-blocked' }),
      /candidate already has a draft/
    );
    const refreshed = await bridge.create({
      ...input,
      allowExistingWorkItem: true,
      idempotencyKey: 'intake:nutty-nuts:refresh-v2'
    });
    assert.strictEqual(refreshed.status, 'draft');
    assert.strictEqual(refreshed.work_item_version, 3);
    assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM matrix_stream_versions').get().count, 2);
    assert.strictEqual(db.prepare('SELECT status FROM matrix_stream_versions WHERE id=?').get(created.version_id).status, 'superseded');
    await assert.rejects(() => bridge.create({ ...input, attachmentManifest: [{ name: 'file.pdf' }] }), /attachments are not supported/);
    await assert.rejects(
      () => bridge.create({ ...input, idempotencyKey: 'intake:bad', candidate: { ...candidate, public_email: 'wrong@outside.test' } }),
      /candidate recipient mismatch/
    );
    const publicCreated = await bridge.create({
      ...input,
      candidate: publicCandidate,
      subject: 'Spice pouch and roll-film options for Hock Xeng',
      bodyEn: 'Dear Hock Xeng Team,\n\nWe reviewed your spices and seasonings, including spice pouches and roll film.\n\nWe are Huasheng Packaging Co., Ltd., a flexible packaging manufacturer in China.\n\nFor these applications, we focus on moisture protection and print consistency.\n\nIf you have a current project, could you share one specification, product photo or sample?\n\nBest regards,\nGavin',
      bodyCn: '您好，Hock Xeng 团队：\n\n我们查看了贵司的香辛料和调味品，包括香辛料袋和卷膜。\n\n我们是华胜包装有限公司，一家位于中国的软包装制造商。\n\n针对这些应用，我们重点关注防潮和印刷一致性。\n\n如果贵司有当前项目，能否提供一份规格、产品图片或样品？\n\n此致\nGavin',
      idempotencyKey: 'intake:hock-xeng:public-mailbox'
    });
    assert.strictEqual(publicCreated.status, 'draft');
    assert.strictEqual(db.prepare(
      'SELECT organization_domain FROM matrix_stream_recipient_evidence WHERE work_item_id=?'
    ).get(publicCreated.work_item_id).organization_domain, 'hockxeng.com');
    assert.strictEqual(JSON.parse(db.prepare(
      'SELECT snapshot_json FROM matrix_stream_recipient_evidence WHERE work_item_id=?'
    ).get(publicCreated.work_item_id).snapshot_json).recipient_provenance.evidence_mode, 'official_public_mailbox');
    assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM matrix_stream_versions').get().count, 3);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('matrix intake bridge tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

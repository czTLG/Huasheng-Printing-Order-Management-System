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
      audited_at: '2026-07-27T08:00:00.000Z'
    };
    const sourceSnapshot = {
      candidateId: 71,
      organization_domain: 'nutty-nuts.com',
      recipient_email: 'sales@nutty-nuts.com',
      source_url: 'https://www.nutty-nuts.com/pages/contact',
      localizedRouteSet: {
        status: 'ready',
        commit: '650d7b3',
        verifiedAt: '2026-07-27T09:00:00.000Z',
        urls: { application: 'https://gdhspack.com/ar/applications/snack-packaging' }
      }
    };
    const bridge = createMatrixIntakeBridge({
      db,
      store: createMatrixLedgerStore({ db, clock: () => NOW }),
      reviewService,
      clock: () => NOW,
      prepareCandidate: async () => ({
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
      subject: 'Retail nut packaging review for Nutty Nuts',
      bodyEn: 'Dear Nutty Nuts Team,\\n\\nWe reviewed your public nut and snack range. We would like to compare the seal integrity, barrier needs and filling-line fit for one current retail format.\\n\\nArabic packaging route: https://gdhspack.com/ar/applications/snack-packaging\\n\\nBest regards,\\nGavin\\nHuasheng Printing Co., Ltd.',
      bodyCn: '您好，Nutty Nuts 团队：\\n\\n我们查看了贵司公开的坚果和零食产品系列，希望从一款现有零售包装入手，对封口稳定性、阻隔需求和包装线适配进行比较。\\n\\n此致\\nGavin\\n华胜印刷有限公司',
      strategySummary: '以公开产品和现有零售包装为切入点。',
      attachmentManifest: [],
      idempotencyKey: 'intake:nutty-nuts:final-v1'
    };

    const created = await bridge.create(input);
    assert.strictEqual(created.status, 'draft');
    assert.strictEqual(created.work_item_version, 2);
    assert.ok(created.customer_id > 0);
    assert.ok(created.version_id > 0);
    assert.strictEqual((await bridge.create(input)).resolution, 'replayed');
    assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM customers').get().count, 1);
    assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM matrix_stream_versions').get().count, 1);
    await assert.rejects(() => bridge.create({ ...input, attachmentManifest: [{ name: 'file.pdf' }] }), /attachments are not supported/);
    await assert.rejects(
      () => bridge.create({ ...input, idempotencyKey: 'intake:bad', candidate: { ...candidate, public_email: 'wrong@outside.test' } }),
      /candidate recipient mismatch/
    );
    assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM matrix_stream_versions').get().count, 1);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('matrix intake bridge tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

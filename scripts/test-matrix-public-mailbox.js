'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-public-mailbox-'));
process.env.DB_PATH = path.join(root, 'app.db');

const { db, initDb } = require('../src/db');
const review = require('../src/services/matrixStreamReview');
const { createMatrixStreamDelivery } = require('../src/services/matrixStreamDelivery');
const { validateRecipientProvenance } = require('../src/services/matrixRecipientProvenance');

const NOW = '2026-07-28T08:00:00.000Z';

function seed(index, { organizationDomain, company, email }) {
  const actorUserId = 800 + index;
  db.prepare(`
    INSERT INTO users (id,username,password,role,status,permissions_json,created_at)
    VALUES (?,?,'test-only','foreign_trade_crm_admin','active',?,?)
  `).run(actorUserId, `public-mailbox-${index}`, JSON.stringify({
    modules: { crm: true },
    capabilities: { matrixSend: true }
  }), NOW);
  const bindingId = Number(db.prepare(`
    INSERT INTO matrix_actor_bindings (feishu_open_id,user_id,status,bound_by,bound_at)
    VALUES (?,?,'active',?,?)
  `).run(`ou-public-${index}`, actorUserId, actorUserId, NOW).lastInsertRowid);
  const workItemId = Number(db.prepare(`
    INSERT INTO matrix_work_items (
      candidate_id,stage,owner_user_id,current_summary,next_action,version,created_at,updated_at,stream_state
    ) VALUES (?,'selected',?,'','',1,?,?,'selected')
  `).run(9800 + index, actorUserId, NOW, NOW).lastInsertRowid);
  const sourceUrl = `https://${organizationDomain}/contact`;
  const recipient = {
    email,
    sourceUrl,
    verifiedAt: '2026-07-28T07:00:00.000Z',
    kind: 'public_company'
  };
  const sourceSnapshot = {
    organization_domain: organizationDomain,
    recipient_email: email,
    source_url: sourceUrl,
    country_code: 'MY',
    company,
    categories: ['spices'],
    products: ['spices', 'spice pouches', 'roll film'],
    entryProduct: 'spice pouch and roll film',
    supportedClaims: ['stable repeat printing'],
    evidenceIds: [1, 2, 3],
    recipient_provenance: {
      evidence_mode: 'official_public_mailbox',
      corroboration: {
        source_url: `https://authority.test/exhibitors/${index}`,
        source_class: 'official_exhibition',
        observed_at: '2026-07-28T07:10:00.000Z',
        email,
        organization_name: company,
        official_domain: organizationDomain,
        identity_matches: { phone: true, registration_number: true }
      }
    }
  };
  db.prepare(`
    INSERT INTO matrix_stream_recipient_evidence (
      work_item_id,organization_domain,recipient_email,source_url,verified_at,
      snapshot_json,status,created_by,created_at
    ) VALUES (?,?,?,?,?,?,'active',?,?)
  `).run(workItemId, organizationDomain, email, sourceUrl, recipient.verifiedAt,
    JSON.stringify(sourceSnapshot), actorUserId, NOW);
  const created = review.createInitialVersion(db, {
    actorUserId,
    workItemId,
    expectedWorkVersion: 1,
    recipient,
    subject: `Spice pouch and roll-film options for ${company}`,
    bodyEn: `Dear ${company} Team,\n\nWe reviewed your spices, including spice pouches and roll film.\n\nWe would like to discuss spice pouch and roll film options with stable repeat printing. Could you share a current specification or product photo?\n\nBest regards,\nGavin`,
    bodyCn: `您好，${company} 团队：\n\n我们查看了贵司的香辛料，包括香辛料袋和卷膜。\n\n我们希望沟通具有稳定套色的香辛料袋和卷膜方案。能否提供一份现有规格或产品图片？\n\n此致\nGavin`,
    strategySummary: 'official evidence reviewed',
    sourceSnapshot,
    idempotencyKey: `public-create-${index}`
  });
  const version = review.approveVersion(db, {
    actorUserId,
    workItemId,
    versionId: created.id,
    expectedWorkVersion: 2,
    expectedContentHash: created.content_hash,
    idempotencyKey: `public-approve-${index}`
  });
  return { actorUserId, bindingId, workItemId, version };
}

function confirmation(fixture, key) {
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
    assert.throws(() => validateRecipientProvenance({
      email: 'hockxeng@gmail.com',
      role: 'public company',
      source_url: 'https://hockxeng.com/contact-us/',
      verified_at: NOW,
      evidence_mode: 'official_public_mailbox',
      corroboration: {
        source_url: 'https://authority.test/hock-xeng',
        source_class: 'industry_association',
        observed_at: NOW,
        email: 'hockxeng@gmail.com',
        organization_name: 'Hock Xeng Sdn Bhd',
        official_domain: 'hockxeng.com',
        identity_matches: { phone: true }
      }
    }, {
      organizationDomain: 'hockxeng.com',
      organizationName: 'Hock Xeng Sdn Bhd',
      now: NOW
    }), /two corroborated identity fields/i);

    initDb();
    db.prepare(`
      INSERT INTO matrix_stream_sender_checks (
        sender_domain,checked_at,expires_at,spf_ok,dkim_ok,dmarc_ok,tls_ok,smtp_ok,detail_json
      ) VALUES ('sender.test','2026-07-28T07:00:00.000Z','2026-07-29T07:00:00.000Z',1,1,1,1,1,'{"selector":"selector"}')
    `).run();
    db.prepare(`
      INSERT INTO matrix_stream_country_policies (
        country_code,channel,status,sender_identity_required,opt_out_required,
        reviewed_by,reviewed_at,expires_at,source_urls_json
      ) VALUES ('MY','email','approved',1,1,1,'2026-07-28T07:00:00.000Z','2026-08-28T07:00:00.000Z','["https://authority.test/policy"]')
    `).run();
    const calls = [];
    const service = createMatrixStreamDelivery({
      db,
      fromAddress: 'sales@sender.test',
      messageIdDomain: 'sender.test',
      dkimSelector: 'selector',
      clock: () => new Date(NOW),
      transport: {
        sendMail: async mail => {
          calls.push(mail.to);
          return { accepted: [mail.to], rejected: [] };
        }
      }
    });

    const hock = seed(1, {
      organizationDomain: 'hockxeng.com',
      company: 'Hock Xeng Sdn Bhd',
      email: 'hockxeng@gmail.com'
    });
    assert.strictEqual((await service.confirm(confirmation(hock, 'hock'))).state, 'accepted');
    assert.strictEqual(db.prepare('SELECT recipient_domain FROM matrix_stream_jobs WHERE work_item_id=?')
      .get(hock.workItemId).recipient_domain, 'hockxeng.com');

    const other = seed(2, {
      organizationDomain: 'other-spice.test',
      company: 'Other Spice Sdn Bhd',
      email: 'other-spice@gmail.com'
    });
    assert.strictEqual((await service.confirm(confirmation(other, 'other'))).state, 'accepted');
    assert.strictEqual(calls.length, 2, 'different organizations using Gmail must not share cooling');

    const hockDuplicate = seed(3, {
      organizationDomain: 'hockxeng.com',
      company: 'Hock Xeng Sdn Bhd',
      email: 'hockxeng.sales@gmail.com'
    });
    await assert.rejects(
      () => service.confirm(confirmation(hockDuplicate, 'hock-duplicate')),
      /domain_cooling_90_days|domain.*cooling/i
    );
    assert.strictEqual(calls.length, 2, 'same organization remains cooling-bound');
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('matrix public mailbox tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

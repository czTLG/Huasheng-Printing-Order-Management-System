const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-stream-review-'));
process.env.DB_PATH = path.join(root, 'app.db');

async function main() {
let db;

try {
  const LegacyDatabase = require('better-sqlite3');
  const legacyDb = new LegacyDatabase(process.env.DB_PATH);
  legacyDb.exec(`
    CREATE TABLE matrix_stream_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_item_id INTEGER NOT NULL,
      crm_draft_id INTEGER,
      revision INTEGER NOT NULL,
      recipient_email TEXT NOT NULL,
      recipient_source_url TEXT NOT NULL,
      recipient_verified_at TEXT NOT NULL,
      subject TEXT NOT NULL,
      body_en TEXT NOT NULL,
      body_cn TEXT NOT NULL,
      strategy_summary TEXT NOT NULL DEFAULT '',
      source_snapshot_json TEXT NOT NULL DEFAULT '{}',
      content_hash TEXT NOT NULL,
      quality_score INTEGER NOT NULL DEFAULT 0,
      quality_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL CHECK(status IN ('draft','approved','superseded')),
      created_by INTEGER NOT NULL,
      approved_by INTEGER,
      approved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(work_item_id, revision)
    );
    CREATE TRIGGER trg_matrix_stream_versions_approved_content_immutable
    BEFORE UPDATE ON matrix_stream_versions
    WHEN OLD.status = 'approved' AND NEW.subject IS NOT OLD.subject
    BEGIN
      SELECT RAISE(ABORT, 'approved matrix_stream_versions content is immutable');
    END;
  `);
  legacyDb.close();

  const database = require('../src/db');
  db = database.db;
  const originalConsoleLog = console.log;
  console.log = () => {};
  try {
    database.initDb();
  } finally {
    console.log = originalConsoleLog;
  }

  for (const table of ['matrix_stream_versions', 'matrix_stream_jobs', 'matrix_stream_events', 'matrix_stream_recipient_evidence', 'matrix_stream_reply_checks']) {
    assert(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), `${table} missing`);
  }

  const workColumns = db.prepare('PRAGMA table_info(matrix_work_items)').all().map(row => row.name);
  assert(workColumns.includes('stream_state'));
  assert(workColumns.includes('current_stream_version_id'));

  const draftColumns = db.prepare('PRAGMA table_info(crm_reply_drafts)').all().map(row => row.name);
  assert(draftColumns.includes('matrix_work_item_id'));
  const versionColumns = db.prepare('PRAGMA table_info(matrix_stream_versions)').all().map(row => row.name);
  assert(versionColumns.includes('recipient_evidence_id'));

  const indexColumns = indexName => db.prepare(`PRAGMA index_info(${indexName})`).all().map(row => row.name);
  assert.deepStrictEqual(indexColumns('idx_matrix_stream_versions_work_revision'), ['work_item_id', 'revision']);
  assert.deepStrictEqual(indexColumns('idx_matrix_stream_jobs_state_updated'), ['state', 'updated_at']);
  assert.deepStrictEqual(indexColumns('idx_matrix_stream_jobs_message_id'), ['message_id']);
  assert.deepStrictEqual(indexColumns('idx_matrix_stream_reply_checks_due'), ['state', 'due_at']);

  const now = '2026-07-18T00:00:00.000Z';
  const userId = Number(db.prepare(`
    INSERT INTO users (username, password, role, status, created_at)
    VALUES ('matrix_stream_review_guard', 'unused', 'super_admin', 'active', ?)
  `).run(now).lastInsertRowid);
  const review = require('../src/services/matrixStreamReview');
  const insertRecipientEvidence = ({ workItemId, domain, email, sourceUrl, verifiedAt, snapshot = {} }) => Number(db.prepare(`
    INSERT INTO matrix_stream_recipient_evidence (
      work_item_id, organization_domain, recipient_email, source_url,
      verified_at, snapshot_json, status, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(workItemId, domain, email, sourceUrl, verifiedAt, JSON.stringify(snapshot), userId, now).lastInsertRowid);
  assert.throws(
    () => review.validateRecipient({ email: 'guessed@person.test', sourceUrl: '', verifiedAt: '' }, new Date('2026-07-17T00:00:00Z')),
    /source/i
  );
  const reviewWorkItemId = Number(db.prepare(`
    INSERT INTO matrix_work_items (candidate_id, owner_user_id, created_at, updated_at)
    VALUES (900000, ?, ?, ?)
  `).run(userId, now, now).lastInsertRowid);
  insertRecipientEvidence({
    workItemId: reviewWorkItemId,
    domain: 'alpha.test',
    email: 'sales@alpha.test',
    sourceUrl: 'https://alpha.test/contact',
    verifiedAt: '2026-07-16T00:00:00.000Z',
    snapshot: {
      organization_domain: 'alpha.test',
      recipient_email: 'sales@alpha.test',
      source_url: 'https://alpha.test/contact',
      pages: ['https://alpha.test/contact', 'https://alpha.test/products']
    }
  });
  const unverifiedWorkItemId = Number(db.prepare(`
    INSERT INTO matrix_work_items (candidate_id, owner_user_id, created_at, updated_at)
    VALUES (899998, ?, ?, ?)
  `).run(userId, now, now).lastInsertRowid);
  insertRecipientEvidence({
    workItemId: unverifiedWorkItemId,
    domain: 'alpha.test',
    email: 'guessed@person.test',
    sourceUrl: 'https://unrelated.test/contact',
    verifiedAt: '2026-07-16T00:00:00.000Z',
    snapshot: {
      organization_domain: 'alpha.test',
      recipient_email: 'guessed@person.test',
      source_url: 'https://unrelated.test/contact'
    }
  });
  assert.throws(() => review.createInitialVersion(db, {
    actorUserId: userId,
    workItemId: unverifiedWorkItemId,
    expectedWorkVersion: 1,
    recipient: {
      email: 'guessed@person.test',
      sourceUrl: 'https://unrelated.test/contact',
      verifiedAt: '2026-07-16T00:00:00Z',
      kind: 'public_company'
    },
    subject: 'Unsafe self-attested recipient',
    bodyEn: 'Hello',
    bodyCn: '您好',
    sourceSnapshot: { url: 'https://unrelated.test/contact' },
    idempotencyKey: 'unverified-create'
  }), /evidence|binding/i);
  const createDomainFixture = ({ candidateId, domain, email, sourceUrl, key }) => {
    const scopedWorkItemId = Number(db.prepare(`
      INSERT INTO matrix_work_items (candidate_id, owner_user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(candidateId, userId, now, now).lastInsertRowid);
    insertRecipientEvidence({
      workItemId: scopedWorkItemId,
      domain,
      email,
      sourceUrl,
      verifiedAt: '2026-07-16T00:00:00.000Z',
      snapshot: {
        organization_domain: domain,
        recipient_email: email,
        source_url: sourceUrl
      }
    });
    return {
      actorUserId: userId,
      workItemId: scopedWorkItemId,
      expectedWorkVersion: 1,
      recipient: { email, sourceUrl, verifiedAt: '2026-07-16T00:00:00Z', kind: 'public_company' },
      subject: 'Registrable domain check',
      bodyEn: 'Dear team, please confirm your requirements.',
      bodyCn: '您好，请确认需求。',
      idempotencyKey: key
    };
  };
  assert.throws(() => review.createInitialVersion(db, createDomainFixture({
    candidateId: 899996,
    domain: 'test',
    email: 'guessed@person.test',
    sourceUrl: 'https://unrelated.test/contact',
    key: 'public-suffix-test-create'
  })), /registrable|evidence|binding/i);
  assert.throws(() => review.createInitialVersion(db, createDomainFixture({
    candidateId: 899995,
    domain: 'co.uk',
    email: 'sales@person.co.uk',
    sourceUrl: 'https://unrelated.co.uk/contact',
    key: 'public-suffix-couk-create'
  })), /registrable|evidence|binding/i);
  assert.throws(() => review.createInitialVersion(db, createDomainFixture({
    candidateId: 899994,
    domain: 'com.cn',
    email: 'sales@person.com.cn',
    sourceUrl: 'https://unrelated.com.cn/contact',
    key: 'public-suffix-comcn-create'
  })), /registrable|evidence|binding/i);
  assert.throws(() => review.createInitialVersion(db, createDomainFixture({
    candidateId: 899992,
    domain: 'alpha.invalidtld',
    email: 'sales@alpha.invalidtld',
    sourceUrl: 'https://alpha.invalidtld/contact',
    key: 'unknown-tld-create'
  })), /registrable|evidence|binding/i);
  assert.throws(() => review.createInitialVersion(db, createDomainFixture({
    candidateId: 899991,
    domain: 'workers.dev',
    email: 'sales@tenant-a.workers.dev',
    sourceUrl: 'https://tenant-b.workers.dev/contact',
    key: 'private-workers-create'
  })), /registrable|evidence|binding/i);
  assert.throws(() => review.createInitialVersion(db, createDomainFixture({
    candidateId: 899990,
    domain: 'onrender.com',
    email: 'sales@tenant-a.onrender.com',
    sourceUrl: 'https://tenant-b.onrender.com/contact',
    key: 'private-onrender-create'
  })), /registrable|evidence|binding/i);
  assert.throws(() => review.createInitialVersion(db, createDomainFixture({
    candidateId: 899989,
    domain: 'foo.ck',
    email: 'sales@tenant-a.foo.ck',
    sourceUrl: 'https://tenant-b.foo.ck/contact',
    key: 'wildcard-ck-create'
  })), /registrable|evidence|binding/i);
  const validPslExceptionDomain = review.createInitialVersion(db, createDomainFixture({
    candidateId: 899988,
    domain: 'www.ck',
    email: 'sales@mail.www.ck',
    sourceUrl: 'https://official.www.ck/contact',
    key: 'exception-www-ck-create'
  }));
  assert.strictEqual(validPslExceptionDomain.recipient_email, 'sales@mail.www.ck');
  const validMultiLevelDomain = review.createInitialVersion(db, createDomainFixture({
    candidateId: 899993,
    domain: 'alpha.co.uk',
    email: 'sales@mail.alpha.co.uk',
    sourceUrl: 'https://official.alpha.co.uk/contact',
    key: 'registrable-couk-create'
  }));
  assert.strictEqual(validMultiLevelDomain.recipient_email, 'sales@mail.alpha.co.uk');
  const v1 = review.createInitialVersion(db, {
    actorUserId: userId,
    workItemId: reviewWorkItemId,
    expectedWorkVersion: 1,
    recipient: {
      email: 'sales@alpha.test',
      sourceUrl: 'https://alpha.test/contact',
      verifiedAt: '2026-07-16T00:00:00Z',
      kind: 'public_company'
    },
    subject: 'A focused proposal for Alpha',
    bodyEn: 'Dear Alpha team,\nPlease confirm your current requirements.\nBest regards',
    bodyCn: '您好，请确认当前需求。',
    strategySummary: '公开产品页显示匹配品类',
    sourceSnapshot: { url: 'https://alpha.test/products' },
    idempotencyKey: 'version-create-1'
  });
  assert.strictEqual(v1.revision, 1);
  assert.notStrictEqual(v1.quality_json, '{}');
  assert.strictEqual(v1.quality_score, JSON.parse(v1.quality_json).score);
  assert.ok(v1.quality_score < 80);
  const { createMatrixStreamText } = require('../src/services/matrixStreamText');
  const textService = createMatrixStreamText({
    callJson: async () => ({
      subject: 'Short proposal for Alpha',
      body_en: 'Dear Alpha team,\nCould you share annual volume?\nBest regards',
      body_cn: '您好，请问能否提供年用量？'
    })
  });
  const revisedText = await textService.revise({ current: v1, instruction: '语气更简洁，询问年用量' });
  assert.strictEqual(revisedText.subject, 'Short proposal for Alpha');
  assert.match(revisedText.body_en, /annual volume/i);
  assert.match(revisedText.body_cn, /年用量/);
  await assert.rejects(
    () => createMatrixStreamText({ callJson: async () => ({ body_en: 'missing fields' }) })
      .revise({ current: v1, instruction: '简化' }),
    /invalid bilingual output/i
  );
  await assert.rejects(
    () => createMatrixStreamText({
      callJson: async () => ({
        subject: 'Short proposal', body_en: 'Hello', body_cn: '您好', extra: 'not allowed'
      })
    }).revise({ current: v1, instruction: '简化' }),
    /invalid bilingual output/i
  );
  await assert.rejects(
    () => createMatrixStreamText({
      callJson: async () => ({
        subject: 'Short proposal', body_en: 'See https://unknown.test', body_cn: '请查看链接'
      })
    }).revise({ current: v1, instruction: '增加链接' }),
    /introduced URL/i
  );
  await assert.rejects(
    () => createMatrixStreamText({
      callJson: async () => ({
        subject: 'Short proposal', body_en: 'The price is USD 99.', body_cn: '价格为99美元。'
      })
    }).revise({ current: v1, instruction: '增加价格' }),
    /unsupported price/i
  );
  await assert.rejects(
    () => createMatrixStreamText({
      callJson: async () => ({
        subject: 'Certified supplier', body_en: 'We are ISO certified.', body_cn: '我们已通过认证。'
      })
    }).revise({ current: v1, instruction: '增加资质' }),
    /unsupported qualification/i
  );
  for (const priceClaim of ['99美元', '99元', '美元99']) {
    await assert.rejects(
      () => createMatrixStreamText({
        callJson: async () => ({
          subject: 'Short proposal', body_en: 'Hello Alpha team.', body_cn: `建议价格为${priceClaim}。`
        })
      }).revise({ current: v1, instruction: '增加中文价格' }),
      /unsupported price/i,
      `${priceClaim} must require evidence`
    );
  }
  for (const qualificationClaim of ['欧盟认证', 'ISO 22000认证', '食品级资质']) {
    await assert.rejects(
      () => createMatrixStreamText({
        callJson: async () => ({
          subject: 'Short proposal', body_en: 'Hello Alpha team.', body_cn: `该产品具备${qualificationClaim}。`
        })
      }).revise({ current: v1, instruction: '增加中文资质' }),
      /unsupported qualification/i,
      `${qualificationClaim} must require evidence`
    );
  }
  for (const unsupportedClaim of [
    '单价为99。', '单价为九十九元。', '售价为99。', '售价为九十九。', '售价大约为99。',
    '材料符合食品级要求。', '产品已通过认证。', '产品符合RoHS合规规范。',
    '产品满足REACH要求。', '产品合规。'
  ]) {
    await assert.rejects(
      () => createMatrixStreamText({
        callJson: async () => ({
          subject: 'Short proposal', body_en: 'Hello Alpha team.', body_cn: unsupportedClaim
        })
      }).revise({ current: v1, instruction: '增加声明' }),
      /unsupported (?:price|qualification)/i,
      `${unsupportedClaim} must require exact evidence`
    );
  }
  await assert.rejects(
    () => createMatrixStreamText({
      callJson: async () => ({
        subject: 'Short proposal', body_en: 'Hello Alpha team.', body_cn: '单价为99美元。'
      })
    }).revise({ current: v1, instruction: '增加价格', sourceSnapshot: { supportedClaims: ['199美元'] } }),
    /unsupported price/i,
    '199美元 must not support 99美元'
  );
  await assert.rejects(
    () => createMatrixStreamText({
      callJson: async () => ({
        subject: 'Short proposal', body_en: 'This product is RoHS compliant.', body_cn: '您好。'
      })
    }).revise({ current: v1, instruction: '增加合规声明' }),
    /unsupported qualification/i
  );
  await assert.rejects(
    () => createMatrixStreamText({
      callJson: async () => ({
        subject: 'Short proposal', body_en: 'This product is RoHS compliant.', body_cn: '您好。'
      })
    }).revise({ current: v1, instruction: '增加合规声明', sourceSnapshot: { supportedClaims: ['RoHSX compliant'] } }),
    /unsupported qualification/i,
    'RoHSX must not support RoHS'
  );
  const exactPriceEvidence = await createMatrixStreamText({
    callJson: async () => ({
      subject: 'Supported price', body_en: 'The supported price is USD 99.', body_cn: '证据价格为99美元。'
    })
  }).revise({
    current: v1,
    instruction: '使用已有价格',
    sourceSnapshot: { supportedClaims: ['Supported price', 'The supported price is USD 99.', '证据价格为99美元。'] }
  });
  assert.match(exactPriceEvidence.body_en, /99/);
  for (const unsupportedSemanticClaim of [
    '价格面议。', '报价待定。', '单价请询价。',
    '产品已通过Sedex审核。', '产品拥有XYZ许可证。'
  ]) {
    await assert.rejects(
      () => createMatrixStreamText({
        callJson: async () => ({
          subject: 'Short proposal', body_en: 'Hello Alpha team.', body_cn: unsupportedSemanticClaim
        })
      }).revise({ current: v1, instruction: '增加声明' }),
      /unsupported (?:price|qualification)/i,
      `${unsupportedSemanticClaim} must fail closed without evidence`
    );
  }
  for (const supportedSemanticClaim of ['价格面议。', '单价请询价。', '产品已通过Sedex审核。', '产品拥有XYZ许可证。']) {
    const supportedFallback = await createMatrixStreamText({
      callJson: async () => ({
        subject: 'Evidence-bound statement', body_en: 'Hello Alpha team.', body_cn: supportedSemanticClaim
      })
    }).revise({
      current: v1,
      instruction: '使用相同证据声明',
      sourceSnapshot: { supportedClaims: [supportedSemanticClaim] }
    });
    assert.strictEqual(supportedFallback.body_cn, supportedSemanticClaim);
  }
  for (const sentenceLevelClaim of [
    '价格免费。', '本项目无需费用。', '产品已获Sedex认可。',
    '产品获得Acme批准。', '材料达到Acme规范。', '是否已通过Sedex审核？',
    '价格是99？', '价格为99美元？', 'The price is USD 99?', '单价请询价？',
    'Please note our price is USD 99.', 'Please confirm it is USD 99.'
  ]) {
    await assert.rejects(
      () => createMatrixStreamText({
        callJson: async () => ({
          subject: 'Sentence guard', body_en: 'Hello Alpha team.', body_cn: sentenceLevelClaim
        })
      }).revise({ current: v1, instruction: '增加敏感语义' }),
      /unsupported (?:price|qualification)/i,
      `${sentenceLevelClaim} must require sentence evidence`
    );
  }
  for (const sentenceLevelEvidence of ['价格免费。', '本项目无需费用。', '产品已获Sedex认可。']) {
    const acceptedSentence = await createMatrixStreamText({
      callJson: async () => ({
        subject: 'Sentence evidence', body_en: 'Hello Alpha team.', body_cn: sentenceLevelEvidence
      })
    }).revise({
      current: v1,
      instruction: '使用整句证据',
      sourceSnapshot: { supportedClaims: [sentenceLevelEvidence] }
    });
    assert.strictEqual(acceptedSentence.body_cn, sentenceLevelEvidence);
  }
  for (const allowedQuestion of [
    '请提供报价。', '烦请告知报价。', '能否提供报价？', '可否确认费用？',
    '是否有Sedex认证？', '贵司是否有Sedex认证？', 'Could you quote this item?',
    'Please provide a quote.', 'What is the price?'
  ]) {
    const acceptedQuestion = await createMatrixStreamText({
      callJson: async () => ({
        subject: 'Question only', body_en: 'Hello Alpha team.', body_cn: allowedQuestion
      })
    }).revise({ current: v1, instruction: '提出非断言问题' });
    assert.strictEqual(acceptedQuestion.body_cn, allowedQuestion);
  }
  const reasonableNumbers = await createMatrixStreamText({
    callJson: async () => ({
      subject: 'Dimension follow-up',
      body_en: 'Please confirm the 250 mm width for the 2026-07-18 review.',
      body_cn: '请确认250mm宽度，参考日期为2026-07-18。'
    })
  }).revise({ current: v1, instruction: '补充尺寸和日期' });
  assert.match(reasonableNumbers.body_cn, /250mm/);
  const translated = await createMatrixStreamText({
    callJson: async () => ({
      translation_cn: '请提供报价。',
      requirements_cn: '需要报价',
      suggested_subject: 'Re: Alpha requirements',
      suggested_body_en: 'Dear Alpha team,\nThank you for your message.',
      suggested_body_cn: '您好，感谢您的来信。'
    })
  }).translateInbound({
    inboundText: 'Please provide a proposal.',
    sourceSnapshot: { supportedClaims: ['需要报价'] }
  });
  assert.deepStrictEqual(Object.keys(translated).sort(), [
    'requirements_cn', 'suggested_body_cn', 'suggested_body_en', 'suggested_subject', 'translation_cn'
  ]);
  const previousTextProvider = process.env.MATRIX_TEXT_PROVIDER;
  process.env.MATRIX_TEXT_PROVIDER = 'mock';
  const versionCountBeforeUnavailable = db.prepare('SELECT COUNT(*) AS count FROM matrix_stream_versions').get().count;
  const unavailable = await createMatrixStreamText().revise({ current: v1, instruction: '简化' });
  assert.deepStrictEqual({ ok: unavailable.ok, reason: unavailable.reason }, { ok: false, reason: 'text_provider_unavailable' });
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM matrix_stream_versions').get().count, versionCountBeforeUnavailable);
  if (previousTextProvider === undefined) delete process.env.MATRIX_TEXT_PROVIDER;
  else process.env.MATRIX_TEXT_PROVIDER = previousTextProvider;
  const staleEvidenceWorkItemId = Number(db.prepare(`
    INSERT INTO matrix_work_items (candidate_id, owner_user_id, created_at, updated_at)
    VALUES (899999, ?, ?, ?)
  `).run(userId, now, now).lastInsertRowid);
  const staleEvidenceId = insertRecipientEvidence({
    workItemId: staleEvidenceWorkItemId,
    domain: 'stale.test',
    email: 'public@stale.test',
    sourceUrl: 'https://stale.test/contact',
    verifiedAt: '2026-07-16T00:00:00.000Z',
    snapshot: {
      organization_domain: 'stale.test',
      recipient_email: 'public@stale.test',
      source_url: 'https://stale.test/contact'
    }
  });
  const staleEvidenceDraft = review.createInitialVersion(db, {
    actorUserId: userId,
    workItemId: staleEvidenceWorkItemId,
    expectedWorkVersion: 1,
    recipient: {
      email: 'public@stale.test',
      sourceUrl: 'https://stale.test/contact',
      verifiedAt: '2026-07-16T00:00:00Z',
      kind: 'public_company'
    },
    subject: 'Evidence freshness check',
    bodyEn: 'Dear team,\nPlease confirm your requirements.',
    bodyCn: '您好，请确认需求。',
    sourceSnapshot: { url: 'https://stale.test/contact' },
    idempotencyKey: 'stale-evidence-create'
  });
  db.prepare("UPDATE matrix_stream_recipient_evidence SET status = 'revoked' WHERE id = ?").run(staleEvidenceId);
  assert.throws(() => review.approveVersion(db, {
    actorUserId: userId,
    workItemId: staleEvidenceWorkItemId,
    versionId: staleEvidenceDraft.id,
    expectedWorkVersion: 2,
    expectedContentHash: staleEvidenceDraft.content_hash,
    idempotencyKey: 'stale-evidence-approve'
  }), /evidence|binding/i);
  const tamperedWorkItemId = Number(db.prepare(`
    INSERT INTO matrix_work_items (candidate_id, owner_user_id, created_at, updated_at)
    VALUES (899997, ?, ?, ?)
  `).run(userId, now, now).lastInsertRowid);
  insertRecipientEvidence({
    workItemId: tamperedWorkItemId,
    domain: 'tamper.test',
    email: 'public@tamper.test',
    sourceUrl: 'https://tamper.test/contact',
    verifiedAt: '2026-07-16T00:00:00.000Z',
    snapshot: {
      organization_domain: 'tamper.test',
      recipient_email: 'public@tamper.test',
      source_url: 'https://tamper.test/contact'
    }
  });
  const tamperedDraft = review.createInitialVersion(db, {
    actorUserId: userId,
    workItemId: tamperedWorkItemId,
    expectedWorkVersion: 1,
    recipient: {
      email: 'public@tamper.test',
      sourceUrl: 'https://tamper.test/contact',
      verifiedAt: '2026-07-16T00:00:00Z',
      kind: 'public_company'
    },
    subject: 'Canonical approval hash',
    bodyEn: 'Original English body',
    bodyCn: '原始中文正文',
    idempotencyKey: 'tampered-create'
  });
  db.exec('DROP TRIGGER IF EXISTS trg_matrix_stream_versions_content_immutable');
  try {
    db.prepare('UPDATE matrix_stream_versions SET body_en = ? WHERE id = ?')
      .run('Tampered body without a new hash', tamperedDraft.id);
    assert.throws(() => review.approveVersion(db, {
      actorUserId: userId,
      workItemId: tamperedWorkItemId,
      versionId: tamperedDraft.id,
      expectedWorkVersion: 2,
      expectedContentHash: tamperedDraft.content_hash,
      idempotencyKey: 'tampered-approve'
    }), /content hash/i);
  } finally {
    database.initDb();
  }
  const approved = review.approveVersion(db, {
    actorUserId: userId,
    workItemId: reviewWorkItemId,
    versionId: v1.id,
    expectedWorkVersion: 2,
    expectedContentHash: v1.content_hash,
    idempotencyKey: 'approve-1'
  });
  assert.strictEqual(approved.status, 'approved');
  const blockedPreview = review.finalPreview(db, { actorUserId: userId, versionId: v1.id });
  assert.strictEqual(blockedPreview.allowed, false);
  assert.ok(blockedPreview.reasons.includes('quality_score_below_80'));
  assert.throws(() => review.confirmFinalGate(db, { actorUserId: userId, versionId: v1.id }), /quality/i);
  const v2 = review.reviseVersion(db, {
    actorUserId: userId,
    workItemId: reviewWorkItemId,
    baseVersionId: v1.id,
    expectedWorkVersion: 3,
    subject: v1.subject,
    bodyEn: `${v1.body_en}\nPlease share annual volume.`,
    bodyCn: `${v1.body_cn}\n请提供年用量。`,
    idempotencyKey: 'revise-1'
  });
  assert.strictEqual(v2.revision, 2);
  assert.notStrictEqual(v2.quality_json, '{}');
  assert.strictEqual(v2.quality_score, JSON.parse(v2.quality_json).score);
  assert.ok(!JSON.parse(v2.quality_json).hardFailures.includes('invalid_recipient_provenance'));
  assert.strictEqual(review.getVersion(db, { actorUserId: userId, versionId: v1.id }).status, 'superseded');
  const approveReplayInput = {
    actorUserId: userId,
    workItemId: reviewWorkItemId,
    versionId: v1.id,
    expectedWorkVersion: 2,
    expectedContentHash: v1.content_hash,
    idempotencyKey: 'approve-1'
  };
  const approvedReplay = review.approveVersion(db, approveReplayInput);
  assert.strictEqual(approvedReplay.id, v1.id);
  assert.strictEqual(approvedReplay.status, 'approved');
  assert.strictEqual(approvedReplay.current_status, 'superseded');
  const createReplayInput = {
    actorUserId: userId,
    workItemId: reviewWorkItemId,
    expectedWorkVersion: 1,
    recipient: {
      email: 'sales@alpha.test',
      sourceUrl: 'https://alpha.test/contact',
      verifiedAt: '2026-07-16T00:00:00Z',
      kind: 'public_company'
    },
    subject: 'A focused proposal for Alpha',
    bodyEn: 'Dear Alpha team,\nPlease confirm your current requirements.\nBest regards',
    bodyCn: '您好，请确认当前需求。',
    strategySummary: '公开产品页显示匹配品类',
    sourceSnapshot: { url: 'https://alpha.test/products' },
    idempotencyKey: 'version-create-1'
  };
  const createReplay = review.createInitialVersion(db, createReplayInput);
  assert.strictEqual(createReplay.id, v1.id);
  assert.strictEqual(createReplay.status, 'draft');
  assert.strictEqual(createReplay.current_status, 'superseded');
  assert.throws(() => review.approveVersion(db, {
    ...approveReplayInput,
    expectedContentHash: 'changed-hash'
  }), /idempotency|fingerprint|scope/i);
  assert.throws(() => review.approveVersion(db, {
    ...approveReplayInput,
    expectedWorkVersion: 3
  }), /idempotency|fingerprint|scope/i);
  assert.throws(() => review.approveVersion(db, {
    ...approveReplayInput,
    versionId: v2.id
  }), /idempotency|fingerprint|scope/i);
  assert.throws(() => review.createInitialVersion(db, {
    ...createReplayInput,
    workItemId: unverifiedWorkItemId
  }), /idempotency|fingerprint|scope|authorized/i);
  assert.throws(() => review.reviseVersion(db, {
    actorUserId: userId,
    workItemId: reviewWorkItemId,
    baseVersionId: v1.id,
    expectedWorkVersion: 3,
    subject: v1.subject,
    bodyEn: v1.body_en,
    bodyCn: v1.body_cn,
    idempotencyKey: 'approve-1'
  }), /idempotency|fingerprint|scope/i);
  db.prepare("UPDATE matrix_work_items SET stage = 'suppressed', stream_state = 'suppressed' WHERE id = ?").run(reviewWorkItemId);
  assert.throws(() => review.approveVersion(db, approveReplayInput), /suppressed/i);
  db.prepare("UPDATE matrix_work_items SET stage = 'draft_pending', stream_state = 'draft_pending' WHERE id = ?").run(reviewWorkItemId);
  db.prepare("UPDATE users SET status = 'inactive' WHERE id = ?").run(userId);
  assert.throws(() => review.approveVersion(db, approveReplayInput), /active/i);
  db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(userId);
  const replacementOwnerId = Number(db.prepare(`
    INSERT INTO users (username, password, role, status, created_at)
    VALUES ('matrix_stream_replacement_owner', 'unused', 'super_admin', 'active', ?)
  `).run(now).lastInsertRowid);
  db.prepare('UPDATE matrix_work_items SET owner_user_id = ? WHERE id = ?').run(replacementOwnerId, reviewWorkItemId);
  assert.throws(() => review.approveVersion(db, approveReplayInput), /authorized/i);
  db.prepare('UPDATE matrix_work_items SET owner_user_id = ? WHERE id = ?').run(userId, reviewWorkItemId);
  const reviseReplayInput = {
    actorUserId: userId,
    workItemId: reviewWorkItemId,
    baseVersionId: v1.id,
    expectedWorkVersion: 3,
    subject: v1.subject,
    bodyEn: `${v1.body_en}\nPlease share annual volume.`,
    bodyCn: `${v1.body_cn}\n请提供年用量。`,
    idempotencyKey: 'revise-1'
  };
  const reviseReplay = review.reviseVersion(db, reviseReplayInput);
  assert.strictEqual(reviseReplay.id, v2.id);
  assert.strictEqual(reviseReplay.status, 'draft');
  assert.strictEqual(reviseReplay.current_status, 'draft');
  assert.throws(() => review.reviseVersion(db, {
    ...reviseReplayInput,
    bodyEn: `${reviseReplayInput.bodyEn}\nChanged replay content.`
  }), /idempotency|fingerprint|scope/i);
  assert.throws(() => review.reviseVersion(db, {
    ...reviseReplayInput,
    baseVersionId: v2.id
  }), /idempotency|fingerprint|scope/i);
  assert.throws(() => review.reviseVersion(db, {
    actorUserId: userId,
    workItemId: reviewWorkItemId,
    baseVersionId: v2.id,
    expectedWorkVersion: 3,
    subject: v2.subject,
    bodyEn: v2.body_en,
    bodyCn: v2.body_cn,
    idempotencyKey: 'stale-revise'
  }), /stale/i);
  const hashInput = {
    recipientEmail: v2.recipient_email,
    recipientSourceUrl: v2.recipient_source_url,
    subject: v2.subject,
    bodyEn: v2.body_en,
    bodyCn: v2.body_cn
  };
  for (const [key, value] of Object.entries({
    recipientEmail: 'other@alpha.test',
    recipientSourceUrl: 'https://alpha.test/other',
    subject: `${v2.subject}!`,
    bodyEn: `${v2.body_en}!`,
    bodyCn: `${v2.body_cn}！`
  })) {
    assert.notStrictEqual(review.contentHash({ ...hashInput, [key]: value }), v2.content_hash, `${key} must change hash`);
  }
  const v3 = review.reviseVersion(db, {
    actorUserId: userId,
    workItemId: reviewWorkItemId,
    baseVersionId: v2.id,
    expectedWorkVersion: 4,
    subject: v2.subject,
    bodyEn: `${v2.body_en}\nWhat is your timeline?`,
    bodyCn: `${v2.body_cn}\n项目时间如何？`,
    idempotencyKey: 'revise-concurrent-winner'
  });
  assert.strictEqual(v3.revision, 3);
  const revisedAfterSupersessionReplay = review.reviseVersion(db, reviseReplayInput);
  assert.strictEqual(revisedAfterSupersessionReplay.status, 'draft');
  assert.strictEqual(revisedAfterSupersessionReplay.current_status, 'superseded');
  assert.throws(
    () => db.prepare('UPDATE matrix_stream_versions SET subject = ? WHERE id = ?').run('Forbidden in-place edit', v3.id),
    /immutable/i
  );
  assert.throws(
    () => db.prepare('DELETE FROM matrix_stream_versions WHERE id = ?').run(v3.id),
    /immutable/i
  );
  assert.throws(
    () => db.prepare('UPDATE matrix_stream_recipient_evidence SET source_url = ? WHERE work_item_id = ?')
      .run('https://other.test/contact', reviewWorkItemId),
    /immutable/i
  );
  assert.throws(() => review.reviseVersion(db, {
    actorUserId: userId,
    workItemId: reviewWorkItemId,
    baseVersionId: v2.id,
    expectedWorkVersion: 4,
    subject: v2.subject,
    bodyEn: `${v2.body_en}\nConcurrent loser`,
    bodyCn: `${v2.body_cn}\n并发失败`,
    idempotencyKey: 'revise-concurrent-loser'
  }), /stale/i);
  assert.strictEqual(
    db.prepare("SELECT COUNT(*) AS count FROM matrix_stream_events WHERE idempotency_key = 'revise-concurrent-loser'").get().count,
    0
  );
  const workItemId = Number(db.prepare(`
    INSERT INTO matrix_work_items (candidate_id, owner_user_id, created_at, updated_at)
    VALUES (900001, ?, ?, ?)
  `).run(userId, now, now).lastInsertRowid);

  const insertVersion = db.prepare(`
    INSERT INTO matrix_stream_versions (
      work_item_id, revision, recipient_email, recipient_source_url,
      recipient_verified_at, subject, body_en, body_cn, content_hash,
      status, created_by, approved_by, approved_at, created_at, updated_at
    ) VALUES (?, ?, ?, 'https://example.test/source', ?, ?, 'Body EN', '正文', ?, ?, ?, ?, ?, ?, ?)
  `);
  const approvedVersionId = Number(insertVersion.run(
    workItemId, 1, 'recipient@example.test', now, 'Approved subject',
    'approved-hash', 'approved', userId, userId, now, now, now
  ).lastInsertRowid);
  const supersededVersionId = Number(insertVersion.run(
    workItemId, 2, 'recipient@example.test', now, 'Superseded subject',
    'superseded-hash', 'approved', userId, userId, now, now, now
  ).lastInsertRowid);

  assert.throws(
    () => db.prepare('UPDATE matrix_stream_versions SET subject=? WHERE id=?').run('Changed', approvedVersionId),
    /immutable/
  );
  assert.throws(
    () => db.prepare("UPDATE matrix_stream_versions SET status='draft' WHERE id=?").run(approvedVersionId),
    /lifecycle/
  );
  db.prepare("UPDATE matrix_stream_versions SET status='superseded', updated_at=? WHERE id=?").run(now, supersededVersionId);
  assert.throws(
    () => db.prepare('UPDATE matrix_stream_versions SET body_en=? WHERE id=?').run('Changed after supersession', supersededVersionId),
    /immutable/
  );
  assert.throws(
    () => db.prepare('DELETE FROM matrix_stream_versions WHERE id=?').run(supersededVersionId),
    /immutable/
  );
  assert.throws(
    () => db.prepare("UPDATE matrix_stream_versions SET status='draft' WHERE id=?").run(supersededVersionId),
    /lifecycle/
  );
  assert.throws(
    () => db.prepare('DELETE FROM matrix_stream_versions WHERE id=?').run(approvedVersionId),
    /immutable/
  );

  assert.throws(
    () => insertVersion.run(
      workItemId, 1, 'duplicate@example.test', now, 'Duplicate revision',
      'duplicate-hash', 'draft', userId, null, null, now, now
    ),
    /UNIQUE constraint failed: matrix_stream_versions.work_item_id, matrix_stream_versions.revision/
  );

  const eventId = Number(db.prepare(`
    INSERT INTO matrix_stream_events (work_item_id, version_id, action, idempotency_key, created_at)
    VALUES (?, ?, 'approved', 'event-key-1', ?)
  `).run(workItemId, approvedVersionId, now).lastInsertRowid);
  assert.throws(
    () => db.prepare(`
      INSERT INTO matrix_stream_events (work_item_id, version_id, action, idempotency_key, created_at)
      VALUES (?, ?, 'duplicate', 'event-key-1', ?)
    `).run(workItemId, approvedVersionId, now),
    /UNIQUE constraint failed: matrix_stream_events.idempotency_key/
  );
  assert.throws(
    () => db.prepare('UPDATE matrix_stream_events SET action=? WHERE id=?').run('changed', eventId),
    /append-only/
  );
  assert.throws(
    () => db.prepare('DELETE FROM matrix_stream_events WHERE id=?').run(eventId),
    /append-only/
  );

  const insertJob = db.prepare(`
    INSERT INTO matrix_stream_jobs (
      work_item_id, version_id, idempotency_key, content_hash, message_id,
      state, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `);
  insertJob.run(workItemId, approvedVersionId, 'job-key-1', 'approved-hash', 'message-1', userId, now, now);
  assert.throws(
    () => insertJob.run(workItemId, approvedVersionId, 'job-key-1', 'approved-hash', 'message-2', userId, now, now),
    /UNIQUE constraint failed: matrix_stream_jobs.idempotency_key/
  );
  assert.throws(
    () => insertJob.run(workItemId, approvedVersionId, 'job-key-2', 'approved-hash', 'message-1', userId, now, now),
    /UNIQUE constraint failed: matrix_stream_jobs.message_id/
  );
  console.log('matrix stream review tests passed');
} finally {
  if (db?.open) db.close();
  fs.rmSync(root, { recursive: true, force: true });
}
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

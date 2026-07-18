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

  for (const table of ['matrix_stream_versions', 'matrix_stream_jobs', 'matrix_stream_events']) {
    assert(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), `${table} missing`);
  }

  const workColumns = db.prepare('PRAGMA table_info(matrix_work_items)').all().map(row => row.name);
  assert(workColumns.includes('stream_state'));
  assert(workColumns.includes('current_stream_version_id'));

  const draftColumns = db.prepare('PRAGMA table_info(crm_reply_drafts)').all().map(row => row.name);
  assert(draftColumns.includes('matrix_work_item_id'));

  const indexColumns = indexName => db.prepare(`PRAGMA index_info(${indexName})`).all().map(row => row.name);
  assert.deepStrictEqual(indexColumns('idx_matrix_stream_versions_work_revision'), ['work_item_id', 'revision']);
  assert.deepStrictEqual(indexColumns('idx_matrix_stream_jobs_state_updated'), ['state', 'updated_at']);
  assert.deepStrictEqual(indexColumns('idx_matrix_stream_jobs_message_id'), ['message_id']);

  const now = '2026-07-18T00:00:00.000Z';
  const userId = Number(db.prepare(`
    INSERT INTO users (username, password, role, status, created_at)
    VALUES ('matrix_stream_review_guard', 'unused', 'super_admin', 'active', ?)
  `).run(now).lastInsertRowid);
  const review = require('../src/services/matrixStreamReview');
  assert.throws(
    () => review.validateRecipient({ email: 'guessed@person.test', sourceUrl: '', verifiedAt: '' }, new Date('2026-07-17T00:00:00Z')),
    /source/i
  );
  const reviewWorkItemId = Number(db.prepare(`
    INSERT INTO matrix_work_items (candidate_id, owner_user_id, created_at, updated_at)
    VALUES (900000, ?, ?, ?)
  `).run(userId, now, now).lastInsertRowid);
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
  const translated = await createMatrixStreamText({
    callJson: async () => ({
      translation_cn: '请提供报价。',
      requirements_cn: '需要报价',
      suggested_subject: 'Re: Alpha requirements',
      suggested_body_en: 'Dear Alpha team,\nThank you for your message.',
      suggested_body_cn: '您好，感谢您的来信。'
    })
  }).translateInbound({ inboundText: 'Please provide a proposal.' });
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
  db.prepare('UPDATE matrix_stream_versions SET recipient_verified_at = ? WHERE id = ?')
    .run('2020-01-01T00:00:00.000Z', staleEvidenceDraft.id);
  assert.throws(() => review.approveVersion(db, {
    actorUserId: userId,
    workItemId: staleEvidenceWorkItemId,
    versionId: staleEvidenceDraft.id,
    expectedWorkVersion: 2,
    expectedContentHash: staleEvidenceDraft.content_hash,
    idempotencyKey: 'stale-evidence-approve'
  }), /stale/i);
  const approved = review.approveVersion(db, {
    actorUserId: userId,
    workItemId: reviewWorkItemId,
    versionId: v1.id,
    expectedWorkVersion: 2,
    expectedContentHash: v1.content_hash,
    idempotencyKey: 'approve-1'
  });
  assert.strictEqual(approved.status, 'approved');
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
  assert.strictEqual(review.getVersion(db, { actorUserId: userId, versionId: v1.id }).status, 'superseded');
  assert.strictEqual(review.approveVersion(db, {
    actorUserId: userId,
    workItemId: reviewWorkItemId,
    versionId: v1.id,
    expectedWorkVersion: 1,
    expectedContentHash: 'intentionally-stale',
    idempotencyKey: 'approve-1'
  }).id, v1.id);
  assert.strictEqual(review.createInitialVersion(db, {
    actorUserId: userId,
    workItemId: reviewWorkItemId,
    expectedWorkVersion: 1,
    idempotencyKey: 'version-create-1'
  }).id, v1.id);
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
} finally {
  if (db?.open) db.close();
  fs.rmSync(root, { recursive: true, force: true });
}
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

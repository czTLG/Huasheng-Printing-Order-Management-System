'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-thread-review-'));
process.env.DB_PATH = path.join(root, 'app.db');
const { db, initDb } = require('../src/db');
const { saveThreadReview, bestThreadReview } = require('../src/services/matrixThreadReview');

try {
  const originalLog = console.log; console.log = () => {};
  try { initDb(); } finally { console.log = originalLog; }
  saveThreadReview(db, { thread_key: 'Buyer@Example.Test::RFQ', source: 'human_verified', thread_state: 'quote_in_progress', responsible_party: 'internal_review', summary_cn: '完整线程已核对。', next_action_cn: '继续现有任务。' });
  saveThreadReview(db, { thread_key: 'buyer@example.test::rfq', source: 'ai', thread_state: 'quote_required', responsible_party: 'our_team', summary_cn: '低质量的新分析。', next_action_cn: '错误地新建任务。' });
  const best = bestThreadReview(db, 'buyer@example.test::rfq');
  assert.strictEqual(best.summary_cn, '完整线程已核对。');
  assert.strictEqual(best.next_action_cn, '继续现有任务。');
  assert.strictEqual(best.quality_rank, 100);
  console.log('PASS matrix thread review');
} finally {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
}

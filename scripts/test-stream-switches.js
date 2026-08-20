#!/usr/bin/env node
'use strict';

const assert = require('node:assert');
const {
  recommendationEnabled, runKnowledgeDue,
  runRecommendationCycle
} = require('../.runtime/vm_debug_ci/workspace/scripts/matrix-watch');
const {
  streamSwitches,
  summaryCardFor
} = require('../.runtime/vm_debug_ci/workspace/scripts/stream-watch');
const fs = require('node:fs');
const path = require('node:path');

async function run() {
  let claims = 0;
  let dueRuns = 0;
  const disabled = await runRecommendationCycle({
    enabled: recommendationEnabled({}),
    state: {},
    claim: async () => { claims += 1; },
    due: async () => { dueRuns += 1; return {}; }
  });
  assert.equal(disabled.status, 'disabled');
  assert.equal(claims, 0);
  assert.equal(dueRuns, 0);
  assert.equal(recommendationEnabled({ MATRIX_RECOMMEND_ENABLED: '1' }), true);
  assert.equal(recommendationEnabled({}), false);
  let knowledgeSends = 0;
  const beforeKnowledge = await runKnowledgeDue({
    now: new Date('2026-08-20T00:59:00.000Z'), state: {}, chatId: 'build-chat', hour: 9, minute: 0,
    storePath: require('node:path').join(require('node:os').tmpdir(), `missing-knowledge-${process.pid}.json`),
    send: async () => { knowledgeSends += 1; return 'message'; }
  });
  assert.equal(beforeKnowledge.last_success_date, null);
  assert.equal(knowledgeSends, 0);

  const defaultSwitches = streamSwitches({});
  assert.equal(defaultSwitches.summarySupervisorSectionEnabled, false);
  assert.equal(defaultSwitches.orderEventsEnabled, true);
  const enabledSwitches = streamSwitches({ STREAM_SUMMARY_SUPERVISOR_SECTION_ENABLED: '1' });
  assert.equal(enabledSwitches.summarySupervisorSectionEnabled, true);
  assert.equal(enabledSwitches.orderEventsEnabled, true);

  const summary = {
    date: '2026-08-20', stage_counts: [], transition_counts: [], changed_orders: [], new_work_orders: [],
    supervisor_items: [{ priority: 'P0', company: 'Example', state: 'pending', next_actions: ['Review'] }],
    urgent_active: 0, stale_active: 0, new_orders: 0, new_work_order_count: 0, advances: 0, completed: 0, rollbacks: 0
  };
  assert.equal(JSON.stringify(summaryCardFor(summary)).includes('主管待办'), false);
  assert.equal(JSON.stringify(summaryCardFor(summary, { includeSupervisor: true })).includes('主管待办'), true);
  const compose = fs.readFileSync(path.join(__dirname, '..', '.runtime/vm_debug_ci/compose.yaml'), 'utf8');
  for (const required of [
    'MATRIX_RECOMMEND_ENABLED: "0"',
    'MATRIX_KNOWLEDGE_REVIEW_ENABLED: "1"',
    'MATRIX_SUPERVISOR_ENABLED: "0"',
    'MATRIX_SUPERVISOR_BILL_ENABLED: "0"',
    'MATRIX_SUPERVISOR_VMCI_ENABLED: "0"',
    'MATRIX_INBOX_DAILY_WORKBENCH_ENABLED: "0"',
    'STREAM_SUMMARY_SUPERVISOR_SECTION_ENABLED: "0"'
  ]) assert.ok(compose.includes(required), `compose switch missing ${required}`);
  assert.ok(compose.includes('node\n      - /workspace/scripts/matrix-runtime.js'), 'order-preserving unified runtime must remain active');
  process.stdout.write('stream switches tests passed\n');
}

run().catch(error => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});

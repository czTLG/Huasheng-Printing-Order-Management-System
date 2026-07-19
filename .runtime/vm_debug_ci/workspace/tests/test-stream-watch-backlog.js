'use strict';
const assert = require('node:assert');
const watcher = require('../scripts/stream-watch.js');
const card = watcher.summaryCardFor({
  date: '2026-07-19', new_orders: 0, new_work_order_count: 0, advances: 0, completed: 0,
  urgent_active: 0, stale_active: 0, rollbacks: 0, stage_counts: [], transition_counts: [],
  changed_orders: [], new_work_orders: [], supervisor_items: [{ priority: 'P0', company: 'Amid David 2006 Ltd.', summary: 'Six items', state: 'pending_review', next_actions: ['复核当前起运费用'] }]
});
const text = JSON.stringify(card);
assert.match(text, /主管待办/);
assert.match(text, /Amid David 2006 Ltd\./);
assert.match(text, /复核当前起运费用/);
console.log('PASS stream watch backlog');

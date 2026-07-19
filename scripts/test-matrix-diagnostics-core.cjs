'use strict';

const assert = require('node:assert');
const { evaluateSnapshot, eventId } = require('./matrix-diagnostics-core.cjs');

const component = (restartCount = 0, active = true) => ({ active, restart_count: restartCount });
const snapshot = (at, { boot = 'boot-a', disk = 50, restarts = 0, active = true } = {}) => ({
  at,
  boot_id: boot,
  disk_percent: disk,
  components: { 'packaging-system.service': component(restarts, active) }
});

assert.throws(() => evaluateSnapshot(null, { bad: true }), /snapshot fields/);
assert.throws(() => evaluateSnapshot(null, {
  at: '2026-07-20T00:00:00.000Z', boot_id: 'boot-a', disk_percent: 50,
  components: { unsafe: { active: true, restart_count: 0, extra: true } }
}), /component fields/);

const below = evaluateSnapshot(null, snapshot('2026-07-20T00:00:00.000Z', { disk: 89 }));
assert.deepStrictEqual(below.events, []);
const warning = evaluateSnapshot(below.state, snapshot('2026-07-20T00:05:00.000Z', { disk: 90 }));
assert.strictEqual(warning.events.length, 1);
assert.strictEqual(warning.events[0].kind, 'disk_warning');
assert.strictEqual(warning.events[0].observed, 90);
assert.strictEqual(warning.events[0].threshold, 90);
const stillOpen = evaluateSnapshot(warning.state, snapshot('2026-07-20T00:10:00.000Z', { disk: 88 }));
assert.deepStrictEqual(stillOpen.events, []);
const recovered = evaluateSnapshot(stillOpen.state, snapshot('2026-07-20T00:15:00.000Z', { disk: 87 }));
assert.strictEqual(recovered.events[0].kind, 'disk_recovery');
assert.strictEqual(recovered.events[0].threshold, 88);

const baseline = evaluateSnapshot(null, snapshot('2026-07-20T01:00:00.000Z', { restarts: 10 }));
const two = evaluateSnapshot(baseline.state, snapshot('2026-07-20T01:05:00.000Z', { restarts: 12 }));
assert.deepStrictEqual(two.events, []);
const three = evaluateSnapshot(two.state, snapshot('2026-07-20T01:09:00.000Z', { restarts: 13 }));
assert.strictEqual(three.events.length, 1);
assert.strictEqual(three.events[0].kind, 'restart_warning');
assert.strictEqual(three.events[0].observed, 3);
const tooSoon = evaluateSnapshot(three.state, snapshot('2026-07-20T01:14:00.000Z', { restarts: 14 }));
assert.deepStrictEqual(tooSoon.events, []);
const stable14 = evaluateSnapshot(tooSoon.state, snapshot('2026-07-20T01:28:00.000Z', { restarts: 14 }));
assert.deepStrictEqual(stable14.events, []);
const stable15 = evaluateSnapshot(stable14.state, snapshot('2026-07-20T01:29:00.000Z', { restarts: 14 }));
assert.strictEqual(stable15.events[0].kind, 'restart_recovery');

const counterRollback = evaluateSnapshot(stable15.state, snapshot('2026-07-20T01:34:00.000Z', { restarts: 1 }));
assert.deepStrictEqual(counterRollback.events, []);
assert.strictEqual(counterRollback.state.components['packaging-system.service'].last_restart_count, 1);

const newBoot = evaluateSnapshot(three.state, snapshot('2026-07-20T01:10:00.000Z', {
  boot: 'boot-b', restarts: 0, disk: 50
}));
assert.deepStrictEqual(newBoot.events, []);
assert.strictEqual(newBoot.state.boot_id, 'boot-b');
assert.strictEqual(newBoot.state.components['packaging-system.service'].incident_open, false);

const inactive = evaluateSnapshot(null, snapshot('2026-07-20T02:00:00.000Z', { active: false }));
assert.strictEqual(inactive.events[0].kind, 'service_warning');
const activeAgain = evaluateSnapshot(inactive.state, snapshot('2026-07-20T02:05:00.000Z', { active: true }));
assert.strictEqual(activeAgain.events[0].kind, 'service_recovery');

const id1 = eventId(warning.events[0]);
const id2 = eventId({ ...warning.events[0] });
assert.match(id1, /^[a-f0-9]{32}$/);
assert.strictEqual(id1, id2);

console.log('matrix diagnostics core tests passed');

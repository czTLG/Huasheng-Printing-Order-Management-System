'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  collectSnapshot,
  writeEvent,
  buildCleanupPlan,
  verifyRetention,
  runCheck
} = require('./matrix-diagnostics.cjs');

const inventory = {
  containers: [
    { name: 'vm_debug_ci', image: 'matrix_runtime_8acd6e9-stream-node', running: true, healthy: true },
    { name: 'vm_debug_ci_pre_8acd6e9', image: 'matrix_runtime_16d70d1-stream-node', running: false, healthy: false },
    { name: 'vm_debug_ci_pre_16d70d1', image: 'matrix_runtime_86e2c31-stream-node', running: false, healthy: false }
  ],
  images: [
    { name: 'matrix_runtime_8acd6e9-stream-node', used_by: ['vm_debug_ci'] },
    { name: 'matrix_runtime_16d70d1-stream-node', used_by: ['vm_debug_ci_pre_8acd6e9'] },
    { name: 'matrix_runtime_86e2c31-stream-node', used_by: ['vm_debug_ci_pre_16d70d1'] },
    { name: 'postgres:17-alpine', used_by: ['stream-publisher-db'] }
  ],
  volumes: ['a', 'b']
};

const plan = buildCleanupPlan(inventory);
assert.deepStrictEqual(plan.remove_containers, ['vm_debug_ci_pre_16d70d1']);
assert.deepStrictEqual(plan.remove_images, ['matrix_runtime_86e2c31-stream-node']);
assert.deepStrictEqual(plan.keep, {
  current_container: 'vm_debug_ci', current_image: 'matrix_runtime_8acd6e9-stream-node',
  rollback_container: 'vm_debug_ci_pre_8acd6e9', rollback_image: 'matrix_runtime_16d70d1-stream-node'
});
assert.strictEqual(plan.volume_count, 2);
assert.throws(() => buildCleanupPlan({ ...inventory, containers: inventory.containers.map(row => row.name === 'vm_debug_ci' ? { ...row, image: 'wrong' } : row) }), /current image/);
assert.throws(() => buildCleanupPlan({ ...inventory, containers: inventory.containers.filter(row => row.name !== 'vm_debug_ci_pre_8acd6e9') }), /rollback container/);
assert.throws(() => buildCleanupPlan({ ...inventory, containers: inventory.containers.map(row => row.name === 'vm_debug_ci_pre_16d70d1' ? { ...row, running: true } : row) }), /obsolete container is running/);
assert.throws(() => buildCleanupPlan({ ...inventory, images: inventory.images.map(row => row.name === 'matrix_runtime_86e2c31-stream-node' ? { ...row, used_by: ['other-running'] } : row) }), /image still referenced/);

const verified = verifyRetention({
  inventory: {
    containers: inventory.containers.slice(0, 2), images: inventory.images.slice(0, 2), volumes: ['a', 'b']
  },
  beforeVolumes: ['a', 'b'], diskPercent: 84,
  serviceHealth: { 'packaging-system.service': true }, containerHealth: { vm_debug_ci: true }
});
assert.strictEqual(verified.ok, true);
assert.throws(() => verifyRetention({
  inventory: { containers: inventory.containers.slice(0, 2), images: inventory.images.slice(0, 2), volumes: ['a', 'b'] },
  beforeVolumes: ['a', 'b'], diskPercent: 85, serviceHealth: {}, containerHealth: { vm_debug_ci: true }
}), /disk target/);
assert.throws(() => verifyRetention({
  inventory: { containers: inventory.containers.slice(0, 2), images: inventory.images.slice(0, 2), volumes: ['a'] },
  beforeVolumes: ['a', 'b'], diskPercent: 84, serviceHealth: {}, containerHealth: { vm_debug_ci: true }
}), /volume inventory/);

const calls = [];
const execFile = (command, args) => {
  calls.push([command, args]);
  if (command === 'systemctl') return 'ActiveState=active\nNRestarts=2\n';
  if (command === 'docker') return JSON.stringify([{ State: { Running: true, Health: { Status: 'healthy' } }, RestartCount: 4 }]);
  throw new Error('unexpected command');
};
const current = collectSnapshot({
  execFile,
  statfs: () => ({ blocks: 100n, bfree: 20n, bavail: 20n }),
  readFile: () => 'boot-test\n',
  clock: () => new Date('2026-07-20T03:00:00.000Z'),
  serviceNames: ['packaging-system.service'], containerNames: ['vm_debug_ci']
});
assert.strictEqual(current.disk_percent, 80);
assert.deepStrictEqual(current.components, {
  'packaging-system.service': { active: true, restart_count: 2 },
  vm_debug_ci: { active: true, restart_count: 4 }
});
assert.deepStrictEqual(calls[0], ['systemctl', ['show', 'packaging-system.service', '--property=ActiveState,NRestarts', '--no-pager']]);
assert.deepStrictEqual(calls[1], ['docker', ['inspect', 'vm_debug_ci']]);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-diagnostics-'));
try {
  const spoolRoot = path.join(root, 'spool');
  const event = {
    kind: 'disk_warning', severity: 'warning', component: '/', observed: 91, threshold: 90,
    at: '2026-07-20T03:00:00.000Z', incident_started_at: '2026-07-20T03:00:00.000Z',
    next_action_cn: '检查磁盘增长来源并安全释放空间。'
  };
  const first = writeEvent(event, { spoolRoot });
  const second = writeEvent(event, { spoolRoot });
  assert.strictEqual(first.id, second.id);
  assert.strictEqual(fs.readdirSync(path.join(spoolRoot, 'pending')).length, 1);
  assert.strictEqual(fs.statSync(path.join(spoolRoot, 'pending', `${first.id}.json`)).mode & 0o777, 0o600);
  const persisted = JSON.parse(fs.readFileSync(path.join(spoolRoot, 'pending', `${first.id}.json`), 'utf8'));
  assert.deepStrictEqual(Object.keys(persisted).sort(), ['at', 'component', 'id', 'incident_started_at', 'kind', 'next_action_cn', 'observed', 'severity', 'threshold', 'version'].sort());

  const statePath = path.join(root, 'state', 'state.json');
  const checked = runCheck({
    statePath, spoolRoot,
    collect: () => ({
      at: '2026-07-20T04:00:00.000Z', boot_id: 'boot-test', disk_percent: 91,
      components: { 'packaging-system.service': { active: true, restart_count: 0 } }
    })
  });
  assert.strictEqual(checked.events, 1);
  assert.strictEqual(fs.statSync(statePath).mode & 0o777, 0o600);
  assert.throws(() => runCheck({ statePath, spoolRoot, collect: () => { throw new Error('metric unavailable'); } }), /metric unavailable/);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('matrix diagnostics host tests passed');

# Matrix Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce root-filesystem usage below 85%, retain exactly the current and one rollback Matrix runtime release, and install low-noise disk and restart alerts delivered to the existing Build chat.

**Architecture:** A pure CommonJS evaluator turns metric snapshots into incident transitions. A host-side collector persists redacted state and writes deterministic alert files into the existing protected `/workspace/store` bind mount; a focused bot-side consumer resolves the Build chat internally and delivers cards using the existing idempotent managed-card sender. Systemd runs the collector every five minutes, while cleanup remains an explicit guarded operation.

**Tech Stack:** Node.js 22 CommonJS, built-in `fs`, `crypto`, `child_process` and `statfsSync`, systemd service/timer, Docker CLI, existing Feishu bridge extension.

## Global Constraints

- Preserve `vm_debug_ci` on `matrix_runtime_8acd6e9-stream-node` and `vm_debug_ci_pre_8acd6e9` on `matrix_runtime_16d70d1-stream-node`.
- Never prune Docker volumes or delete databases, attachments, business records, protected runtime state, the current release, or the retained rollback release.
- Use neutral `matrix-diagnostics` names for files, commands, units, cards, and catalog entries.
- Keep credentials and Build chat identifiers inside the existing protected bot runtime; never write them to source, units, state, spool, or catalog.
- Disk warning is 90%, recovery is below 88%; restart warning is three restarts within ten minutes, recovery is fifteen stable minutes; repeat cooldown is one hour; timer interval is five minutes.
- Monitoring is observation-only and must never restart a service or container automatically.
- Source changes use tests first; production cleanup records before/after evidence and stops rather than deleting unrelated files if approved cleanup does not reach the target.

---

### Task 1: Incident evaluator

**Files:**
- Create: `scripts/matrix-diagnostics-core.cjs`
- Create: `scripts/test-matrix-diagnostics-core.cjs`

**Interfaces:**
- Consumes: snapshots shaped as `{ at, boot_id, disk_percent, components: { [name]: { active, restart_count } } }`.
- Produces: `evaluateSnapshot(previous, current, config)` returning `{ state, events }`, plus `eventId(event)`.

- [ ] **Step 1: Write the failing evaluator test**

```js
const assert = require('node:assert');
const { evaluateSnapshot } = require('./matrix-diagnostics-core.cjs');

const first = evaluateSnapshot(null, {
  at: '2026-07-20T00:00:00.000Z', boot_id: 'boot-a', disk_percent: 91,
  components: { 'packaging-system.service': { active: true, restart_count: 10 } }
});
assert.strictEqual(first.events[0].kind, 'disk_warning');
const recovery = evaluateSnapshot(first.state, {
  at: '2026-07-20T00:20:00.000Z', boot_id: 'boot-a', disk_percent: 87,
  components: { 'packaging-system.service': { active: true, restart_count: 10 } }
});
assert.strictEqual(recovery.events[0].kind, 'disk_recovery');
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node scripts/test-matrix-diagnostics-core.cjs`

Expected: FAIL because `matrix-diagnostics-core.cjs` does not exist.

- [ ] **Step 3: Implement the pure state machine**

Implement strict snapshot validation, boot-ID baseline reset, disk hysteresis, ten-minute restart samples, fifteen-minute recovery, one-hour cooldown, deterministic SHA-256 event IDs, and immutable returned state. Reject unknown component field shapes and non-finite timestamps or counters.

- [ ] **Step 4: Complete boundary tests**

Add exact assertions for 89/90/88/87 disk transitions, two versus three restarts, cooldown suppression, fifteen-minute recovery, counter rollback, host boot reset, inactive components, stable replay, and malformed input rejection.

- [ ] **Step 5: Run the evaluator test and verify GREEN**

Run: `node scripts/test-matrix-diagnostics-core.cjs`

Expected: `matrix diagnostics core tests passed` with exit code 0.

- [ ] **Step 6: Commit the evaluator**

```bash
git add scripts/matrix-diagnostics-core.cjs scripts/test-matrix-diagnostics-core.cjs
git commit -m "feat: add matrix diagnostics evaluator"
```

### Task 2: Host collector and guarded cleanup

**Files:**
- Create: `scripts/matrix-diagnostics.cjs`
- Create: `scripts/test-matrix-diagnostics.cjs`

**Interfaces:**
- Consumes: `evaluateSnapshot`, host metrics, an allowlisted service/container set, state path, and spool root.
- Produces: CLI commands `check`, `cleanup-plan`, and `cleanup-verify`; exported `collectSnapshot`, `writeEvent`, `buildCleanupPlan`, and `verifyRetention` functions for tests.

- [ ] **Step 1: Write failing collector and cleanup-plan tests**

Use injected `execFile`, `statfs`, `readFile`, and clock functions. Assert that the cleanup plan keeps only:

```js
{
  currentContainer: 'vm_debug_ci',
  currentImage: 'matrix_runtime_8acd6e9-stream-node',
  rollbackContainer: 'vm_debug_ci_pre_8acd6e9',
  rollbackImage: 'matrix_runtime_16d70d1-stream-node'
}
```

Assert that a mismatched current image, missing rollback, running obsolete container, referenced obsolete image, or any proposed volume deletion throws before returning a plan.

- [ ] **Step 2: Run the collector test and verify RED**

Run: `node scripts/test-matrix-diagnostics.cjs`

Expected: FAIL because the collector module does not exist.

- [ ] **Step 3: Implement metric collection and atomic state/spool writes**

Use `fs.statfsSync('/')`, `/proc/sys/kernel/random/boot_id`, `systemctl show` with an exact unit allowlist, and `docker inspect` with exact container names. Persist state with a same-directory `wx` temporary file, `fsync`, rename, and mode `0600`. Write each validated event to `<spool>/pending/<event-id>.json` under mode `0700`; event files contain only version, ID, kind, severity, component, observed value, threshold, timestamps, and Chinese next action.

- [ ] **Step 4: Implement fail-closed cleanup planning and verification**

`cleanup-plan` outputs machine-readable container/image names only after exact retention verification. It never invokes removal. `cleanup-verify` confirms the retained pair, zero older family members, unchanged Docker volume IDs, service/container health, and root usage below 85%.

- [ ] **Step 5: Complete host tests**

Cover atomic replay, existing pending-event deduplication, corrupt-state quarantine without content disclosure, lock contention, missing metrics, exact command argument allowlists, file modes, and cleanup verification failure at 85% or higher.

- [ ] **Step 6: Run host tests and syntax checks**

Run:

```bash
node scripts/test-matrix-diagnostics.cjs
node --check scripts/matrix-diagnostics.cjs
node --check scripts/matrix-diagnostics-core.cjs
```

Expected: both test scripts pass and syntax checks exit 0.

- [ ] **Step 7: Commit the collector**

```bash
git add scripts/matrix-diagnostics.cjs scripts/test-matrix-diagnostics.cjs
git commit -m "feat: add guarded matrix diagnostics collector"
```

### Task 3: Build-chat alert consumer

**Files:**
- Create: `.runtime/vm_debug_ci/workspace/scripts/matrix-diagnostics-watch.js`
- Create: `.runtime/vm_debug_ci/workspace/tests/test-matrix-diagnostics-watch.js`
- Modify: `.runtime/vm_debug_ci/workspace/extensions/stream-card.cjs`
- Modify: `.runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js`

**Interfaces:**
- Consumes: pending alert files in `/workspace/store/matrix-diagnostics/pending`, existing protected project mapping, extension `channel`, and `sendManagedCard`.
- Produces: `deliverNextAlert({ channel, sendManagedCard, appId, ...paths })` returning `false`, `{ status: 'delivered', id }`, or `{ status: 'ambiguous', id }`.

- [ ] **Step 1: Write failing consumer tests**

Create fixture project metadata containing `build` and `vm_debug_ci` mappings. Assert the consumer selects only `build`, validates the exact event schema, renders a Chinese card without secrets, passes the event ID as the managed-card idempotency key, records a mode-`0600` receipt, and removes the inflight file after acceptance.

- [ ] **Step 2: Run consumer tests and verify RED**

Run: `node .runtime/vm_debug_ci/workspace/tests/test-matrix-diagnostics-watch.js`

Expected: FAIL because the consumer module does not exist.

- [ ] **Step 3: Implement the consumer**

Read the oldest lexically sorted pending event, validate exact keys and allowed `kind` values, resolve one `build` project binding, atomically rename pending to inflight, render severity-colored card content, call:

```js
await sendManagedCard(channel, buildChatId, card, '', false, 'chat_id', event.id);
```

Then write a redacted receipt and delete inflight. Existing inflight without a matching receipt returns `ambiguous` and does not resend.

- [ ] **Step 4: Integrate a bounded poller into the extension**

The extension starts one five-second alert poller during registration, logs only the event ID/status, catches delivery errors without stopping message handling, and clears the timer in `dispose()`. Tests inject timer functions and the consumer so no network call occurs.

- [ ] **Step 5: Run consumer and extension tests**

Run:

```bash
node .runtime/vm_debug_ci/workspace/tests/test-matrix-diagnostics-watch.js
node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js
```

Expected: both scripts pass with exit code 0.

- [ ] **Step 6: Commit the consumer**

```bash
git add .runtime/vm_debug_ci/workspace/scripts/matrix-diagnostics-watch.js .runtime/vm_debug_ci/workspace/tests/test-matrix-diagnostics-watch.js .runtime/vm_debug_ci/workspace/extensions/stream-card.cjs .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js
git commit -m "feat: deliver matrix diagnostics alerts"
```

### Task 4: Installation assets and catalog entry

**Files:**
- Create: `deploy/systemd/matrix-diagnostics.service`
- Create: `deploy/systemd/matrix-diagnostics.timer`
- Create: `scripts/install-matrix-diagnostics.sh`
- Create: `scripts/test-install-matrix-diagnostics.sh`
- Create outside project during installation: `/home/admin/.codex/matrix-runtime/capabilities/matrix-diagnostics.md`
- Modify outside project during reconciliation: `/home/admin/.codex/matrix-runtime/INDEX.md`

**Interfaces:**
- Consumes: tested collector command, protected project store path, and systemd.
- Produces: `/home/admin/.local/bin/matrix-diagnostics`, system-level oneshot/timer units, and one user-level catalog entry.

- [ ] **Step 1: Write failing installation fixture test**

The shell test installs into a temporary root and asserts exact command/unit paths, `User=admin`, `Type=oneshot`, no credential environment variables, `OnUnitActiveSec=5min`, `Persistent=true`, and executable/unit syntax checks.

- [ ] **Step 2: Run installation test and verify RED**

Run: `bash scripts/test-install-matrix-diagnostics.sh`

Expected: FAIL because installation assets do not exist.

- [ ] **Step 3: Implement installation assets**

The installer accepts an explicit destination root for tests. Production installation copies the collector/core to `/home/admin/.local/lib/matrix-diagnostics/`, installs a mode-`0755` launcher at `/home/admin/.local/bin/matrix-diagnostics`, installs units at `/etc/systemd/system/`, creates `/var/lib/matrix-diagnostics` and the project spool with restrictive permissions, then performs `daemon-reload`, enables the timer, and runs one check. It never embeds protected values.

- [ ] **Step 4: Run installation tests and shell syntax checks**

Run:

```bash
bash scripts/test-install-matrix-diagnostics.sh
bash -n scripts/install-matrix-diagnostics.sh
systemd-analyze verify deploy/systemd/matrix-diagnostics.service deploy/systemd/matrix-diagnostics.timer
```

Expected: tests pass; unit verification has no errors.

- [ ] **Step 5: Commit installation assets**

```bash
git add deploy/systemd/matrix-diagnostics.service deploy/systemd/matrix-diagnostics.timer scripts/install-matrix-diagnostics.sh scripts/test-install-matrix-diagnostics.sh
git commit -m "feat: install matrix diagnostics timer"
```

### Task 5: Production cleanup, deployment, and verification

**Files:**
- Modify through controlled operations: Docker runtime inventory and systemd journal retention.
- Install from tracked assets: `/home/admin/.local/bin/matrix-diagnostics`, `/etc/systemd/system/matrix-diagnostics.service`, `/etc/systemd/system/matrix-diagnostics.timer`.
- Reconcile: `/home/admin/.codex/matrix-runtime/INDEX.md`, `/home/admin/.codex/matrix-runtime/capabilities/matrix-diagnostics.md`.

**Interfaces:**
- Consumes: guarded cleanup plan and committed installation assets.
- Produces: reduced disk usage, active monitor timer, Build-chat alert capability, and verification evidence.

- [ ] **Step 1: Record protected pre-cleanup evidence**

Capture root usage, Docker volume IDs, current/rollback image bindings, core service states, container health, journal usage, and cleanup-plan output. Do not record environment values or business data.

- [ ] **Step 2: Remove only cleanup-plan containers and images**

Pass each exact planned obsolete container to `docker rm`, then each exact unreferenced obsolete image to `docker image rm`. Re-run retention verification immediately. Do not use `docker system prune` or any volume-prune command.

- [ ] **Step 3: Constrain historical journal storage**

Run both:

```bash
journalctl --vacuum-time=7d
journalctl --vacuum-size=512M
```

Then record `journalctl --disk-usage` and root usage.

- [ ] **Step 4: Install and enable the monitor**

Run the tested installer, verify file ownership/modes, `systemctl is-enabled matrix-diagnostics.timer`, `systemctl is-active matrix-diagnostics.timer`, and the last oneshot result.

- [ ] **Step 5: Deploy the bot consumer safely**

Build a new immutable Matrix runtime image from the committed source, preserve the selected rollback, replace only `vm_debug_ci`, wait for Docker health, and verify runtime/component hashes. This production container restart is covered by the user's explicit approval for this monitoring deployment and must not send a test alert.

- [ ] **Step 6: Run fixture-only alert verification**

Use temporary state/spool/project mappings and a fake `sendManagedCard` to prove disk warning/recovery, restart warning/recovery, cooldown, boot reset, Build-only routing, and idempotent replay. No Feishu network call is allowed in this step.

- [ ] **Step 7: Verify production health and target**

Verify:

```text
root filesystem < 85%
packaging-system.service active and /health successful
huasheng-packing.service active and public/local HTTP 200
nginx.service and docker.service active
vm_debug_ci healthy and runtime health successful
all active stream-publisher containers healthy
current and one rollback Matrix release present; no older family containers/images
Docker volume IDs unchanged
matrix-diagnostics.timer active; latest service result success
```

- [ ] **Step 8: Reconcile the user-level catalog and scan**

Add one `matrix-diagnostics` capability entry with authoritative paths, thresholds, status, and approval boundary. From `/tmp`, read only the index and entry to prove discovery. Scan source, installed files, units, state, spool, and catalog for credential assignments, chat identifiers, SMTP Message-IDs, protected customer identifiers, and business records; expected result is zero forbidden values.

- [ ] **Step 9: Run full code verification and commit catalog-independent source**

Run all new tests, existing stream-card tests, `git diff --check`, and the existing read-only Matrix verifier. Commit any final source-only corrections, then merge to `main` and push only after all checks pass.

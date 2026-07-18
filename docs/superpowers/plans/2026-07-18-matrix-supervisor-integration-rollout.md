# Matrix Supervisor Integration and Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate all reviewed Matrix branches without touching the dirty primary worktree, verify the complete runtime, and deploy in disabled mode before one separately approved real email.

**Architecture:** Build an integration branch in a clean worktree from `main`, use relay as the committed CRM/selection/review base, add the approved design and Atlas runtime, port only proven phase-one gaps, and treat the dirty delta as separately reviewed checkpoint commits. Deployment uses immutable releases, dual-database online backups, disabled flags, and exact rollback artifacts.

**Tech Stack:** Git worktrees, Node.js, SQLite online backup, systemd, Docker Compose, Feishu bridge, signed runtime manifest, browser/API regression.

## Global Constraints

- Never reset, clean, switch, stash, or broadly stage `/home/admin/work/packaging-system` while it contains owner work.
- No merge authorizes deployment; no deployment authorizes delivery.
- Never print or commit chat IDs, tokens, SMTP values, contacts, message bodies, prices, formulas, or business records.
- Keep `MATRIX_STREAM_SEND_ENABLED=0`, `MATRIX_DELIVERY_ENABLED=0`, `MATRIX_ATLAS_ENABLED=0`, and `MATRIX_SUPERVISOR_ENABLED=0` through integration smoke.
- Bot runtime remains without SMTP variables; only digest-bound management delivery may transport.
- Remote push, production mutation, Feishu publication, live source activation, and real delivery retain explicit approval gates.

---

### Task 1: Clean Integration Baseline

**Files:** Git refs/worktree only; keep `.superpowers/sdd/progress.md` as an ignored/untracked coordination artifact, never a release commit.

- [ ] Record exact `main`, `origin/main`, relay, Atlas runtime, signal-final, phase1, current dirty-branch, and design commit SHAs; stop if audited refs moved unexpectedly.
- [ ] Use the worktree skill to create `integration/matrix-supervisor-20260718` at `.worktrees/matrix-supervisor-integration` from `main`; prove it is clean.
- [ ] Fast-forward the integration branch to `feature/matrix-stream-relay`.
- [ ] Cherry-pick `0f6d7f1` with provenance; assert only the approved supervisor design is introduced.
- [ ] Verify readonly-selection is already an ancestor and perform no ceremonial merge.
- [ ] Run relay focused tests and configured verifier; require `delivery_enabled: false`.
- [ ] Update the untracked progress ledger after every reviewed task; verify it is excluded from release diffs.

### Task 2: Merge Atlas Runtime and Reconcile Signal Evidence

**Files:** `.env.example`, Atlas runtime files, `docs/matrix-signal/registry.csv`, related docs/tests; create `scripts/test-matrix-signal-registry.js` if no authoritative validator exists.

- [ ] Merge `feature/matrix-atlas-runtime` with a merge commit; manually verify the auto-combined env block has disabled defaults, unique names, and no values.
- [ ] Run Atlas DB/registry tests and full relay verifier.
- [ ] Merge signal-final in a temporary review branch; resolve its single registry conflict row-by-row from authoritative state/provenance, never blanket ours/theirs.
- [ ] Write/run `node scripts/test-matrix-signal-registry.js` to validate CSV shape, unique IDs, references, timestamps, and private-data hygiene without logging record contents or replaying external actions.
- [ ] Run the exact registry test and commit the reviewed merge.

### Task 3: Phase-One Requirement Porting

**Files:** create `docs/matrix-phase1-port-audit-2026-07-18.md`; modify only files required by confirmed missing behavior.

- [ ] Classify every unique phase1 requirement/commit as already satisfied, retired by stricter contract, or still missing.
- [ ] For each missing requirement, write a RED test against current relay router/database/server contracts.
- [ ] Port one gap per reviewed commit; do not merge the old branch wholesale or choose an entire conflicting side.
- [ ] Run adapted rank/cache/stream/adapter/API/phase tests after every port.
- [ ] Record retired requirements and evidence so they are not reintroduced later.

### Task 4: Protect and Reconstruct the Dirty Delta

**Files:** current dirty worktree remains source; create separate checkpoint branch/commits only after classification.

- [ ] Inventory tracked/untracked paths without printing protected contents; classify source/config/test/docs, generated state, private records, and unknown ownership.
- [ ] Create a mode-`0700` private snapshot directory outside the repository. Before copying any content, exclude databases, uploads, runtime stores, calculation outputs, credentials, generated artifacts, and private records by reviewed path inventory.
- [ ] Copy only explicitly reviewed source/config/test/docs files into per-file mode-`0600` snapshot entries; record source path, mode, checksum, owner, creation time, expiry, and no automatic destruction. Do not create a broad binary patch or stash.
- [ ] Verify original dirty status and path checksums are unchanged after snapshot; never switch branches in the dirty worktree.
- [ ] Reconstruct each reviewed change manually or with `apply_patch` in a separate clean checkpoint worktree based on `0f6d7f1`; stage explicit paths only, never `git add -A`.
- [ ] Commit logical groups in that clean worktree: runtime/backup, backend/auth/schema, frontend/UI, tests/docs, and owner-approved data/config.
- [ ] Independently review each checkpoint diff, then cherry-pick clean commits onto integration and resolve eight core overlaps by behavior/tests.
- [ ] Leave unowned files untouched in the original worktree.

### Task 5: Implement Program Waves with Per-Task Review

**Files:** all files named by the Core/Ledger, Atlas/Draft, and Operations plans.

- [ ] Execute `2026-07-18-matrix-supervisor-core-ledger.md` Tasks 1–9 using RED/GREEN, one implementer and an independent reviewer per task.
- [ ] Execute `2026-07-18-matrix-supervisor-atlas-draft.md` Tasks 1–11 from the reviewed Atlas baseline; sources stay paused.
- [ ] Execute `2026-07-18-matrix-supervisor-operations.md` Tasks 1–7.
- [ ] After every clean review, update the durable progress ledger with commit range and verdict.
- [ ] Generate a final whole-branch review package from merge-base `main` to integration HEAD and resolve all Critical/Important findings before proceeding.

### Task 6: Final Runtime, Migration, and Dual-Database Gate

**Files:** verifier/manifest, create `scripts/runtime-backup-matrix.js`, `scripts/runtime-restore-matrix.js`, `scripts/test-runtime-backup-matrix.js`, `scripts/verify-matrix-supervisor-program.js`, `scripts/test-verify-matrix-supervisor-program.js`, `scripts/check-matrix-sender-readiness.js`, `docs/runbooks/matrix-supervisor-rollback.md`, catalog.

- [ ] Enumerate every production runtime file and scan capabilities before updating signed hashes; allow transport only in exact digest-bound management delivery.
- [ ] Add mutation fixtures for unauthorized network/process/SMTP, chat routing, recipient/content, source fetch, private copy target, and scheduler behavior.
- [ ] Write RED backup tests, then implement `node scripts/runtime-backup-matrix.js --app-db <path> --stream-db <path> --out <0700-dir>` using SQLite online backup for both DBs and one commit/time-bound verification manifest; output files are mode `0600`.
- [ ] Verify mode `0600`, parent `0700`, checksums, SQLite integrity/foreign keys, and isolated restoration.
- [ ] Restore both files with `node scripts/runtime-restore-matrix.js --manifest <manifest> --out <isolated-0700-dir>`; start the exact release with `DISABLE_CRON=1` and all Matrix flags `0`, run migrations twice, compare schema/table/index/count invariants, and document old-release compatibility without restoring over production.
- [ ] Create a committed program verifier whose explicit child-command manifest is the exact union of every subordinate plan's final block plus Relay, CRM, permissions, runtime, baseline, changed-file `node --check`, frontend lint/build, desktop/mobile browser, record/signal import, and configured DB verifier. The manifest must contain the exact named commands `node scripts/test-check-matrix-sender-readiness.js` and `node scripts/test-matrix-supervisor-dashboard-api.js`; `scripts/test-verify-matrix-supervisor-program.js` must prove that deleting either command, or any other required child command, fails the manifest test.
- [ ] Run `node scripts/verify-matrix-supervisor-program.js`; require every child PASS and `delivery_enabled: false`.
- [ ] Write the rollback runbook with exact order: disable send; stop new Atlas/scheduler claims; switch prior application/bot artifacts; restart only affected services; health/readiness/manifest/disabled checks; code/config rollback before DB restore; DB restore only after new snapshot and explicit approval; preserve immutable histories.
- [ ] Require a clean exact commit and final independent whole-branch approval.

### Task 7: Promote the Reviewed Commit to Main

- [ ] Re-fetch/recheck `origin/main` and stop if it moved outside the audited ancestry.
- [ ] Create a second clean worktree checked out at current `main`; with explicit approval for branch mutation, fast-forward or merge the reviewed integration commit there according to the verified graph. Never switch the dirty primary worktree. Rerun the committed program verifier on the promoted SHA.
- [ ] Push/PR or remote-main mutation requires a separate explicit approval; record the resulting immutable commit/tag/ref and deploy only that exact promoted SHA.
- [ ] Update the design metadata in a separate reviewed documentation commit from `pending owner review` to approved, preserving the original `0f6d7f1` provenance.

### Task 8: Disabled Production Deployment

**Files:** immutable release copies and protected configuration only after explicit production approval.

- [ ] Record current application commit/service config/runtime manifest and bot image/container/volume health; produce verified production backups of both databases.
- [ ] Build immutable application and bot releases; preserve previous releases and exact rollback commands.
- [ ] Deploy the application with all four rollout/send flags disabled; run migrations/readiness/health/permissions and prove send confirmation creates zero jobs/events. This all-disabled phase does not claim live supervisor routing.
- [ ] Deploy the matching bot with exact Bill/VMCI chat IDs supplied through protected environment fingerprints; prove no SMTP variables.
- [ ] After a separate internal-supervisor approval, set only `MATRIX_SUPERVISOR_ENABLED=1` while send/delivery/Atlas remain `0`; restart only the bot/supervisor components, resolve Feishu `im.message.receive_v1`, publish the reviewed app version after explicit approval, and verify one idempotent non-sensitive mention in each group.
- [ ] Verify exact chat routing, cross-group no-duplication, WebSocket health, card desktop/mobile behavior, and zero external customer messages.
- [ ] Start Atlas only after separate source-policy approval at 10/3/1; manually review every evidence link and packet.

### Task 9: Bounded Real Acceptance and Rollback Evidence

**Files:** protected production config/audit records only; no code change expected.

- [ ] With separate approval, install sender readiness only in a protected mode-`0600` management environment; run `node scripts/check-matrix-sender-readiness.js --no-send` whose tests prove it cannot call `sendMail`; grant `matrixSend` to the exact operator and verify redacted permission audit.
- [ ] Record pre-enable job/event counts and redacted flags; set exact `MATRIX_STREAM_SEND_ENABLED=1` and `MATRIX_DAILY_ACCEPTED_LIMIT=1` in management only, prove bot still has no SMTP variables and `MATRIX_DELIVERY_ENABLED=0`, restart only main, and rerun readiness.
- [ ] Open/review/preview without final send and prove job/event counts unchanged.
- [ ] Obtain final in-product approval for exact recipient, source, subject, body, contact/item/quote version, and content hash.
- [ ] Send once; verify one accepted job/event and stable Message-ID fingerprint. Ambiguous outcome is never retried.
- [ ] Immediately set `MATRIX_STREAM_SEND_ENABLED=0`, restart only main, and prove disabled endpoint/job counts unless the owner separately approves leaving restricted mode enabled.
- [ ] If a natural reply arrives, verify exact correlation, Chinese translation, Bill notification, and next task; otherwise create only the three-business-day review task.
- [ ] Exercise documented rollback criteria and verify health/readiness/disabled flags after a non-destructive rehearsal.
- [ ] Append final release evidence bound to the immutable application SHA, bot artifact digest, service restart time, and audit actor. Record the final non-secret values of `MATRIX_SUPERVISOR_ENABLED`, `MATRIX_STREAM_SEND_ENABLED`, `MATRIX_DELIVERY_ENABLED`, `MATRIX_ATLAS_ENABLED`, and `MATRIX_DAILY_ACCEPTED_LIMIT`, plus the verifier result and evidence timestamp; never record chat IDs, tokens, SMTP values, contacts, or message content. Re-read protected service environments after the last restart and fail the release-evidence gate if recorded values differ from runtime.

## Complete Test Matrix

```bash
git diff --check
node scripts/test-matrix-stream-review.js
node scripts/test-matrix-stream-gates.js
node scripts/test-matrix-policy.js
node scripts/test-matrix-stream-delivery.js
node scripts/test-matrix-stream-correlation.js
node scripts/test-matrix-api.js
node scripts/test-admin-access-regression.js
node scripts/test-cache-index-view.js
node scripts/test-packet-gate.js
node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js
node .runtime/vm_debug_ci/workspace/tests/test-bridge-patch.js
node .runtime/vm_debug_ci/workspace/tests/test-runtime-supervisor.js
node scripts/test-bridge-artifact-0.6.9.js
MATRIX_STREAM_DB_PATH=/home/admin/work/packaging-system/data/matrix-stream.db npm run verify:matrix-readonly-selection
npm run baseline:verify
npm run verify:smoke
npm run test:runtime-rebuild
npm run test:private-baseline
npm run runtime:audit
npm run runtime:verify
npm --prefix frontend-next run lint
npm --prefix frontend-next run build
```

The authoritative final gate is `node scripts/verify-matrix-supervisor-program.js`, whose tested manifest is the exact union of this block and every subordinate final block. API/browser localhost bind failures caused solely by sandbox `EPERM` must be rerun on the approved localhost-capable path and reported accurately.

## Hard Stops

- The dirty primary worktree is altered before checkpoint ownership review.
- An audited branch ref moves or a signal registry row lacks authoritative provenance.
- Phase1 is merged wholesale.
- Bill/VMCI is claimed while only `STREAM_CHAT_ID` is used.
- One database lacks a tested recovery artifact.
- Any production-reachable file is outside the manifest.
- Feishu app version is unpublished or the receive-event warning remains.
- Disabled mode creates a job/event or bot contains SMTP variables.
- A real recipient/content/version lacks exact approval or delivery becomes ambiguous.

## 蒸馏进度

- 已确认模块：clean integration、branch处置、dirty delta保护、三波实施、runtime/双库门、disabled部署、飞书双群验收、单封发送与回滚。
- 未解决模块：实施尚未开始；生产、飞书发布、真实来源和真实外发仍保留各自审批门。
- 下一优先知识缺口：建立主工作树dirty delta的路径归属清单，确认哪些属于新版UI与业务真相。

# Task 5 R3 Final Independent Review

## Verdict

- **Spec: FAIL / changes required**
- **Quality: FAIL / changes required**
- **Critical:** 0
- **Important:** 2
- Reviewed range: `711fde0..b724076`
- The stale global runtime manifest remains an explicitly excluded baseline and was not re-signed.

R3 repairs the six R2 findings on their tested main paths and retains the earlier R1 repairs. Two concurrency/lock-identity gaps remain capable of permanently stopping reply-card delivery, so the final approval gate is not met.

## Important findings

### S1. Retry-ready can invalidate an inflight relay claim and make its recovery file unreconcilable

`retryInboundTranslation()` accepts an eligible pending-translation row regardless of its current notification `delivery_state`. On successful provider return, its transaction unconditionally sets the same row to `pending`, rotates `notification_key`, clears `owner_token`/lease/receipt/finalization, and resets attempts (`src/services/matrixStreamCorrelation.js:585-600`).

A user can receive and click `Retry translation` before the relay has durably acked the just-sent pending card; external card delivery can precede the `sendManagedCard()` response and the ack API call. The unsafe ordering is:

1. Notification is `inflight` with token T and its relay file is in `matrix-reply-inflight.json`.
2. The card becomes visible and the retry callback starts.
3. Retry provider returns and commits first, changing the row to `pending`, rotating the key, and erasing T/finalization state.
4. Relay ack with T now fails claim mismatch and deliberately retains the inflight recovery file.
5. Recovery status with T also fails claim mismatch because neither `owner_token` nor `finalized_token` retains T.
6. Watcher sees the inflight file forever and returns `busy`; neither the old file nor the newly pending ready revision can progress.

The R3 test covers only ack-before-retry. The retry-ready transition must coordinate with inflight finalization: use a separate immutable notification revision/outbox row, or persist a ready-requeue intent that is applied after ack/nack/status resolves the old token. Add both interleavings across separate connections and assert exactly one ready card, no stale relay file, and no duplicate send.

### Q1. A stale lock cannot distinguish its dead owner from PID reuse

The filesystem lock records only `{ pid, created_at }`. Once its mtime exceeds the stale threshold, cleanup calls `process.kill(pid, 0)` and treats any existing process with that PID as the live lock owner (`.runtime/vm_debug_ci/workspace/scripts/matrix-watch.js:245-267`). Process IDs are reusable. If the watcher dies and its PID is subsequently assigned to an unrelated long-lived process, the stale lock is classified as live indefinitely and every watcher returns `busy` without contacting the claim API.

The test that writes an old lock containing the current test PID and expects `busy` demonstrates this ambiguity; it does not prove the PID belongs to the process that created the lock. Bind the lock to a non-reusable process identity such as Linux process start ticks plus boot ID, or use a kernel-managed advisory lock with a bounded, audited fallback. Keep mode `0600`, and test a stale lock whose PID exists but whose recorded process-start identity differs.

## R2 findings disposition

| R2 finding | R3 result |
|---|---|
| Two watchers overwrite the single relay file | **Fixed on normal overlap** with lock-before-claim and hard-link no-replace; Q1 remains for stale-lock identity |
| Ack/nack response-loss crash wedge | **Fixed** with actor-bound status reconciliation and replay-stable finalization |
| Pending retry has no ready card | **Fixed on sequential path** with ready requeue; S1 remains for retry-vs-inflight ordering |
| Terminal event leaves old card claimable | **Fixed** with transactional retirement, claim filtering, and pre-send status validation |
| Lease not enforced at finalize | **Fixed** with same-transaction expiry/manual-review and replay-safe scavenger result |
| Formula/inline credential leaks | **Fixed for the reviewed boundary** with centralized whole-line redaction and direct spool assertions |

## Historical R1 findings disposition

- Real spool list/claim/ack/nack/watcher connection: implemented.
- `In-Reply-To` precedence over `References`: fixed.
- Monotonic terminal evolution and exactly-once reply-check closure: fixed.
- Refusal/terminal no-draft boundary: fixed.
- Covered quoted unsubscribe/footer forms: fixed.
- Central credential/formula sanitizer: fixed for reviewed cases.
- Full durable-text retry plus post-provider actor/binding authorization: fixed.
- Internal event-key namespace collision: fixed.

## Confirmed behavior

- O_EXCL lock files and relay/temp files use mode `0600`; hard-link publication does not replace an existing spool path; temporary and normal-path relay files are cleaned.
- Status, ack, and nack require the active current owner/binding plus the claim token. Finalization records token/state for replay, and unknown status retains the recovery file.
- Expired claims transition to `manual_review` in the same immediate transaction; stale ack/nack replay the fail-closed result.
- Higher-priority terminal events retire pending/inflight reply notifications, and status is checked immediately before the external card send.
- Pending-to-ready retry requeues a new notification key exactly once in the covered sequential flow.
- Relay payload contains only the bounded sanitized card projection. No source snapshot, full inbound body, credential, formula, raw provider error, or server diagnostic is written to the relay JSON.
- Stable notification keys prevent repeated sends during the reviewed ack/status recovery paths.
- The card and draft paths contain no email send action. Draft creation remains actor-bound, transactional, idempotent, and creates no delivery job.
- Exact-header precedence, fallback uniqueness, inbound Message-ID dedupe, ambiguous zero-work mutation, translation exact shape/pending behavior, and post-upsert IMAP isolation remain correct.

## Verification evidence

- `node scripts/test-matrix-stream-correlation.js` — PASS.
- `node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js` — PASS.
- `node scripts/test-matrix-api.js` — PASS with localhost binding permission.
- Complete `review-task-5-r3.diff`, updated report, production sources, and focused tests were read.
- Static interleaving trace confirmed S1: retry clears the only token needed by ack/status recovery when retry wins the race.
- Static lock trace confirmed Q1: PID existence is checked, but process start identity is neither stored nor verified.
- `git diff --check` on this review report — PASS.

## Required repair order

1. Make retry-ready a separate/serialized notification revision so it cannot invalidate an inflight token.
2. Replace PID-only stale-lock ownership with a non-reusable process identity or kernel-managed lock.

## 蒸馏进度

- 已确认模块：header precedence、dedupe/fallback、单调 terminal state、terminal card retirement、exact-shape translation、authoritative retry/auth、internal event keys、lease-aware status/ack/nack、crash reconcile、no-replace relay、集中脱敏、actor-bound draft/no-send。
- 未解决模块：retry-ready 与旧 inflight finalize 的反序竞态；stale lock 的 PID reuse 身份歧义。
- 下一优先知识缺口：notification revision/outbox 串行化与可复用 PID 环境下的锁所有权证明。

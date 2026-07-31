# Task 5 R4 Final Independent Review

## Verdict

- **Spec: ✅**
- **Quality: Approved**
- **Critical:** 0
- **Important:** 0
- Reviewed range: `711fde0..6efea7f`
- The known stale global runtime manifest remains outside Task 5 scope. It was not changed or re-signed in this range.

No blocking findings remain. The R4 implementation closes both R3 Important findings and preserves the previously confirmed R1/R2 repairs.

## R3 findings disposition

### Immutable notification generations — fixed

Successful translation retry now inserts one new ready generation instead of mutating the old notification row. The old generation retains its `notification_key`, inflight `owner_token`, lease, receipt, and finalization history, while the ready generation has its own key and references the old row with `supersedes_notification_id`.

The reviewed tests cover all required orderings:

- ack before retry;
- retry before ack, with the old token still able to ack;
- retry response-loss replay without another provider call or generation;
- two SQLite connections completing provider work concurrently, with exactly one generation 2 and one ready event.

Claim selection can continue with the ready pending generation while delivered/inflight/manual-review history remains immutable. Status/ack recovery remains scoped to the old notification ID and token, so old relay-file cleanup is not wedged by retry.

### Non-reusable lock ownership — fixed

The watcher creates the relay lock with `O_EXCL` and mode `0600`, and records Linux boot ID, PID, and `/proc/<pid>/stat` process-start ticks. A stale lock is retained only when all three identity fields still match. Reused PID, reboot mismatch, dead owner, and stale malformed-lock cases are recoverable; a matching live owner remains busy. Relay publication still uses hard-link no-replace semantics, and temporary/lock files are cleaned on the reviewed paths.

## R1/R2 regression review

- Direct `In-Reply-To` precedence, deterministic unique fallback, Message-ID dedupe, and ambiguous zero-work-item mutation remain correct.
- Terminal state evolution is monotonic; reply checks close idempotently; refusal/terminal paths cannot create reply drafts; higher-priority terminal events retire pending/inflight reply notifications.
- Translation failure remains explicitly pending with no fabricated content. Retry reloads authoritative durable text and rechecks active actor/binding authorization after provider completion.
- Central redaction covers the reviewed credential, authorization, URL-secret, private formula/cost, and inline-secret cases before spool/card persistence.
- Internal event keys remain isolated from caller-controlled idempotency keys.
- Notification claim/status/ack/nack remains owner-bound, lease-aware, replay-safe, and fail-closed on unknown delivery state. Ack/nack response loss is reconciled before relay-file cleanup without resend.
- Watcher overlap cannot overwrite the single relay slot. Current status is checked immediately before external card delivery.
- Ready draft creation remains actor-bound, transactional, and idempotent. The correlation/retry/draft paths expose no email-send operation or caller-supplied transport/content fields.

## Verification evidence

- `node scripts/test-matrix-stream-correlation.js` — PASS.
- `node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js` — PASS.
- `node scripts/test-matrix-api.js` — PASS on the localhost-capable path. The first sandboxed run failed only because binding `0.0.0.0:21002` was denied with `EPERM`.
- `node scripts/test-matrix-stream-gates.js` — PASS.
- `node scripts/test-matrix-stream-review.js` — PASS.
- `node scripts/test-matrix-policy.js` — PASS.
- `node scripts/test-matrix-stream-delivery.js` — PASS.
- `node scripts/test-matrix-record-import.js` — PASS.
- `node scripts/test-matrix-signal-import.js` — PASS.
- `node scripts/smoke-test.js` — `SMOKE PASS`.
- `node --check` on all 13 changed JavaScript/CJS files — PASS.
- `git diff --check 711fde0..6efea7f` — PASS.
- Range file scan confirms no runtime manifest file changed and no manifest was re-signed.
- Static no-send scan confirms the Task 5 correlation, retry, and draft paths do not add SMTP/message-delivery capability; runtime remains guarded by `MATRIX_DELIVERY_ENABLED=0`.

## Deferred boundary

- Task 7 still owns the complete runtime capability audit and manifest rebuild/re-signing.
- Historical accepted jobs whose additive `sender_email` field is empty remain exact-header-only for correlation; this is the documented compatibility boundary, not a Task 5 regression.

## 蒸馏进度

- 已确认模块：immutable notification generations、四类 retry/finalize 时序、旧 token/status/ack 与 relay 文件清理、boot+PID+starttime 锁身份、O_EXCL/0600/no-replace relay、retry visibility gate、R1/R2 全部修复、actor-bound draft/no-send。
- 未解决模块：Task7 runtime manifest 总审计与重签；历史空 sender address 记录仅支持 exact correlation。
- 下一优先知识缺口：Task7 capability inventory 与 manifest 一致性验证。

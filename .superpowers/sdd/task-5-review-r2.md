# Task 5 R2 Independent Review

## Verdict

- **Spec: FAIL / changes required**
- **Quality: FAIL / changes required**
- **Critical:** 0
- **Important:** 6
- Reviewed range: `711fde0..189d195`
- The known stale global runtime manifest is excluded from this Task 5 verdict and was not re-signed.

R2 correctly repairs header precedence, monotonic terminal-state persistence, terminal draft eligibility, the tested quoted-history case, authoritative full-text retry with post-provider authorization, and internal event-key isolation. It also adds a real database claim/ack/nack surface and watcher relay. However, the relay is not crash/concurrency safe, the sanitizer still misses required private data, and two notification lifecycle transitions leave stale or unusable cards.

## Important findings

### S1. Two watcher processes can claim two rows and overwrite one relay file

`claimAndQueueReply()` checks `pending.json`/`inflight.json` before awaiting the API claim, then writes a private temporary file and calls `renameSync(temporary, spoolPath)` (`.runtime/vm_debug_ci/workspace/scripts/matrix-watch.js:229-259`). The check and final rename are not protected by a shared lock or no-replace operation. POSIX rename replaces an existing destination.

Fresh reproduction with two overlapping calls produced:

```json
{"results":[{"status":"queued","id":51},{"status":"queued","id":52}],"stored":52}
```

Both database claims succeeded for different notifications, but the second relay record overwrote the first. Notification 51 remains `inflight` without a file and later becomes `manual_review`; its card is never delivered. The database CAS prevents two claims of one row, but it does not serialize the single-slot filesystem relay.

Use an atomic filesystem ownership/queue model that cannot replace an existing record, or remove the single JSON slot in favor of a durable per-notification queue. Add a two-process/two-connection test that overlaps the empty check, API claim, and file publication.

### S2. Ack/nack response loss or a crash after database finalization can permanently wedge the relay

`deliverQueuedReply()` performs DB ack/nack and only then unlinks the inflight file (`.runtime/vm_debug_ci/workspace/extensions/stream-card.cjs:102-129`). Recovery of any existing inflight file always sends `nack(... ambiguous)` before unlinking (`:107-112`).

Failure sequence:

1. Card send succeeds.
2. `ackNotification` commits `delivered`, but the HTTP response is lost, or the process exits before `unlinkSync`.
3. The inflight file remains.
4. Recovery sends ambiguous nack with the old token; the DB row is already `delivered`, so `claimedRow()` throws claim mismatch.
5. The file is not removed. Watcher claim stays `busy` forever and the card preview remains on disk indefinitely.

The same wedge occurs when an explicit-failure nack commits `pending` and the process exits before unlink. Ack/nack need replay-safe recorded results scoped to notification/token/request, and recovery must distinguish already-delivered, already-nacked, still-inflight, and unknown outcomes before cleanup. Relay cleanup should be independently retryable and must not depend on successfully mutating an already-final row.

### S3. Pending translation retry can become ready without any path to a ready card or draft action

A pending notification is delivered and marked `delivery_state='delivered'`. The pending card contains only `Retry translation`. Successful retry updates translation fields in that same row but does not change its delivery state or notification key (`src/services/matrixStreamCorrelation.js:500-515`). The extension then sends only an informational status card (`.runtime/vm_debug_ci/workspace/extensions/stream-card.cjs:634-643`); it does not render a ready notification with `View reply draft`.

Because `claimNotification()` only selects `pending` delivery rows (`src/services/matrixStreamCorrelation.js:230-238`), the ready row is never claimed again. The original card still has no draft button, so the user cannot reach the promised draft action through this flow.

On successful retry, atomically create/requeue a new ready notification revision with an idempotent delivery key, or return the fixed safe ready projection and replace/send a ready card. Add an end-to-end pending-card -> retry-ready -> one ready card -> one draft action test.

### S4. A higher-priority terminal event does not cancel an already-pending reply notification

R2 prevents a late reply from creating a new spool row and `startReplyDraft()` checks the current work-item state. But when an initial reply already created a pending notification and a later unsubscribe/manual stop suppresses the work item, the existing notification remains `delivery_state='pending'`. `claimNotification()` joins the current work item only for owner authorization; it does not require current `stream_state='replied'` or otherwise retire stale notifications (`src/services/matrixStreamCorrelation.js:230-238`).

The watcher can therefore deliver a stale “收到回复” card showing stored state `replied` after the item is suppressed. Its draft button later fails authorization/state checks, producing a confusing dead action. The higher-priority terminal transition should atomically cancel/manual-review any undelivered reply notification, and claim should fail closed against current terminal state. Add reply -> pending spool -> unsubscribe -> claim-empty coverage.

### Q1. Lease expiry is not enforced during ack/nack finalization

Claims store a lease and the next claim pass moves expired inflight rows to `manual_review` (`src/services/matrixStreamCorrelation.js:212-250`). But `claimedRow()` validates only state and token, not `lease_expires_at` (`:253-261`). `ackNotification()` computes the current clock but never compares it with the lease (`:264-277`); nack has the same issue.

After expiry, a stale worker can still mark the row delivered if its ack transaction wins immediately before a scavenger transaction; if scavenging wins, the same ack fails. Thus an expired claim has a nondeterministic outcome based on transaction order. Enforce an unexpired lease in the same immediate finalization transaction, and test stale ack/nack racing an expiry scavenger across two connections.

### Q2. Central redaction still leaks explicit private formulas and common inline credentials

`redactSensitiveText()` covers PEM blocks, auth headers, credential URLs, token query parameters, and secret keys only when they begin a line (`src/lib/safeText.js:3-10`). It has no private-formula/private-cost rule and misses inline credential labels.

Fresh probes remained unchanged:

```text
internal formula=cost+margin
private cost: resin+conversion
note: password = very secret
credentials password: topsecret
```

These values can be persisted in `original_preview` and the relay card file, contrary to the Task 5 safe-spool boundary. Extend the centralized policy to the explicitly excluded formula/cost labels and bounded inline credential forms, and assert the secret/formula value itself is absent rather than merely checking for selected key names.

## Previous Important findings disposition

| R1 finding | R2 result |
|---|---|
| Spool undiscoverable/no claim-ack-nack | **Partially fixed**: DB/API/watcher path exists; S1-S2 remain |
| `In-Reply-To` polluted by `References` | **Fixed** |
| Later terminal reason rolls back | **Fixed** for durable state; S4 remains for queued card lifecycle |
| Refusal enters draft path | **Fixed** |
| Quoted unsubscribe history | **Fixed for covered authored-history forms** |
| Preview sanitizer | **Partially fixed**; Q2 remains |
| Retry uses truncated preview/no commit auth | **Fixed**; S3 is a separate post-retry card lifecycle gap |
| Internal event-key collisions | **Fixed** |

## Confirmed behavior

- Unique direct `In-Reply-To` now takes precedence; ambiguous References remain review-only.
- Message-ID mutation dedupe and ambiguous zero-work-item mutation remain correct.
- Terminal work-item states are monotonic; the reply check closes once; terminal/refusal notifications cannot create drafts.
- Retry reloads linked durable email text and rechecks active actor, binding, and ownership after the provider await.
- Internal event keys are UUID-backed and reserved separately from client idempotency keys.
- Claim authorization is actor/binding/owner scoped. Database claim selection/update is inside an immediate transaction and prevents two connections from claiming the same row.
- Relay files are created with mode `0600`; normal delivered/failed/ambiguous paths remove them. S2 describes the unresolved finalization/crash retention window.
- Card code has no email delivery action. Draft creation remains actor-bound, idempotent, and creates no Matrix delivery job.
- API bodies remain narrow and reject caller-provided send/content fields.
- IMAP correlation remains post-upsert; fixed diagnostics do not roll back the durable inbound row.

## Verification evidence

- `node scripts/test-matrix-stream-correlation.js` — PASS.
- `node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js` — PASS.
- `node scripts/test-matrix-api.js` — PASS with localhost binding permission.
- Direct two-watcher relay race — reproduced silent file replacement as shown in S1.
- Direct sanitizer probes — reproduced the four retained sensitive strings shown in Q2.
- Static finalization trace — confirmed ack/nack are non-replayable, do not enforce lease expiry, and cleanup occurs only after the DB call.
- `git diff --check` on the review report — PASS.

## Required repair order

1. Replace/serialize the single-slot relay and make ack/nack plus recovery replay-safe.
2. Enforce lease expiry atomically during finalization.
3. Complete pending-translation ready-card delivery and retire stale reply notifications on higher-priority terminal transitions.
4. Complete the centralized formula/inline-secret redaction boundary.

## 蒸馏进度

- 已确认模块：header precedence、Message-ID dedupe、单调 terminal work-state、reply-check exactly-once、terminal no-draft、authoritative retry 与二次授权、内部事件键、DB actor-bound claim CAS、API/card no-send。
- 未解决模块：relay 跨进程单槽竞态、ack/nack crash replay 与文件清理、lease finalization、retry-ready 卡片续接、terminal 后旧通知取消、公式与行内凭据脱敏。
- 下一优先知识缺口：notification relay 的 durable outbox/receipt 协议与卡片 revision 状态机。

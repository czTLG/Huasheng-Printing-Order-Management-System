# Task 3 R3 Final Independent Review — Narrow Matrix Review APIs

## Verdict

- **Spec Compliance:** ✅ PASS
- **Code Quality:** APPROVED
- **Decision:** APPROVED
- **Critical:** 0
- **Important:** 0
- **Moderate:** 0

R3 resolves the remaining concurrent exact-replay defect. No blocking correctness, authorization, atomicity, disclosure, or scope issue was found in `dca6d34..142dda2`.

## Concurrent Exact Replay

- A globally unique durable claim is acquired before candidate/provider work and binds actor, work item, action, canonical request fingerprint, opaque owner token, and bounded lease.
- Two overlapping identical successful revisions return authoritative statuses `[200, 201]`, the same version ID, invoke the provider exactly once, and create exactly one immutable request-ledger row and one review event.
- An active-claim request with a changed instruction/fingerprint returns stable 409 immediately and does not wait for or invoke the provider.
- A sequential exact replay is resolved from the immutable ledger before stale checks, candidate loading, or provider invocation.
- New-key stale requests still fail before provider work.

## Claim, Lease, and Recovery Safety

- Claim identity fields—idempotency key, actor, work item, action, request fingerprint, and creation time—are protected by an immutability trigger.
- Active claims are polled only for the same scope. The bounded wait timeout returns stable `503 review_in_progress`, invokes no provider, writes no transition, and does not delete another owner's claim.
- Expired claims are taken over only after fresh expected-version authorization and an owner-token plus exact-expiry compare-and-swap. Successful takeover invokes the provider once, commits one transition/ledger result, and removes the owned claim.
- Finalization rechecks exact scope, owner token, finite unexpired lease, fresh actor/binding/capability/owner/suppression/version authorization, then performs service transition, response-ledger insertion, and conditional owner cleanup in one immediate transaction.
- Forced owner-token replacement during provider work returns stable `409 review_claim_lost`. No version, event, ledger, job, evidence, or work-item transition is committed, and cleanup cannot delete the replacement owner's claim.
- Failure cleanup deletes only `(idempotency_key, owner_token)` owned by the current request. A crashed process leaves the durable lease for bounded recovery.

## Authorization and Scope

- Mutations require bridge authentication, an active binding tied to the exact binding ID/open ID/actor, an active allowed-role actor, freshly parsed persisted permissions with explicit `matrixSend`, current ownership, non-suppression, and expected work-item version.
- Fresh authorization is performed inside the same committing immediate transaction. Binding/capability revocation during provider wait is covered and produces zero review-state change; owner/suppression use the same transactional check.
- Ledger and claim matching independently compare actor, work item, action, and canonical fingerprint. Action-specific fingerprints include expected version plus base/instruction or target version/hash, preventing cross-actor, cross-work, cross-action, changed-target, changed-hash, changed-base, and changed-instruction replay.
- Historical replay returns immutable original response fields plus separately named current version/status fields and cannot mutate past response state.

## Atomicity and Immutability

- Initial recipient-evidence insertion, quality validation, version/event/work-item transition, immutable API-ledger insertion, and owned-claim deletion are atomic.
- Revision and approval finalize through the same outer transaction. Nested service transitions roll back if ledger insertion or claim cleanup fails.
- Committed API request rows reject update and delete. Claim identity rejects mutation while owner/lease fields remain CAS-updatable for controlled takeover.
- Candidate drift after initial creation does not affect exact replay. A new key revalidates current email, source, official evidence, specifications, and eligibility and fails closed when they are absent.

## Errors and Information Boundaries

- Provider unavailable/failure, active wait, lease loss, idempotency conflict, stale state, forbidden, not-found, validation, and unexpected failures map to stable structured public errors.
- Injected provider/storage diagnostics containing tokens, internal paths, SQL, SQLite, and SMTP-like strings do not enter responses. Server logs contain only redacted error classes.
- Unknown fields, missing email, contact-form-only records, missing evidence, foreign official evidence, stale version/hash, ownership failure, and permission failure remain zero-write cases.

## Historical Requirements

- Request bodies retain exact allowlists; base version and revision instruction remain paired.
- Recipient, source, evidence snapshot, and initial bilingual content are server-derived. The reviewed service enforces same-organization private-PSL binding for organization, email, and source.
- Provider unavailable fabricates no revision and writes no review state.
- Approval verifies persisted canonical content hash and expected work version.
- Preview reads persisted content/quality/eligibility only, validates owner/path scope, and creates no job.
- JWT fallback cannot authorize review mutations; invalid bridge credentials do not fall through.
- No send/confirm route, delivery implementation, transport call, SMTP action, credential handling, attachment handling, retry, or external communication was added.

## Verification Evidence

- `node scripts/test-matrix-api.js` — PASS with localhost permission, including concurrent exact replay, mismatch, timeout, expired takeover, immutable claim identity, lease loss, atomic cleanup, authorization revocation, drift replay, and error redaction.
- `node scripts/test-matrix-stream-review.js` — PASS.
- `node scripts/test-matrix-stream-gates.js` — PASS.
- `node scripts/test-matrix-policy.js` — PASS.
- `node scripts/test-packet-gate.js` — PASS.
- `node scripts/test-admin-access-regression.js` — PASS.
- `node scripts/smoke-test.js` — PASS with localhost permission.
- `node --check src/db.js src/routes/matrix.js src/server.js scripts/test-matrix-api.js` — PASS.
- `git diff --check dca6d34..142dda2` — PASS.
- Added-line static scan found no delivery/mail/SMTP/credential/attachment primitive; only the deliberately unused `deliveryService` dependency name matched.

## 蒸馏进度

- 已确认模块：并发 exact replay、provider 单调用、immutable ledger、durable claim/lease/CAS、timeout 与 expired takeover、lease-loss 零 transition、原子 finalize/cleanup、事务内 fresh 授权、fingerprint scope、candidate drift、错误脱敏、历史 API/门禁与无 delivery 能力。
- 未解决模块：生产 provider 的真实自由修改验收、更多有官方证据支撑的品类/规格模板、最终确认与交付；均不属于 Task 3。
- 下一优先知识缺口：扩展更多候选品类的官方证据模板与规格映射，未确认前继续 fail closed。

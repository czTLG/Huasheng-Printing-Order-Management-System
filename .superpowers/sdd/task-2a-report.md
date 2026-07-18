# Task 2A Report — Explainable Gates and Reply Checks

## Status

DONE_WITH_CONCERNS

## Scope

- Added deterministic 100-point draft quality scoring with per-component reasons, evidence ids, and hard failures for unsupported price, certification, supplier, performance, delivery, and lead-time claims.
- Added fail-closed initial-contact evaluation across existing CRM identities, inquiries, orders, CRM messages, suppression events, accepted jobs, and caller-supplied candidate aliases. Exact identities route as existing relationships; similar cross-domain names are review-only and are never merged.
- Added dependency-injected sender readiness for SPF, DKIM, DMARC, TLS, and verification status, with selector-aware 24-hour persistence and an explicit, unexpired country/channel policy requirement.
- Added a `list`/`set` country-policy operator tool. `set` requires an active `super_admin`, one exact ISO country, one exact channel, an explicit status, review/expiry timestamps, and at least one HTTPS source URL. Changes write redacted audit summaries.
- Added third-weekday-at-10:00 Asia/Shanghai reply-check scheduling after accepted jobs, unique originating-job persistence, and terminal closure for reply, bounce, refusal, unsubscribe, or manual stop.
- Added canonical quality persistence inside create/revise transactions. Low-scoring drafts remain approvable for internal review, while final preview and final confirmation fail closed.
- Added the minimal `matrix_stream_reply_checks` schema and due-state index.
- Did not add or invoke delivery, mailer, credential, or external-message functionality. No route or quotation-workflow changes were made.

## RED / GREEN evidence

1. Quality scoring
   - RED: `node scripts/test-matrix-stream-gates.js` failed with `MODULE_NOT_FOUND` for `matrixStreamGate`.
   - GREEN: the exact maxima fixture scored 100 and unsupported price/certification/lead-time claims blocked.
   - RED repair: mismatched `USD 0.50` evidence incorrectly supported `USD 0.05`, and BRC evidence incorrectly supported FDA.
   - GREEN repair: normalized exact claim fragments no longer collide; all six unsupported categories block independently.
2. Identity, cooling, and quota
   - RED: `evaluateInitialContact is not a function`.
   - GREEN: exact email/domain and order relationships route correctly; the 90-day domain window, Shanghai accepted limit of five, suppression, and possible-duplicate review all pass without row deletion or merging.
3. Readiness and policy
   - RED: both readiness and policy tests failed with their expected module-not-found errors.
   - GREEN: injected checks, selector-aware cache reuse, named hard failures, expired/missing policy behavior, super-admin authorization, exact flags, and redacted audit assertions pass.
   - RED repair: a directly persisted HTTP source URL or disabled policy requirement bit was incorrectly treated as approved.
   - GREEN repair: policy consumption revalidates HTTPS sources and both required safeguards on every check.
4. Follow-up
   - RED: module-not-found for `matrixStreamFollowup`.
   - GREEN: Friday and weekend inputs both resolve to Wednesday 10:00 +08:00; accepted jobs create one reply check, duplicate calls do not mutate/reopen it, and terminal events clear active due state.
5. Version quality persistence
   - RED: Task 2 regression observed `quality_json === '{}'` after initial version creation.
   - GREEN: create/revise persist canonical quality results; existing low-score approval succeeds, final preview reports blocked, and final confirmation rejects.
   - Debug evidence: the first GREEN patch placed revise scoring under approval because of an ambiguous context match; the regression consistently failed at that line. The block was moved to the revise transaction and the full Task 2 test passed.

## Verification

- `node scripts/test-matrix-stream-gates.js` — PASS.
- `node scripts/test-matrix-policy.js` — PASS.
- `node scripts/test-matrix-stream-review.js` — PASS.
- `node scripts/test-packet-gate.js` — PASS.
- `node scripts/smoke-test.js` — PASS.
- `node scripts/test-matrix-api.js` — initial sandbox run failed only because binding `0.0.0.0:21002` returned `EPERM`; rerun through the approved localhost test path PASS.
- `node --check` on all changed/new JavaScript files — PASS.
- Static scan for mailer/send/delivery primitives and credential environment names in changed services/tool — no matches.
- `git diff --check` — PASS.

## Independent-review repair

- Quality semantics RED: an unrelated English availability question plus a conflicting Chinese tea/carton/mood message previously scored 100. GREEN: product points now require the same evidence-backed specifications and category concepts in both languages; company points require that aligned observed range; entry value requires the same concrete entry concepts; question points require one-to-three matching recognized intents; bilingual points require all key facts and numeric specifications to align. Readability and provenance no longer copy unrelated evidence ids.
- Provenance RED: stale evidence and a source on an unrelated domain could pass the standalone scorer. GREEN: public-company kind, HTTPS email/source domain binding, non-future verification, and 180-day freshness are a hard gate.
- Claim-key RED: 15 versus 10 days, 6 versus 12 months, Brand A versus Brand B, and July 20 versus July 30 collided. GREEN: every sensitive statement produces a type plus its complete NFKC-normalized statement key, preserving numbers, units, named objects, and dates; only the identical normalized evidence key supports it.
- Identity RED: an accepted job for the same domain routed as initial contact; a standalone inbound CRM reply routed as cooling; a missing relation was treated as empty. GREEN: the single read transaction requires all identity relations, joins accepted jobs to persisted version recipients for the exact 90-day interval, and classifies exact inbound CRM history as an existing relationship.
- Policy RED: `ZZ` and unlisted channels were accepted, and audit time reused caller-controlled `reviewedAt`. GREEN: a fixed offline ISO alpha-2 membership set and exact channel allowlist are enforced by parsing and persistence; audit `created_at` comes from the operation clock while `reviewed_at` remains business data.
- Follow-up RED: scheduling a later active check replaced the earlier due state, then closing the earlier check cleared the still-active later check. GREEN: schedule and close run in immediate transactions and recompute `MIN(due_at)` across all active checks; only closing the final active check clears work-item due state.

## Concerns

- Similar-name matching is deliberately narrow and deterministic. Names outside the normalized legal-suffix equivalence require an explicit alias from the reviewed candidate context; aliases only produce `possible_duplicate_review`.
- The 90-day cooldown derives domain history from persisted CRM contact fields. Rows without a parseable contact domain do not create an inferred identity.
- Weekdays exclude Saturday and Sunday; no public-holiday calendar is inferred.
- Source URLs are validated as explicit HTTPS URLs without performing network access. Authority remains a reviewed operator judgment captured by the policy record and audit event.
- Sender readiness invokes only injected verification dependencies and persists their booleans. This task contains no transport construction or delivery operation.

## 蒸馏进度

- 已确认模块：语义一致质量评分与精确 claim keys、身份/accepted-job 冷却/日配额、sender readiness、ISO 国家渠道策略、并发安全第三工作日 reply check、版本质量持久化与最终质量门禁。
- 未解决模块：不同国家的具体政策内容、法定节假日工作日历、后续真实交付集成；均不属于 Task 2A。
- 下一优先知识缺口：逐国家/渠道的权威政策来源和复审周期，由 `super_admin` 审阅后逐条录入，禁止默认批准。

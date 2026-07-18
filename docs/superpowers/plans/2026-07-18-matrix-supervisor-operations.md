# Matrix Supervisor Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind reviewed costs to versioned quotes, turn historical freight into reviewable FOB bases, deliver copyable private text, and expose one mobile/desktop operating dashboard.

**Architecture:** Extend the management database with immutable quote/freight/copy projections linked to Matrix Core items and tasks. Reuse the existing cost snapshots, `freight_quotes`, CRM timeline, Stream review/delivery, and Feishu client. Customer-facing content remains a reviewed version; cards trigger generation but never substitute for copyable text.

**Tech Stack:** Node.js 22, CommonJS, Express, `better-sqlite3`, React/TypeScript/Vite, Feishu CardKit, Playwright/Node browser tests.

## Global Constraints

- Quote, contact, customer, item set, cost snapshots, recipient, and content version are exact immutable bindings.
- Formal numeric results require reviewed calculator output, current sources, explicit margin, and authorized approval.
- Historical freight is an internal basis until current forwarder review; never label it current formal freight.
- Feishu cards are decision interfaces; copyable text is a separate private plain-text message to the clicking operator.
- Group receipts contain no internal cost, margin, formula, contact value, Message-ID, or protected source.
- WhatsApp remains manual/copyable; email remains two-confirmation only.

---

### Task 1: Quote Number and Immutable Versions

**Files:** create `src/services/matrixQuote.js`, `src/routes/matrixQuote.js`, `scripts/test-matrix-quote.js`; modify `src/db.js`, `src/routes/matrix.js`, `src/server.js`.

```js
quote.create({ organizationId, contactId, inquiryId, itemIds, costSnapshotIds, currency, tradeTerm, actorUserId, idempotencyKey })
quote.revise({ quoteId, expectedVersion, patch, actorUserId, idempotencyKey })
quote.review({ quoteVersionId, expectedContentHash, decision, actorUserId, idempotencyKey })
quote.customerView({ quoteVersionId })
```

- [ ] Write RED tests for permanent quote number on first formal save, V2/V3 revisions, exact contact/item/snapshot binding, stale hash, cross-customer rejection, and no formal number for an unsaved draft.
- [ ] Add RED concurrent-first-save, exact revision allowlist, idempotency-payload mismatch, actor ownership/fresh permission, and approval invalidation for recipient/contact/item/snapshot/currency/trade-term/customer-field/attachment changes.
- [ ] Run `node scripts/test-matrix-quote.js`; expect missing service/tables.
- [ ] Add immutable quote/version/item/snapshot bindings and append-only events; revisions never mutate prior versions.
- [ ] Generate customer view through the reviewed calculator/customer-output boundary; retain calculator/source/confirmer/date evidence internally while proving internal IDs, notes, formula, cost, and margin cannot appear.
- [ ] Run quote, costing, permission, and API tests; expect PASS.
- [ ] Commit `feat: version matrix quote records`.

### Task 2: Item-to-Costing Import and Review

**Files:** create `src/services/matrixCostingImport.js`, `scripts/test-matrix-costing-import.js`; modify `src/routes/cost.js`, `src/routes/crm.js`, relevant Cost UI components/tests.

- [ ] Write RED tests proving one inquiry item imports normalized confirmed fields and source evidence, leaves unknown fields blank, binds the created request, and never imports another item's data.
- [ ] Add RED cases for multiple schemes, manual edits creating a new input version, accepted snapshot readback, and unconfirmed material/price/margin blocking formal readiness.
- [ ] Run focused tests; expect missing import service.
- [ ] Implement preview/apply with exact allowlist and provenance; add `Import from inquiry item` and review/edit UI.
- [ ] Run costing backend tests and frontend TypeScript/browser form tests.
- [ ] Commit `feat: import matrix items into costing review`.

### Task 3: Freight Basis and FOB Review

**Files:** create `src/services/matrixFreightBasis.js`, `src/routes/matrixFreight.js`, `scripts/test-matrix-freight-basis.js`; modify `src/db.js`, `src/routes/crm.js`, `src/routes/matrix.js`.

```js
freight.matchBasis({ inquiryId, itemIds, destination, tradeTerm, weightVolumeBasis, asOf })
freight.prepareReview({ basisId, inquiryId, itemIds, actorUserId, idempotencyKey })
freight.confirmCurrent({ reviewId, sourceQuoteId, validityAt, actorUserId, idempotencyKey })
```

- [ ] Write RED tests for `historical_basis`, `pending_review`, `current_confirmed`, `expired`, and `superseded`; require route/port/destination/basis compatibility and match explanation.
- [ ] Assert every projection contains route/breakdown basis, allocation method, source date, unresolved assumptions, recommended port, and exact facts-to-confirm; missing fields remain explicit.
- [ ] Prove missing weight/volume or stale source blocks formal allocation but can produce a labeled internal estimate question set.
- [ ] Prove historical data never becomes current without a new source/confirmation and no freight arithmetic is invented in prose.
- [ ] Add transactional fresh authorization/source/route/item/expiry validation before `confirmCurrent`; malicious caller source/validity/cross-item inputs fail closed.
- [ ] Implement versioned basis selection over existing `freight_quotes`, task binding, provenance, and an authenticated manual receipt event that marks only the operator's external forwarder action; preparing copy never marks it sent.
- [ ] Run freight/CRM/task tests; expect PASS.
- [ ] Commit `feat: review matrix freight bases`.

### Task 4: Copyable Private Text Outbox

**Files:** create `src/services/matrixCopyOutbox.js`, `scripts/test-matrix-copy-outbox.js`; modify `src/db.js`, Matrix API/client/card/watcher and their tests.

```js
copy.prepare({ actorUserId, cardEventId, receivedChatId, sourceType: 'atlas_reviewed_packet'|'matrix_quote_version'|'matrix_freight_review', sourceVersionId, formats, idempotencyKey })
copy.claim({ ownerToken, leaseMs, now }) // returns deliveryNonce once; persistence stores only its SHA-256 hash
copy.authorizeDelivery({ outboxId, claimToken, deliveryNonce, now })
copy.ack({ outboxId, claimToken, platformMessageId })
copy.nack({ outboxId, claimToken, outcome })
```

- [ ] Write RED tests for explicit `Generate customer content`; the service reloads the current actor binding and derives the private open ID server-side. Caller open ID/target/callback fields are rejected.
- [ ] Add RED substituted-open-ID, stale/disabled binding, cross-chat/cross-organization source, replay, and target-change-after-claim cases; revalidate actor/permission/source/chat/private target at prepare and claim.
- [ ] Add a RED claim-to-send race: immediately before the platform call, `authorizeDelivery` must reload binding/permission/source/target and return a single-use authorization valid for at most 30 seconds. Revocation or target change after claim returns no authorization and the watcher performs zero platform sends.
- [ ] Add RED nonce tests proving `claim` generates a cryptographically random 32-byte `deliveryNonce` server-side, returns the plaintext exactly once, stores only its SHA-256 hash, never logs/serializes the plaintext, and rejects caller-supplied, stale, wrong-outbox, wrong-claim, and replayed nonces. Two concurrent `authorizeDelivery` transactions for one nonce must yield exactly one authorization.
- [ ] Bind idempotency to actor + source version + formats + card event; prove paired `EMAIL EN`/`中文说明`/`WHATSAPP EN`/`货代复核` and group receipt only.
- [ ] For `atlas_reviewed_packet`, reload the canonical packet/content hash and `allowed_formats` server-side; omit unavailable formats and reject any callback-supplied text or mismatched source type/version.
- [ ] Add RED security tests for no internal breakdown/margin/formula/token/contact/raw diagnostics/Message-ID and no sent-state mutation.
- [ ] Add lease/restart/duplicate-click/ambiguous-delivery tests.
- [ ] Implement durable outbox and narrow client/watcher private-message delivery; generate the nonce with `crypto.randomBytes(32)`, persist only `sha256(deliveryNonce)`, compare hashes safely, and atomically mark the hash consumed in the same immediate transaction that revalidates and grants authorization. No SMTP/WhatsApp transport.
- [ ] Run copy, card, runtime, manifest, and redaction tests.
- [ ] Commit `feat: deliver matrix copyable text`.

### Task 5: Supervisor Dashboard and Mobile Cards

**Files:** create `frontend-next/src/components/crm/MatrixSupervisorDashboard.tsx`, `scripts/test-matrix-supervisor-dashboard-api.js`, `tests/ui/matrix-supervisor-dashboard.e2e.js`; modify `frontend-next/src/components/crm/CrmModule.tsx`, `CrmDashboard.tsx`, customer/inquiry detail, `src/routes/crm.js`.

- [ ] Write RED API projection tests for today's Bill queue, VMCI decisions, item matrix, overdue/blockers, communications, cost/quote history, freight basis, knowledge candidates/active/superseded rules/scenario attention, source freshness/Atlas backlog, and delivery/reply/bounce/suppression/conversion metrics.
- [ ] Add filters for stage, priority, China-fit, source, country, category, and owner; test role masking, cross-organization rejection, raw-contact suppression, and API/Feishu projection equivalence.
- [ ] Write RED desktop/mobile browser tests for wrapped rows, usable row height, compact cards, filter/scroll restoration, and opening the correct customer/item/version.
- [ ] Implement one responsive dashboard using existing style primitives; no duplicated business calculations in React.
- [ ] Add explicit actions `Review`, `Generate customer content`, `Ask factory`, `Prepare forwarder review`, and `Set due date`; no direct send shortcut.
- [ ] Run API tests, `npm --prefix frontend-next run lint`, build, and browser tests.
- [ ] Commit `feat: expose matrix supervisor dashboard`.

### Task 6: Management-Only Delivery Wiring

**Files:** create `src/services/matrixDeliveryFactory.js`, `scripts/test-matrix-delivery-wiring.js`, `scripts/check-matrix-sender-readiness.js`, `scripts/test-check-matrix-sender-readiness.js`; modify `src/server.js`, `src/routes/matrix.js`, `.env.example`, runtime verifier/tests.

- [ ] Write RED tests proving absent/malformed/not-exactly-`1` `MATRIX_STREAM_SEND_ENABLED` never constructs transport; disabled confirmation creates zero jobs/events and never calls readiness/send.
- [ ] Write RED enabled tests with injected fake protected sender proving route input remains only version/work-item/idempotency identifiers; caller SMTP/recipient/subject/body fields fail.
- [ ] Write the named RED suite `node scripts/test-check-matrix-sender-readiness.js` with an injected sender spy: `--no-send` may exercise configuration/TLS readiness only, cannot resolve or call `sendMail`, and cannot create a delivery job/event. First run must fail because the checker/no-send boundary is absent.
- [ ] Separate sender readiness/TLS connection capability from `sendMail`; make the named RED suite pass and keep no-send readiness incapable of creating a job/event.
- [ ] Implement the factory only inside the management application, behind exact flag and protected configuration; bot runtime remains SMTP-free.
- [ ] Add server-wiring capability mutations and runtime manifest coverage after source review.
- [ ] Run wiring, delivery, API, disabled smoke, and manifest tests; commit `feat: wire restricted matrix delivery`.

### Task 7: Operations Runtime Gate

**Files:** modify `scripts/verify-matrix-readonly-selection.js`, `scripts/test-verify-matrix-readonly-selection.js`, `docs/matrix-stream-catalog-2026-07-16.md`, `.env.example`, `scripts/test-matrix-api.js`, and relevant card/runtime tests only after all operations code stabilizes.

- [ ] Add malicious mutations for caller-supplied quote/contact/item/recipient/freight/source/private target and unauthorized transport.
- [ ] Re-enumerate runtime files and review capabilities before updating digests.
- [ ] Run quote/cost/freight/copy/dashboard/core/relay suites and configured read-only verifier with delivery disabled.
- [ ] Commit `test: gate matrix supervisor operations`.

## Final Operations Verification

```bash
node scripts/test-matrix-quote.js
node scripts/test-matrix-costing-import.js
node scripts/test-matrix-freight-basis.js
node scripts/test-matrix-copy-outbox.js
node scripts/test-matrix-delivery-wiring.js
node scripts/test-check-matrix-sender-readiness.js
node scripts/test-matrix-supervisor-dashboard-api.js
node scripts/test-matrix-core-ledger-api.js
node scripts/test-matrix-api.js
node scripts/test-admin-access-regression.js
node scripts/test-matrix-stream-delivery.js
node scripts/test-matrix-stream-correlation.js
node scripts/test-verify-matrix-readonly-selection.js
node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js
node .runtime/vm_debug_ci/workspace/tests/test-matrix-supervisor-watch.js
npm --prefix frontend-next run lint
npm --prefix frontend-next run build
node scripts/run-ui-e2e.js
git diff --check
```

## 蒸馏进度

- 已确认模块：报价编号与版本、询盘品项导入核算、FOB历史依据、货代复核、可复制私聊、桌面/手机主管看板。
- 未解决模块：实施和真实浏览器验收尚未执行。
- 下一优先知识缺口：确认官网权威公司事实块与正式报价单中允许公开的字段。

# Matrix Supervisor Core and Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one authoritative multi-item workflow, proactive task supervisor, exact Bill/VMCI routing, append-only conversation archive, confirmed A–D knowledge, and reviewable manual-result learning.

**Architecture:** Add small services over the existing management SQLite database and expose them through focused Matrix subrouters. The management application owns all business truth; the Feishu runtime is a narrow authenticated client and card renderer. Current state is a rebuildable projection over immutable events.

**Tech Stack:** Node.js 22, CommonJS, Express, `better-sqlite3`, Feishu CardKit extension, Node `assert`, existing Matrix bridge authentication.

## Global Constraints

- Start from a clean relay-inclusive integration worktree, never the dirty primary worktree.
- Bill and VMCI bind by exact immutable chat IDs, never display names.
- Persist every relevant conversation event before interpretation or action.
- Completing one item never completes an inquiry with another required item pending.
- Unconfirmed knowledge never changes calculations, prices, materials, processes, or customer output.
- Option D requires a second broader review; first confirmation does not create a general rule.
- Manual accepted results update only the exact linked item and create a difference packet; no silent learning.
- Numeric calculation remains in Matrix Build Cache; this plan compares/provenances but does not calculate.
- No external send, deployment, or enable-flag change is authorized by this plan.
- Internal names remain neutral Matrix codenames.
- Every business mutation is bound to an exact inquiry item and an immutable version/evidence record; no service may infer a binding from names or recency.

**Canonical conversation identity:** `conversationId = sha256(platformNamespace + NUL + immutableChatId + NUL + (immutableRootThreadId || immutableRootMessageId || 'threadless'))`. Only the server computes it; display names and mutable message text are forbidden inputs.

**Canonical source-link contract:** business-source identity and source-version evidence are separate. `matrix_item_source_links` is the stable identity link from exactly one source of type `father_review_task | order | work_order` to exactly one `matrix_inquiry_item`; ordinary item state/version changes do not mutate or stale this identity link. `matrix_source_version_events` records immutable `{ sourceType, sourceId, sourceVersion, sourceContentHash }`. `matrix_item_source_version_bindings` binds one active identity link to exact `{ sourceVersionEventId, sourceVersion, sourceContentHash, boundItemVersion, specificationId, specificationVersion }`. A source identity has only one active item link, and each binding tuple is immutable; rebinding or a new source revision creates a new binding plus a supersession event after explicit review.

**Result-source contract:** `matrix_item_source_links` is only for the three business sources above. Costing requests bind through `costing_requests.inquiry_item_id + specification_id`; accepted snapshots bind through `cost_snapshots.inquiry_item_id + specification_id + content_hash`; proposal drafts bind through their item/specification foreign keys plus immutable content hash. Task 8 validates these result sources independently and never inserts them into the business-source link table.

**Execution discipline:** Each checkbox is one bounded action. Every newly named test file is run RED immediately after it is written, with the expected failure stated in that task. Only the minimum schema/service change needed for the next GREEN checkpoint may follow. The worker records the command and result at every RED/GREEN checkpoint and commits only after the task's full focused suite passes. No test in an earlier task may import a service, table, route, or task system owned by a later task, and no later task may be started early.

**HTTP error contract:** every Core/Ledger route returns `{ error: { code, message } }`; malformed/unknown properties are `400 invalid_request`, missing records are `404 not_found`, stale versions or conflicting replay are `409 conflict`, inactive/superseded source bindings are `409 stale_binding`, and missing capability or actor/chat mismatch is `403 forbidden`. Replay success is HTTP 200 with `kind: 'replay'`; create success is HTTP 201 with `kind: 'created'` unless the route table below says otherwise.

---

### Task 1: Exact Identity Crosswalk

**Files:**
- Create: `src/services/matrixIdentity.js`
- Modify: `src/db.js`
- Create: `scripts/test-matrix-identity.js`
- Create: `scripts/fixtures/matrix-core/entity-crosswalk.json`

**Interfaces:**

```js
createMatrixIdentity({ db, clock, taskSupervisor })
  .linkExact({ entityType, entityId, namespace, externalKey, matchMethod, evidence, actorUserId, idempotencyKey })
createMatrixIdentity(...).resolve({ namespace, externalKey })
createMatrixIdentity(...).proposeAmbiguous({ candidates, sourceEventId, actorUserId, idempotencyKey })
```

- [ ] Write RED tests proving the allowlisted automatic methods `exact_domain`, `verified_email_domain`, `legal_id`, `lei`, and `confirmed_alias`; caller-supplied method names, approximate address/name, or unverified email fail into one review task and never merge.
- [ ] Add a crosswalk fixture spanning Atlas candidate, CRM customer, public email/WhatsApp identity, inquiry, and order; suppression/revocation must follow the confirmed organization link.
- [ ] Run `node scripts/test-matrix-identity.js`; expect module/table missing failure.
- [ ] Add `matrix_entity_links`, immutable evidence fields, indexes, and service implementation with hashed external keys.
- [ ] Run `node scripts/test-matrix-identity.js` and `node --check src/services/matrixIdentity.js`; expect PASS.
- [ ] Commit only Task 1 files with `feat: add matrix identity crosswalk`.

### Task 2: Inquiry Items and Aggregate Truth

**Files:**
- Create: `src/services/matrixInquiryItems.js`
- Modify: `src/db.js`, `src/routes/crm.js`, `src/lib/crmWorkbench.js`
- Create: `scripts/test-matrix-inquiry-items.js`, `scripts/test-orders-item-source-links.js`, `scripts/test-work-orders-item-source-links.js`
- Create: `scripts/fixtures/matrix-core/four-item-inquiry.json`, `scripts/fixtures/matrix-core/source-version-links.json`

**Interfaces:**

```js
createMatrixInquiryItems({ db, clock }).createItem({ inquiryId, itemKey, title, required, actorUserId, idempotencyKey })
createMatrixInquiryItems(...).bindSpecification({ itemId, specificationId, expectedItemVersion, actorUserId, idempotencyKey })
createMatrixInquiryItems(...).applyState({ itemId, expectedItemVersion, requirementState, costingState, quoteState, disposition, blockerCode, nextAction, evidenceIds, actorUserId, idempotencyKey })
createMatrixInquiryItems(...).aggregateInquiry(inquiryId)
createMatrixInquiryItems(...).recordSourceVersion({ sourceType, sourceId, sourceVersion, sourceContentHash, actorUserId, idempotencyKey })
createMatrixInquiryItems(...).linkSource({ itemId, sourceType, sourceId, actorUserId, idempotencyKey })
createMatrixInquiryItems(...).bindSourceVersion({ itemSourceLinkId, sourceVersionEventId, sourceVersion, sourceContentHash, boundItemVersion, specificationId, specificationVersion, actorUserId, idempotencyKey })
createMatrixInquiryItems(...).resolveSourceVersionBinding({ sourceVersionBindingId, itemId, expectedItemVersion })
```

- [ ] Write RED fixture tests for four items: complete, ready, waiting factory, and waiting customer; assert the inquiry is `partial`, never complete.
- [ ] Add RED cases for stale versions, cross-item specification/request, duplicate item key, terminal disposition without evidence, and legacy unbound request.
- [ ] Run `node scripts/test-matrix-inquiry-items.js`; expect FAIL with `Cannot find module '../src/services/matrixInquiryItems'` or `no such table: matrix_inquiry_items`.
- [ ] Add only `matrix_inquiry_items`, its item events/indexes, and the minimum create/bind/apply/aggregate service code.
- [ ] Run `node scripts/test-matrix-inquiry-items.js`; expect PASS before adding source-link behavior.
- [ ] Write RED service-level cases in `scripts/test-orders-item-source-links.js` and `scripts/test-work-orders-item-source-links.js`: exact source identity links once; source version/hash/event must agree; stale item/specification/source versions fail; a later source revision creates a new immutable binding; ambiguous legacy rows return `needs_migration_review` and create no task or queue. These Task 2 tests must not import attention, result, or task-supervisor modules.
- [ ] Run `node scripts/test-orders-item-source-links.js`; expect FAIL with missing `recordSourceVersion`, `linkSource`, or source-link tables.
- [ ] Run `node scripts/test-work-orders-item-source-links.js`; expect the same focused missing-interface/table failure.
- [ ] Add `matrix_item_source_links`, `matrix_source_version_events`, `matrix_item_source_version_bindings`, immutable supersession events, and uniqueness indexes. Add nullable legacy item-link columns on specifications, costing requests, and snapshots; legacy rows return deterministic `needs_migration_review` projections only.
- [ ] Run `node scripts/test-orders-item-source-links.js` and `node scripts/test-work-orders-item-source-links.js`; expect PASS and prove ordinary item state version changes do not mutate the stable identity link.
- [ ] Write one RED CRM workflow assertion proving completion of one request no longer completes the whole inquiry.
- [ ] Run `node scripts/test-crm-real-workflow-acceptance.js`; expect FAIL on the inquiry-wide completion write.
- [ ] Replace inquiry-wide completion writes with deterministic aggregate recomputation and expose CRM item list/create endpoints through the same service.
- [ ] Run `node scripts/test-matrix-inquiry-items.js`, both source-link tests, and `node scripts/test-crm-real-workflow-acceptance.js`; expect PASS.
- [ ] Commit `feat: add item-level inquiry truth`.

### Task 3: Durable Tasks, Decisions, and Dependencies

**Files:**
- Create: `src/services/matrixTaskSupervisor.js`
- Modify: `src/db.js`, `src/lib/permissions.js`, `shared/permissions-model.json`
- Create: `scripts/test-matrix-task-supervisor.js`
- Create: `scripts/fixtures/matrix-core/task-dependency-chain.json`

**Interfaces:**

```js
tasks.ensureTask({ taskType, ownerRole, channel, dueAt, bindings, blocker, nextAction, evidenceIds, idempotencyKey })
tasks.transition({ taskId, expectedVersion, action, actorUserId, bindingId, channel, chatId, cardEventId, evidence, idempotencyKey })
tasks.createDecision({ taskId, expectedTaskVersion, affectedItemIds, question, recommendedOption, options, idempotencyKey })
tasks.resolveDecision({ decisionId, expectedDecisionVersion, option, actorUserId, bindingId, channel, chatId, cardEventId, idempotencyKey })
tasks.linkDependency({ blockedTaskId, blockingTaskId, resumeAction, idempotencyKey })
```

- [ ] Write RED tests for replay, optimistic versions, `matrixDecide`, cross-record rejection, silence retention, immutable events, and atomic Bill resume after VMCI resolution.
- [ ] Add RED permission regression proving existing `matrixSend` semantics remain unchanged, `matrixDecide` defaults false, `all` grants both, and ordinary roles cannot request either.
- [ ] Add RED cases that consume Task 2 `needs_migration_review` projections and materialize exactly one task per projection; replay creates none, and no secondary review table exists.
- [ ] Run `node scripts/test-matrix-task-supervisor.js`; expect FAIL with missing task service/table, while all Task 2 suites remain PASS.
- [ ] Add `matrix_tasks`, `matrix_task_events`, `matrix_task_dependencies`, `matrix_decisions`, and `matrix_decision_events` with no-update/no-delete triggers.
- [ ] Implement transitions and dependent resume in one SQLite transaction; wire the Task 1 ambiguous-review contract to this service.
- [ ] Implement the projection consumer in Task 3 and materialize one idempotent migration-review task for every Task 2 `needs_migration_review` projection; Task 2 never creates tasks.
- [ ] Run `node scripts/test-matrix-task-supervisor.js` and `node scripts/test-admin-access-regression.js`; expect PASS.
- [ ] Commit `feat: add matrix task supervisor`.

### Task 4: Business-Time Scheduler and Digest Outbox

**Files:**
- Create: `src/services/matrixTaskSchedule.js`
- Modify: `src/db.js`
- Create: `scripts/test-matrix-task-schedule.js`
- Create: `scripts/fixtures/matrix-core/business-calendar.json`

**Interfaces:**

```js
createMatrixTaskSchedule({
  db, clock, timezone: 'Asia/Shanghai',
  billDigest: { hour: 9, minute: 0 },
  vmciDigest: { hour: 10, minute: 0 },
  overdueDigest: { hour: 16, minute: 30 },
  quietHours: { start: '22:00', end: '08:00' }
})
schedule.advance({ now, idempotencyKey })
schedule.prepareDueDigests({ now, idempotencyKey })
schedule.claimDigest({ channel, ownerToken, leaseMs, now })
schedule.ackDigest({ outboxId, claimToken, receiptId, now })
schedule.nackDigest({ outboxId, claimToken, outcome, now })
```

`outcome` is exactly `definite_failure | ambiguous | lease_expired`; only definite failure may return to pending, while ambiguous remains `manual_review` and is never retried automatically.

- [ ] Write RED tests for Asia/Shanghai weekday slots 09:00 Bill, 10:00 VMCI, 16:30 overdue; one/three-business-day escalation; quiet hours; at-most-two follow-up proposals; and silence never completing tasks.
- [ ] Write RED lease/restart tests proving duplicate ticks create one `matrix_digest_outbox` membership hash and ambiguous delivery is not retried automatically.
- [ ] Run `node scripts/test-matrix-task-schedule.js`; expect missing service/table failure.
- [ ] Add the minimum schedule/outbox tables and implement business-calendar arithmetic, leases, idempotency, grouping, and escalation projections.
- [ ] Run `node scripts/test-matrix-task-schedule.js`; expect PASS.
- [ ] Run `node scripts/test-matrix-task-schedule.js` a second time against its restart fixture; expect PASS with identical membership hashes and no duplicate rows.
- [ ] Commit `feat: schedule matrix supervisor tasks`.

### Task 5: Exact Bill and VMCI Routing

**Files:**
- Create: `src/services/matrixChannelPolicy.js`, `src/routes/matrixCore.js`
- Modify: `src/routes/matrix.js`, `src/server.js`, `.env.example`
- Create: `scripts/test-matrix-channel-policy.js`, `scripts/test-matrix-core-ledger-api.js`
- Create: `scripts/fixtures/matrix-core/channel-routing.json`

**Interfaces:**

```js
createMatrixChannelPolicy({ billChatId, vmciChatId }).classifyChat(chatId)
policy.authoritativeChannel(taskType)
policy.assertBoundChat(channel, chatId)
policy.routeIncoming({ chatId, taskType })
```

```js
createMatrixCoreRouter({ items, tasks, schedule, channelPolicy, results = null })
```

Task 5 exposes the following exact contract. `actorUserId`, `bindingId`, `chatId`, owner role, and capabilities always come from authenticated request context and are rejected if supplied in a body.

| Method and literal path | Exact request allowlist | Success response |
|---|---|---|
| `GET /core/inquiries/:id/items` | Path `id`; no query/body | `200 { items, aggregate }` |
| `POST /core/inquiries/:id/items` | `{ itemKey, title, required, idempotencyKey }` | `201/200 { kind, item, aggregate }` |
| `POST /core/items/:id/specifications/:specificationId/bind` | `{ expectedItemVersion, idempotencyKey }` | `200 { item, aggregate }` |
| `POST /core/items/:id/source-versions` | `{ sourceType, sourceId, sourceVersion, sourceContentHash, idempotencyKey }` | `201/200 { kind, sourceVersionEvent }` |
| `POST /core/items/:id/sources` | `{ sourceType, sourceId, idempotencyKey }` | `201/200 { kind, itemSourceLink }` |
| `POST /core/items/:id/source-version-bindings` | `{ itemSourceLinkId, sourceVersionEventId, sourceVersion, sourceContentHash, boundItemVersion, specificationId, specificationVersion, idempotencyKey }` | `201/200 { kind, sourceVersionBinding }` |
| `GET /core/tasks` | Query allowlist `{ channel, state, due_before, limit }`, with `limit` 1–100 | `200 { rows, nextCursor }` |
| `POST /core/tasks/digests/prepare` | `{ now, idempotencyKey }` | `200 { digests }` |
| `POST /core/tasks/digests/claim` | `{ channel, ownerToken, leaseMs, now }` | `200 { claim: null\|claim }` |
| `POST /core/tasks/digests/:id/ack` | `{ claimToken, receiptId, now }` | `200 { state: 'delivered' }` |
| `POST /core/tasks/digests/:id/nack` | `{ claimToken, outcome, now }` | `200 { state: 'manual_review'\|'pending' }` |
| `POST /core/tasks/:id/decisions` | `{ expectedTaskVersion, affectedItemIds, question, recommendedOption, options, idempotencyKey }` | `201/200 { kind, decision, task }` |
| `POST /core/decisions/:id/resolve` | `{ expectedDecisionVersion, option, cardEventId, idempotencyKey }` | `200 { decision, task, resumedTaskIds }` |

Result acceptance and difference classification are intentionally absent until Task 8. All unknown body/query properties use the global `400 invalid_request` response.

- [ ] Write RED tests for exact distinct IDs, empty/equal/malformed/prefix/display-name/unknown rejection, authoritative handoff, replay, and no duplicate customer/inquiry/item/task across chats.
- [ ] Run `node scripts/test-matrix-channel-policy.js`; expect FAIL with missing policy module.
- [ ] Run `node scripts/test-matrix-core-ledger-api.js`; expect FAIL with missing Core router/routes.
- [ ] Implement fail-closed channel policy; add empty env names `MATRIX_BILL_CHAT_ID`, `MATRIX_VMCI_CHAT_ID`, `MATRIX_SUPERVISOR_ENABLED=0` without values.
- [ ] Add only item/source/task/decision/digest Core APIs with exact request allowlists and authenticated actor/chat binding; inject one service set into both JWT and bridge paths.
- [ ] Prove VMCI resolution resumes the exact Bill item without retyping.
- [ ] Run `node scripts/test-matrix-channel-policy.js`, `node scripts/test-matrix-core-ledger-api.js`, and `node scripts/test-matrix-api.js`; expect PASS.
- [ ] Commit `feat: route matrix supervisor channels`.

### Task 6: Archive Before Interpretation

**Files:**
- Create: `src/services/matrixConversationLedger.js`, `src/routes/matrixLedger.js`
- Modify: `src/db.js`, `src/routes/matrix.js`, `src/server.js`
- Create: `scripts/test-matrix-conversation-ledger.js`
- Create: `scripts/fixtures/matrix-ledger/conversation-replay.json`

**Interfaces:**

```js
ledger.append({ conversationId, platformNamespace, immutableChatId, immutableRootThreadId, immutableRootMessageId, idempotencyKey, eventKind, direction, channel, chatId, threadId, platformMessageId, editVersion, cardEventId, actorUserId, bindingId, normalizedText, attachmentRefs, bindings, occurredAt, source })
ledger.requireEvent(eventId, expectedFingerprint)
ledger.timeline({ conversationId, inquiryId, itemId, limit })
```

The server recomputes `conversationId` using the canonical formula above and rejects a supplied mismatch. Message edits use the same immutable platform message identity plus an explicit edit-version key.

```js
createMatrixLedgerRouter({ conversationLedger, knowledgeLedger = null, decisionDistiller = null })
```

Task 6 exposes exactly:

| Method and literal path | Exact request allowlist | Success response |
|---|---|---|
| `POST /ledger/events` | `{ conversationId?, platformNamespace, immutableChatId, immutableRootThreadId?, immutableRootMessageId?, idempotencyKey, eventKind, direction, channel, threadId?, platformMessageId?, editVersion?, cardEventId?, normalizedText?, attachmentRefs?, bindings?, occurredAt, source }`; actor/chat/binding are server-owned | `201/200 { kind, event: { id, conversationId, fingerprint } }` |
| `GET /ledger/timeline` | Query `{ conversation_id?, inquiry_id?, item_id?, limit? }`, at least one identity required, `limit` 1–100 | `200 { rows, nextCursor }` |

The server rejects a supplied `conversationId` that differs from canonical derivation. Knowledge routes are added only in Task 7.

- [ ] Write RED tests for messages, edits, card sends, callbacks, attachments, exact replay, conflicting replay, and immutable triggers.
- [ ] Add a spy proving interpretation/action is never called when the ledger append fails.
- [ ] Run `node scripts/test-matrix-conversation-ledger.js`; expect missing service/table failure.
- [ ] Add append-only `matrix_conversation_events`, safe redaction, source references, content fingerprints, and bounded authorized timeline.
- [ ] Integrate Core/Ledger routers while preserving existing CRM and Stream specialized ledgers by reference rather than copying raw payloads.
- [ ] Run `node scripts/test-matrix-conversation-ledger.js`, `node scripts/test-matrix-core-ledger-api.js`, and `npm run verify:smoke`; expect PASS.
- [ ] Commit `feat: add matrix ledger primitives`; production bot archive-first wiring remains explicitly blocked until Task 9.

### Task 7: A–D Knowledge and Scenario Attention

**Files:**
- Create: `src/services/matrixKnowledgeLedger.js`, `src/services/matrixDecisionDistiller.js`, `src/services/matrixItemVersionOutbox.js`
- Modify: `src/db.js`, `src/services/matrixInquiryItems.js`, `src/routes/matrixLedger.js`, `src/routes/crm.js`, `src/routes/orders.js`, `src/routes/workOrders.js`
- Create: `scripts/test-matrix-knowledge-ledger.js`, `scripts/test-matrix-decision-distiller.js`, `scripts/test-matrix-scenario-triggers.js`, `scripts/test-matrix-item-version-outbox.js`
- Create: `scripts/fixtures/matrix-ledger/knowledge-scopes.json`, `scenario-predicates.json`

**Interfaces:**

```js
knowledge.createCandidate({ sourceEventIds, sourceAcceptanceId, statement, predicates, exclusions, unresolved, conflicts, actorUserId, idempotencyKey })
knowledge.decideScope({ candidateId, expectedContentHash, scope, scopePredicates, actorUserId, bindingId, chatId, cardEventId, idempotencyKey })
knowledge.confirmGeneral({ candidateId, expectedContentHash, exclusions, supportingCaseIds, explicitOwnerDeclaration, actorUserId, bindingId, chatId, cardEventId, idempotencyKey })
knowledge.supersede({ ruleId, expectedVersion, replacementCandidateId, actorUserId, idempotencyKey })
knowledge.matchScenario({ itemId, specificationId })
knowledge.refreshAttention({ itemId, specificationId, sourceEventId, actorUserId, idempotencyKey })
distiller.consumeFatherReply({ fatherReviewTaskId, sourceVersionBindingId, expectedItemVersion, matrixDecisionId, replyEventId, actorUserId, idempotencyKey })
outbox.appendInTransaction({ dbTransaction, entityType, entityId, entityVersion, itemId, specificationId, sourceVersionBindingId, actorUserId, idempotencyKey })
outbox.claim({ ownerToken, leaseMs, now })
outbox.ack({ eventId, claimToken, attentionIds, now })
outbox.nack({ eventId, claimToken, outcome, errorCode, now })
```

`outbox.nack.outcome` is exactly `definite_failure | ambiguous | lease_expired`. Definite failure returns the event to `pending` subject to a bounded retry count; ambiguous or retry exhaustion moves it to `manual_review`; lease expiry permits a later claim. The unique producer key is a stored SHA-256 over canonical JSON `{ entityType, entityId, entityVersion, itemId, specificationId: specificationId || 0 }`, so SQL `NULL` semantics cannot create duplicates. Ack is idempotent after a crash between attention creation and acknowledgement.

Task 7 adds exactly:

| Method and literal path | Exact request allowlist | Success response |
|---|---|---|
| `POST /ledger/knowledge/candidates` | `{ sourceEventIds, sourceAcceptanceId?, statement, predicates, exclusions, unresolved, conflicts, idempotencyKey }` | `201/200 { kind, candidate, decisionTaskId }` |
| `POST /ledger/knowledge/candidates/:id/scope` | `{ expectedContentHash, scope, scopePredicates, cardEventId, idempotencyKey }` | `200 { candidate, rule, broaderReviewTaskId }` |
| `POST /ledger/knowledge/candidates/:id/general-review` | `{ expectedContentHash, exclusions, supportingCaseIds, explicitOwnerDeclaration, cardEventId, idempotencyKey }` | `200 { rule }` |
| `POST /ledger/knowledge/rules/:id/supersede` | `{ expectedVersion, replacementCandidateId, idempotencyKey }` | `200 { previousRule, rule }` |
| `GET /ledger/knowledge/attention` | Query `{ item_id, state?, limit? }`, `limit` 1–100 | `200 { rows, nextCursor }` |
| `POST /ledger/father-replies/consume` | `{ fatherReviewTaskId, sourceVersionBindingId, expectedItemVersion, matrixDecisionId, replyEventId, idempotencyKey }` | `201/200 { kind, currentDecision, candidate, scopeDecision }` |

Mutation actor/binding/chat values are server-owned. Candidate creation requires exact source event/acceptance provenance. Father-reply consumption rejects a source binding unless its source type/id/version/hash matches the archived reply's father task and current Matrix decision.

- [ ] Write RED tests for immutable source/hash, silence/stale/unauthorized rejection, A exact item, B subject/category/dimensions, C all predicates, and D first review producing no general rule.
- [ ] Run `node scripts/test-matrix-knowledge-ledger.js`; expect FAIL with missing knowledge service/table.
- [ ] Add only candidate/decision/rule tables and the minimum A–D/version service implementation.
- [ ] Run `node scripts/test-matrix-knowledge-ledger.js`; expect PASS before adding father or scenario integration.
- [ ] Write RED father-reply tests proving the archived reply, father-review task, exact active source link, expected item version, and Matrix decision must all agree; the current item decision completes separately, one combined reusable candidate/A–D decision is created only when appropriate, replay creates none, non-reusable reply creates none, and silence activates no rule.
- [ ] Run `node scripts/test-matrix-decision-distiller.js`; expect FAIL with missing distiller or `consumeFatherReply`.
- [ ] Add the minimum archive-first exact-bound father-reply transaction using `sourceVersionBindingId`; never resolve by inquiry recency or display text.
- [ ] Run `node scripts/test-matrix-decision-distiller.js`; expect PASS while the knowledge suite remains PASS.
- [ ] Write RED route-level trigger tests proving committed specification/item/order/work-order version changes call `refreshAttention`, exact matches create one version-bound task/digest item, near misses create none, duplicate updates replay, resolution is durable, and a later matching version reopens attention.
- [ ] Write RED crash/replay tests for a durable `matrix_item_version_events` outbox written in the same transaction as each specification/item/order/work-order version change; the worker must resolve the exact active source link before refreshing attention.
- [ ] Run `node scripts/test-matrix-item-version-outbox.js`; expect FAIL with missing outbox service/table.
- [ ] Run `node scripts/test-matrix-scenario-triggers.js`; expect FAIL with missing producer/worker integration.
- [ ] Add RED cases requiring exclusions plus supporting case or explicit owner declaration for D second review; superseded versions remain explainable.
- [ ] Add attention tables and `matrix_item_version_events` with states `pending | claimed | delivered | manual_review`, claim token/lease, attempt count, unique producer key, payload fingerprint, and immutable transition events.
- [ ] Modify `matrixInquiryItems.js` so item/specification mutations call `outbox.appendInTransaction` inside the same SQLite transaction; modify CRM/order/work-order mutation paths to do the same using the exact active `sourceVersionBindingId`. No post-commit callback is allowed.
- [ ] Implement claim/ack/nack and the idempotent worker: claim one event, revalidate source version binding, call `refreshAttention`, then ack the resulting attention IDs; ambiguous effects go to manual review and are never automatically replayed.
- [ ] Prove the pale-beige fixture creates only a caution with unresolved ink/material/machine/additive dimensions and never a numeric adjustment.
- [ ] Run `node scripts/test-matrix-item-version-outbox.js`; expect PASS for commit-before-claim, lease expiry, crash-after-attention-before-ack, poison event, and source-link supersession replay.
- [ ] Run `node scripts/test-matrix-scenario-triggers.js`; expect PASS for every item/specification/order/work-order producer path.
- [ ] Run `node scripts/test-matrix-knowledge-ledger.js`, `node scripts/test-matrix-decision-distiller.js`, `node scripts/test-matrix-item-version-outbox.js`, and `node scripts/test-matrix-scenario-triggers.js`; expect PASS.
- [ ] Commit `feat: add matrix ledger versions`.

### Task 8: Accepted Manual Result and Difference Packet

**Files:**
- Create: `src/services/matrixResultDiff.js`
- Modify: `src/db.js`, `src/routes/cost.js`, `src/routes/matrixCore.js`, `src/routes/crm.js`
- Create: `scripts/test-matrix-result-diff.js`, `scripts/test-matrix-result-classification.js`, `scripts/test-matrix-result-cost-route.js`
- Create: `scripts/fixtures/matrix-ledger/result-difference.json`

**Interfaces:**

```js
createMatrixResultDiff({ db, clock, taskSupervisor, knowledgeLedger, normalizerRegistry })
results.accept({ itemId, businessSourceVersionBindingIds, costingRequestId, snapshotId, proposalSource, actorUserId, bindingId, expectedItemVersion, idempotencyKey })
results.compare({ proposal, accepted })
results.classify({ packetId, classification, actorUserId, bindingId, evidence, idempotencyKey })
```

`proposalSource` is exactly `{ type: 'foreign_costing_draft'|'cost_snapshot', id, contentHash }`. Canonical hashes use UTF-8 canonical JSON with sorted object keys, unchanged numeric strings, and aliases from a pinned `matrix_normalizer_registry` row containing `normalizer_version` plus registry content hash; comparison never recalculates. Classification is exactly `case_only | source_correction | knowledge_candidate | system_defect`.

Task 8 validates each source through exactly one authority; it never puts result sources into `matrix_item_source_links`:

| Input | Authoritative binding/version evidence | Required failure checks |
|---|---|---|
| `businessSourceVersionBindingIds[]` | Active `matrix_item_source_version_bindings` for `father_review_task | order | work_order`, exact source event/version/hash and bound item/spec version | Missing, superseded, stale version/hash, cross-item/specification |
| `costingRequestId` | `costing_requests.inquiry_item_id + specification_id`, request status/version fingerprint | Missing item link, wrong specification/item, non-accepted status |
| `snapshotId` | `cost_snapshots.inquiry_item_id + specification_id + costing_request_id + content_hash` | Deleted/mutated hash, wrong request/specification/item, non-current snapshot; acceptance status is created only by this explicit action |
| `proposalSource.type='foreign_costing_draft'` | Draft item/specification foreign keys plus submitted/stored content hash | Missing item binding, stale/mutated hash, wrong item/specification |
| `proposalSource.type='cost_snapshot'` | Proposal snapshot's item/specification/request foreign keys plus submitted/stored content hash | Same rejection rules as snapshot; proposal and accepted identities must remain distinct and explicit |

Task 8 adds exactly:

| Method and literal path | Exact request allowlist | Success response |
|---|---|---|
| `POST /core/items/:id/result-acceptances` | `{ businessSourceVersionBindingIds, costingRequestId, snapshotId, proposalSource: { type, id, contentHash }, expectedItemVersion, idempotencyKey }` | `201/200 { kind, acceptance, packet, item, aggregate }` |
| `POST /core/result-differences/:id/classifications` | `{ classification, evidence, idempotencyKey }` | `200 { packet, candidateId, defectTaskId }` |

Actor/binding values are server-owned. The classification response returns `candidateId=null` except for `knowledge_candidate`, and `defectTaskId=null` except for `system_defect`.

- [ ] Write RED tests for exact identity chain, immutable accepted hashes, protected referenced snapshots, item-only state update, stable normalized comparison, and no arithmetic.
- [ ] Add RED cases for idempotency payload mismatch, post-accept source mutation/deletion, wrong proposal item, key-order/unit/name equivalence, and unauthorized actor.
- [ ] Add RED cases for every row in the result-source table above, including a valid business source binding followed by stale, missing, cross-item, wrong specification, changed content hash, and superseded-binding variants.
- [ ] Run `node scripts/test-matrix-result-diff.js`; expect FAIL with missing result service/table.
- [ ] Add only result-acceptance, difference-packet, and pinned normalizer-registry tables plus the exact identity-chain validator; do not add routes or classification side effects yet.
- [ ] Run `node scripts/test-matrix-result-diff.js`; expect PASS for acceptance/comparison behavior.
- [ ] Write RED classification cases in `scripts/test-matrix-result-classification.js`: case-only/source-correction create no rule; knowledge-candidate creates one inactive candidate; system-defect creates one task; every replay creates no duplicate side effect.
- [ ] Run `node scripts/test-matrix-result-classification.js`; expect FAIL with missing classification dependency behavior.
- [ ] Inject `knowledgeLedger`, `taskSupervisor`, and `normalizerRegistry`; implement classifications so `knowledge_candidate` calls `knowledge.createCandidate(...)`, returns exactly one inactive `candidateId`, and never activates a rule, while `system_defect` creates exactly one supervisor task.
- [ ] Run `node scripts/test-matrix-result-diff.js` and `node scripts/test-matrix-result-classification.js`; expect PASS for service behavior.
- [ ] Add the two exact Core routes above, service injection into the existing Core router, deletion guard, and Matrix Build Cache provenance boundary.
- [ ] Run `node scripts/test-matrix-core-ledger-api.js`; expect PASS for exact allowlists, responses, auth, conflict mapping, and replay.
- [ ] Write `scripts/test-matrix-result-cost-route.js` with RED cases that a referenced snapshot cannot be deleted, an unbound snapshot cannot be accepted, and the cost route returns only the stable snapshot ID/content hash rather than accepting it implicitly.
- [ ] Run `node scripts/test-matrix-result-cost-route.js`; expect FAIL until the cost-route deletion guard and stable response are present.
- [ ] Add the minimum `src/routes/cost.js` guard/response change, then run `node scripts/test-matrix-result-cost-route.js`; expect PASS.
- [ ] Run `node scripts/test-matrix-result-diff.js`, `node scripts/test-matrix-result-classification.js`, `node scripts/test-matrix-result-cost-route.js`, `node scripts/test-matrix-inquiry-items.js`, and `node scripts/test-crm-real-workflow-acceptance.js`; expect PASS.
- [ ] Commit `feat: review matrix manual result differences`.

### Task 9: Bot Client, Cards, Watcher, and Runtime Gate

**Files:**
- Create: `.runtime/vm_debug_ci/workspace/scripts/matrix-supervisor-watch.js`
- Modify: `.runtime/vm_debug_ci/workspace/scripts/matrix-client.js`, `.runtime/vm_debug_ci/workspace/scripts/matrix-runtime.js`, `.runtime/vm_debug_ci/workspace/extensions/stream-card.cjs`, `.runtime/vm_debug_ci/compose.yaml`, `scripts/verify-matrix-readonly-selection.js`, `scripts/test-verify-matrix-readonly-selection.js`, `scripts/test-matrix-api.js`, `.runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js`, `.runtime/vm_debug_ci/workspace/tests/test-runtime-supervisor.js`
- Create: `.runtime/vm_debug_ci/workspace/tests/test-matrix-supervisor-watch.js`

- [ ] Write RED watcher/client tests for fixed Core/Ledger methods, restart-safe digest claim/ack, and default-disabled behavior in `.runtime/vm_debug_ci/workspace/tests/test-matrix-supervisor-watch.js`.
- [ ] Run `node .runtime/vm_debug_ci/workspace/tests/test-matrix-supervisor-watch.js`; expect FAIL with missing watcher/client methods.
- [ ] Add only the narrow client methods and watcher claim/ack loop; keep `MATRIX_SUPERVISOR_ENABLED=0` fail-closed and bot outbound-free.
- [ ] Run `node .runtime/vm_debug_ci/workspace/tests/test-matrix-supervisor-watch.js`; expect PASS.
- [ ] Add RED card-extension cases for archive-before-interpretation on inbound message, edit version, outbound card/update, callback, decision receipt, and attachment; append failure prevents parsing, mutation, or send. Add Bill/VMCI separation, A–D one-click, stale/replay, and authoritative receipt cases.
- [ ] Run `node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js`; expect FAIL with missing archive/client/card behavior.
- [ ] Implement only the tested card/client seams, then rerun `node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js`; expect PASS.
- [ ] Add RED runtime/verifier cases for the watcher production file and unauthorized network/SMTP/process/chat mutations.
- [ ] Run `node .runtime/vm_debug_ci/workspace/tests/test-runtime-supervisor.js` and `node scripts/test-verify-matrix-readonly-selection.js`; expect FAIL on missing runtime manifest entries/hashes.
- [ ] Re-enumerate the complete runtime surface, review capabilities, and update signed hashes only after source review.
- [ ] Run the two runtime/verifier tests again; expect PASS with `delivery_enabled: false`.
- [ ] Run every command in Final Core/Ledger Verification below; expect PASS.
- [ ] Run `git diff --check`; expect no output. Run `git diff --name-only --diff-filter=ACM | rg '\.(js|cjs)$' | xargs -r -n1 node --check`; expect no output.
- [ ] Commit `test: gate matrix supervisor core rollout`.

## Final Core/Ledger Verification

```bash
node scripts/test-matrix-identity.js
node scripts/test-matrix-inquiry-items.js
node scripts/test-matrix-task-supervisor.js
node scripts/test-matrix-task-schedule.js
node scripts/test-matrix-channel-policy.js
node scripts/test-matrix-conversation-ledger.js
node scripts/test-matrix-knowledge-ledger.js
node scripts/test-matrix-decision-distiller.js
node scripts/test-matrix-item-version-outbox.js
node scripts/test-matrix-scenario-triggers.js
node scripts/test-matrix-result-diff.js
node scripts/test-matrix-result-classification.js
node scripts/test-matrix-result-cost-route.js
node scripts/test-matrix-core-ledger-api.js
node scripts/test-crm-real-workflow-acceptance.js
node scripts/test-crm-workbench-father-review.js
node scripts/test-orders-item-source-links.js
node scripts/test-work-orders-item-source-links.js
node scripts/test-matrix-api.js
node scripts/test-admin-access-regression.js
node scripts/test-matrix-stream-review.js
node scripts/test-matrix-stream-gates.js
node scripts/test-matrix-stream-delivery.js
node scripts/test-matrix-stream-correlation.js
node .runtime/vm_debug_ci/workspace/tests/test-matrix-supervisor-watch.js
node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js
node .runtime/vm_debug_ci/workspace/tests/test-bridge-patch.js
node .runtime/vm_debug_ci/workspace/tests/test-runtime-supervisor.js
node scripts/test-bridge-artifact-0.6.9.js
node scripts/test-verify-matrix-readonly-selection.js
MATRIX_STREAM_DB_PATH=/home/admin/work/packaging-system/data/matrix-stream.db npm run verify:matrix-readonly-selection
git diff --check
```

## 蒸馏进度

- 已确认模块：身份、多品项聚合、任务/决策/依赖、主动调度、双群路由、对话归档、A–D知识、人工结果差异、机器人运行门。
- 未解决模块：实施与逐任务复审尚未执行；历史未绑定询盘将进入人工迁移复核。
- 下一优先知识缺口：用真实但脱敏的多品项订单验收父亲的一次决策是否能正确解除对应阻塞。

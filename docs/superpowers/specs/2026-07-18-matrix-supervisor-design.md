# Matrix Supervisor Design

**Date:** 2026-07-18  
**Status:** Owner approved; calendar-day trial operation amendment confirmed
**Scope:** A proactive, auditable supervisor spanning public organization discovery, bilingual communication, factory decisions, multi-item costing coordination, follow-up, and knowledge distillation.

## 1. Outcome

Matrix Supervisor replaces reactive question-and-answer behavior with a durable operating system for daily work. It discovers and evaluates public organizations, maintains one authoritative record for every organization, contact, inquiry, item, quote, communication, decision, and task, and proactively advances the next safe action.

The human owner remains the authority for external communication, formal prices, material/process rules, commercial promises, and destructive data changes. The system may research, summarize, schedule, remind, calculate through reviewed tools, prepare drafts, and reconcile replies autonomously. It may not guess facts, silently generalize case-specific knowledge, or send externally without the required exact approval.

## 2. Fixed Operating Model

### 2.1 Bill channel

The configured Bill Feishu chat is the commercial operating channel. It owns:

- daily public-organization discovery, deep-reading, and recommendations;
- organization profile, product analysis, China-fit evidence, public contact routes, and entry strategy;
- development sequence, bilingual drafts, final review, and delivery status;
- inbound email translation, reply interpretation, recommended response, and follow-up;
- opportunity stages, due dates, blockers, next actions, and daily/overdue summaries;
- explicit links to the corresponding VMCI decision when factory input is required.

### 2.2 VMCI channel

The configured VMCI Feishu chat is the factory decision channel. It owns:

- inquiry decomposition into independently tracked items;
- material, structure, size, quantity, process, color, machine, packing, margin, and formal price decisions;
- costing-request status, accepted manual costing snapshots, and quote readiness;
- historical freight basis, FOB internal estimates, and forwarder-review preparation;
- knowledge candidates extracted from decisions and manual/system differences;
- concise A–D decision cards for the configured authorized factory decision role.

### 2.3 Cross-channel behavior

Chat identity is configured by immutable Feishu chat id, never inferred from display name. A request received in the other channel is still captured and progressed when safe. The bot completes the immediate goal, then adds a gentle note and a link to the authoritative record in the correct channel. It never creates a second customer, inquiry, item, quote, draft, or task merely because the request arrived in another chat.

Bill creates a VMCI decision task when factory input is needed. VMCI resolution automatically resumes the blocked Bill work item. Bill never asks the user to manually retype a VMCI answer.

## 3. System Decomposition

This program is delivered as five independently testable subprojects with neutral component names:

1. **Matrix Core:** authoritative identity, multi-item workflow, tasks, deadlines, and cross-channel routing.
2. **Matrix Ledger:** append-only conversation archive, confirmed-knowledge ledger, versioning, and scenario triggers.
3. **Matrix Atlas:** compliant public discovery, China-fit evidence, deep reading, scoring, and recommendation.
4. **Matrix Draft:** evidence-bound bilingual communication, company introduction, quality scoring, copyable delivery, and quote/freight messages.
5. **Matrix Relay:** exact approval, restricted email delivery, reply correlation, translation, notifications, and controlled rollout.

Existing reviewed Matrix Stream and Matrix Atlas specifications remain binding where they are stricter. This document connects them and defines the missing supervisor behavior.

## 4. Authoritative Identity and State

### 4.1 Stable identities

Every record uses durable internal identifiers:

- `organization_id`: one public organization or confirmed legal/brand entity;
- `contact_id`: one evidence-backed organizational contact or person;
- `inquiry_id`: one commercial request or development opportunity;
- `inquiry_item_id`: one independently quotable product/specification line;
- `costing_request_id` and `cost_snapshot_id`: one calculation attempt and accepted immutable result;
- `quote_id` and `quote_version_id`: one commercial quote and immutable revision;
- `conversation_id`, `message_id`, and `thread_id`: original communication identity;
- `decision_id`: one required factory/commercial decision;
- `task_id`: one owned next action with deadline;
- `knowledge_candidate_id` and `knowledge_rule_id`: extracted candidate and confirmed versioned rule;
- `delivery_id`: one exact outbound attempt and correlation boundary.

Organization identity uses exact official-domain, verified public company-email domain, legal identifier, LEI, or an already confirmed alias. Fuzzy name/address matches create review tasks and never merge state automatically.

### 4.2 Multi-item invariant

An inquiry may contain any number of items. Each item has its own requirement completeness, costing state, decision blockers, quote version, and next action. Completing one costing request can only complete its item. Inquiry state is derived from all active items and cannot become complete while any required item is blocked, pending, or unquoted.

The Bill card shows counts such as `4 items · 2 ready · 1 waiting factory · 1 waiting customer`. The VMCI card shows only items requiring factory action. Manual costing completed in the order system is imported as an immutable accepted snapshot and updates only the linked item.

### 4.3 Version binding

Every draft and quote is bound to exact organization, contact, inquiry, item set, cost snapshots, recipient source, content hash, author, and timestamp. Editing recipient, subject, body, item set, price, trade term, or attachment invalidates prior approval. A later scheme creates a new version; it never mutates an already approved or delivered version.

## 5. Proactive Task Supervisor

### 5.1 Task contract

Every actionable record has:

- task type, stage, priority, owner role, channel, and due time;
- organization, inquiry, item, quote, and message bindings as applicable;
- blocker code, blocker explanation, waiting party, and evidence ids;
- one explicit next action and an A–D decision set when human judgment is needed;
- reminder count, last reminder time, escalation level, and completion evidence;
- idempotency key and append-only transition history.

The scheduler advances internal work automatically but does not invent missing decisions. A missing answer leaves the task active and schedules the next appropriate reminder.

### 5.2 Default operating cadence

All times use Asia/Shanghai and run on every calendar day. Saturday, Sunday, and holidays are ordinary operating days for internal observation, order changes, summaries, task reminders, and escalation:

- 09:00 Bill daily digest: discoveries, replies, due follow-ups, quotes ready for review, and blocked opportunities;
- 10:00 VMCI decision digest: factory decisions and item-level costing blockers;
- 16:30 overdue digest: items due today but incomplete, grouped by owner and customer;
- one-calendar-day blocker reminder;
- three-calendar-day escalation with a red status and at least one safe alternative action;
- immediate Bill notification for a correlated inbound reply;
- three-calendar-day no-reply task after accepted delivery;
- at most two follow-up proposals by default; every external follow-up still requires exact approval.

Duplicate scheduler runs, bridge restarts, stale cards, and repeated clicks replay the same task transition rather than creating duplicate tasks or messages. Quiet hours suppress non-urgent chat notifications while retaining due state.

### 5.3 Decision compression

The supervisor asks one decision instead of replaying the entire history. A card contains: what changed, why it matters, the exact affected items, the recommended choice first, A–D alternatives, and the consequence of each choice. Free text remains available for corrections.

Examples:

- A. Review all completed quote items
- B. Send only currently ready items
- C. Ask the customer for missing information
- D. Defer with a new due date

The chosen action updates the authoritative task and automatically resumes dependent work.

## 6. Conversation Archive and Knowledge Distillation

### 6.1 Dual-ledger boundary

All Bill and VMCI inbound/outbound messages, card actions, edits, decisions, and attachment references are written to an append-only conversation ledger before asynchronous interpretation. The record includes channel, chat/thread, speaker identity, timestamps, platform message identifiers, normalized text, attachment metadata/reference, and content fingerprint. Credentials, tokens, cookies, and protected configuration values are never extracted into the ledger.

Conversation retention does not make a statement an active rule. Reusable knowledge uses a separate candidate-to-confirmed ledger:

1. extract a concise candidate with exact source-message ids;
2. label unresolved dimensions and contradictions;
3. ask the authorized factory decision role for scope;
4. activate only after explicit confirmation;
5. create a new version and `supersedes` link for later corrections;
6. retain the original evidence and prior version for historical explanation.

### 6.2 A–D knowledge scope

Every proposed experience uses these fixed options:

- **A — current item only:** usable only by the bound `inquiry_item_id` or order item;
- **B — same subject and category:** same material/product family with matching confirmed dimensions;
- **C — same scenario:** all explicitly selected color, machine, process, material, application, or failure-condition predicates must match;
- **D — general candidate:** enters a broader rule review and never becomes general merely from the first confirmation.

Option D requires a second review that states exclusions and at least one supporting case or explicit owner declaration that the rule is general. Silence never activates knowledge.

### 6.3 Scenario reminders

Rules store structured predicates rather than keywords alone. Predicates may include color family/shade, substrate/material, ink system, machine, printing process, lamination, bag/film type, application, temperature, barrier requirement, filling method, and defect mode.

For the example `very light beige may be more stable with an ink-adjusting additive`, the first candidate records the observation but explicitly leaves ink system, substrate, machine, additive identity/range, and exceptions unresolved. When a later order contains a matching pale-yellow/beige color, the system shows a caution with source and version. It cannot invent an additive percentage, change a formula, or present the statement as universally true.

### 6.4 Learning from manual work

Accepted manual costing and order results are compared with the system proposal by normalized input and formula component. Differences create a review packet showing changed inputs/rules and affected item; they never overwrite a rule or price. The authorized factory role may classify the difference as case-only, corrected source data, new candidate knowledge, or system defect.

Numeric results always use the reviewed Matrix Build Cache calculator. Missing or stale material price, density, fee, loss, margin, freight, or date blocks a formal result. Every formal price retains normalized inputs, formula steps, source, confirmer, and confirmation date.

## 7. Public Discovery and China-Fit Evidence

### 7.1 Capacity with backlog control

After a small production pilot, Matrix Atlas uses daily maximums of 100 light discoveries, 20 deep reads, and five human recommendations. New discovery capacity is reduced automatically when the unreviewed/deep-read backlog exceeds its configured service level; it must not add 100 rows daily while only processing 20 indefinitely.

Rollout begins with `10 discoveries / 3 deep reads / 1 recommendation`. It increases only after every packet has valid provenance, no duplicate organization, and acceptable human adoption.

### 7.2 China-fit lane

China sourcing and practical delivery use a fact lane before ordinary scoring:

- `confirmed`: first-party or authoritative public evidence explicitly shows China supplier/import/manufacturing/office/warehouse/inspection/pickup activity;
- `public_lead`: a public trade, exhibition, distributor, product-origin, procurement, or partner record provides a plausible but incomplete China link;
- `unknown`: no sufficient evidence; this is not negative evidence;
- `conflicting`: sources disagree and human review is required.

Every signal stores source URL/type, observed time, excerpt or structured locator, coverage caveat, and relationship direction. Aggregate country trade data can prioritize a market but cannot prove a company-level supplier relationship. The system may not infer a supplier from appearance, product similarity, absence from a dataset, or guessed private information.

Within each lane, opportunity and evidence-confidence scores rank medium-to-large organizations with recurring product lines. India remains excluded and European proactive outreach remains paused under the current certification policy. Public official, government, trade-promotion, association, exhibition, retailer/distributor, and reviewed public trade-record sources are allowed subject to robots, terms, rate limits, and human source registration.

### 7.3 Crosswalk and deduplication

Candidate, CRM customer, WhatsApp identity, email thread, inquiry, and order records are connected by an explicit crosswalk. Exact identities link automatically; ambiguous matches create one review task. Suppression, bounce, opt-out, and do-not-contact state follows a confirmed organization across channels and cannot be bypassed by importing the same company again.

## 8. Evidence-Bound Communication

### 8.1 Company introduction

The company introduction is a versioned, owner-approved fact block sourced from the authoritative website/company resource. It contains only confirmed company name, location, capability/product scope, certifications, production/quality facts, and approved differentiators. It does not invent equipment, capacity, export markets, certifications, delivery promises, or customer relationships.

The first email uses one concise credibility sentence rather than a long company biography. The independent-site URL appears in the signature by default. A specific relevant product/resource link may appear in the body only when it supports the customer-specific observation and is not used as a generic traffic tactic.

### 8.2 First-contact draft

Default English body length is 90–130 words excluding signature:

1. specific observation from the organization's public product evidence;
2. one concise approved Huasheng introduction;
3. one relevant product/format/structure opportunity framed as a hypothesis, not an unsupported claim;
4. one or two low-effort questions;
5. one low-pressure call to action;
6. sender signature `Gavin`, approved company identity, and independent-site link.

The system generates a semantically paired Chinese translation and a shorter WhatsApp version. The translation explains the intended strategy to the factory owner; it is not independently editable without creating a new paired version.

Personal names and roles are used only with current public evidence. If a reliable name is unavailable, use an organizational salutation such as `Procurement Team` or `Packaging Team`; never guess a person, gender, email pattern, or private profile.

### 8.3 Quality gate

Draft scoring covers evidence fidelity, customer specificity, product fit, concise company credibility, useful questions, clear CTA, tone, language pairing, recipient provenance, and unsupported-claim risk. Numeric product specifications are valuable when public and relevant but are not mandatory for all categories. Missing public dimensions must not block a strong evidence-backed product-family approach.

Blocked claims include unapproved price, certification, performance, delivery time, supplier relationship, volume, or formal material recommendation. The quality gate reports component reasons and revision suggestions rather than one unexplained number.

### 8.4 Copyable outputs

Feishu cards are the decision interface, not the final copy surface. After the operator chooses `Generate customer content`, the bot sends a separate plain-text message to the clicking operator's private chat by default:

- `EMAIL EN` with subject and body;
- `中文说明` with strategy and translation;
- `WHATSAPP EN` as a short copyable message;
- `货代复核` when relevant.

The group receives only a compact receipt and record link. Plain text contains no internal cost, margin, hidden formula, protected source, token, or Message-ID. Generation does not mark content sent.

## 9. Quote, Freight, and Forwarder Coordination

Each quote item is tied to its accepted cost snapshot and trade-term basis. A formal quote number is created when the quote is saved for review; revisions use immutable versions under that number. Contact/person binding cannot silently change between versions.

Historical freight records use explicit status:

- `historical_basis`: previous forwarder evidence usable for an internal estimate;
- `pending_review`: basis selected and message prepared for current forwarder confirmation;
- `current_confirmed`: current route/cost confirmed with source and validity time;
- `expired` or `superseded`.

FOB internal estimates show port, route/breakdown basis, allocation method, source date, match explanation, and unresolved assumptions. Historical amounts are never called current formal freight. The system prepares a concise Chinese forwarder-review message containing the customer destination, item summary, weight/volume basis when confirmed, recommended port, required trade term, and exact facts to confirm. The operator receives it as copyable private text and marks the external WhatsApp action sent manually.

## 10. Delivery and Reply Loop

### 10.1 External-action boundary

Internal research, task creation, translation, draft generation, reminder scheduling, evidence refresh, and reply classification may run autonomously. External email requires the existing two-confirmation flow and exact final recipient/subject/body/version approval. WhatsApp remains a copyable manual action until a separately reviewed connector and approval design exists.

The bot never receives SMTP credentials. Only the digest-bound management-system delivery source may use the existing protected sender. The default daily accepted-email limit is five. Duplicate, stale, cooling, suppression, country/channel, sender-readiness, quota, content-hash, and permission gates fail closed.

### 10.2 Reply processing

Mailbox synchronization stores original inbound content, attachments metadata/reference, thread identifiers, and correlation evidence. A reply card contains:

- organization/contact and exact inquiry/item/quote context;
- original text and Chinese translation;
- detected questions, objections, requested changes, deadlines, and confidence;
- recommended next action and A–D choices;
- English reply draft and Chinese paired explanation only after the operator requests it.

Exact Message-ID/References linkage is preferred. Ambiguous matches create a review task and never update an opportunity or send a reply automatically. Every reply email still requires exact final approval.

## 11. Tables and Views

The management UI and Feishu cards read the same authoritative records. Required operator views are:

- today's Bill queue;
- today's VMCI decision queue;
- organizations by stage, priority, China-fit lane, source, country, category, and owner;
- inquiry item matrix with requirement/cost/quote/delivery state;
- overdue and blocked tasks grouped by waiting party;
- communication timeline with original/translated/version links;
- quote and cost snapshot history;
- knowledge candidates, active rules, superseded rules, and scenario reminders;
- source/evidence freshness and Atlas backlog;
- delivery, reply, bounce, suppression, and conversion metrics.

Rows support mobile card layouts and desktop tables. Long content wraps with usable row height; detail opens without losing list filters or scroll position.

## 12. Observability and Recovery

Every scheduler and external side effect uses durable leases, idempotency keys, append-only events, and explicit accepted/failed/ambiguous state. Restarts resume from persisted state. Metrics cover task age, blocker age, discovery/deep-read backlog, recommendation adoption, draft revisions, send/reply conversion, quote cycle time, decision latency, reminder effectiveness, and unmatched replies.

All databases and append-only ledgers remain private with mode `0600`, verified daily backup, integrity checks, and protected retention. Business records are referenced from the user-level capability catalog rather than copied into it. Logs redact contact values, message bodies, prices, formulas, tokens, cookies, SMTP credentials, and unnecessary personal data.

## 13. Integration and Rollout

### 13.1 Git integration

The dirty primary worktree remains untouched. A clean integration worktree based on `main` performs:

1. fast-forward `main` to `feature/foreign-trade-crm`;
2. fast-forward to `feature/matrix-stream-relay` (which already contains readonly selection);
3. merge `feature/matrix-atlas-runtime` and manually review the combined safe environment block;
4. reconcile `feature/matrix-signal-sprint-final` registry row-by-row from authoritative provenance;
5. treat `feature/matrix-stream-phase1` as a requirement-porting queue, never a wholesale merge;
6. integrate the current dirty primary delta only after it is checkpointed and reviewed as a separate unit.

No branch merge authorizes deployment or external delivery.

### 13.2 Implementation waves

- **Wave A — Core truth:** identity crosswalk, inquiry items, aggregate state, task supervisor, Bill/VMCI routing.
- **Wave B — Durable learning:** conversation event ledger, knowledge candidate/scope/version, manual-result comparison, scenario reminders.
- **Wave C — Evidence and copy:** China-fit lane, Atlas scanner/reader/runner, company fact block, high-quality bilingual drafts, copyable outputs.
- **Wave D — Operational coordination:** quote numbering/version binding, freight-basis review, forwarder messages, dashboards and overdue escalation.
- **Wave E — Controlled release:** integrate reviewed relay, full regression, disabled-mode production deployment, small Atlas pilot, one explicitly approved email, reply-loop observation.

Each wave has its own specification/implementation plan, TDD tasks, task review, whole-branch review, and rollback evidence.

### 13.3 Deployment gates

Before production mutation:

- exact reviewed commit and clean worktree;
- verified private backups and SQLite integrity;
- baseline, runtime, permission, API, Matrix verifier, card/bridge, browser, mobile, TypeScript, and production build gates;
- `MATRIX_STREAM_SEND_ENABLED=0`, `MATRIX_DELIVERY_ENABLED=0`, and Atlas pilot disabled during initial smoke;
- preserved previous application and bot releases, rendered configuration, and rollback commands;
- authenticated readiness, health, WebSocket, bot event subscription, and source-policy checks.

The production log warning for missing `im.message.receive_v1` must be resolved and a published Feishu version verified before group-mention acceptance is declared stable.

## 14. Acceptance Criteria

1. A four-item inquiry cannot show complete until every required item is complete, deliberately deferred, or cancelled with evidence.
2. Manual order-system costing updates only the exact linked item and creates a reviewable difference packet.
3. Bill-to-VMCI decisions resume automatically without retyping and cannot cross customers/items.
4. Every relevant conversation is archived before interpretation; replay does not duplicate events.
5. Unconfirmed knowledge never changes price, formula, material, process, or customer output.
6. A confirmed scenario rule triggers only when its structured predicates match and always shows provenance/version.
7. Daily digests and overdue reminders are idempotent and retain active tasks after silence.
8. Atlas respects public-source policy, robots, rate limits, evidence provenance, deduplication, and pilot/backlog budgets.
9. China-fit state is evidence-bound and missing evidence remains unknown.
10. No guessed contact name/email, private profile, login bypass, CAPTCHA bypass, or automatic contact-form submission exists.
11. Every first-contact email has paired English/Chinese, evidence-bound observation, approved company fact, useful question, CTA, and recipient provenance.
12. Independent-site links use the approved company/site resource and never substitute for customer-specific relevance.
13. Cards remain mobile-operable; generated customer/forwarder content is available as separate copyable private plain text.
14. Historical freight produces an internal estimate and forwarder-review task, never a falsely current formal FOB value.
15. Only exact approved email content can be delivered; WhatsApp remains manual/copyable; duplicate/stale actions cannot send.
16. Correlated replies notify Bill immediately with Chinese translation; ambiguous replies remain review tasks.
17. Bill and VMCI dashboards show the same organization/item/quote/task truth as Feishu.
18. Restart/crash recovery preserves tasks, approvals, outbox state, reply notifications, and knowledge events.
19. Full desktop/mobile browser regression, backend suites, runtime manifests, and disabled-send production smoke pass before enablement.
20. A real email or reply is never used as an integration smoke without separate explicit approval.

## 15. Explicitly Out of Scope

- automatic bulk outreach or follow-up;
- autonomous formal pricing, margin approval, material substitution, or technical performance promise;
- guessed personal contacts or private-profile collection;
- login, CAPTCHA, paywall, robots, rate-limit, or access-control bypass;
- automatic WhatsApp sending without a later reviewed connector;
- automatic threshold/rule retraining or silent knowledge generalization;
- copying credentials or business databases into user-level catalogs;
- treating public-data absence as proof of no supplier relationship;
- destructive merge/reset/cleanup of the existing dirty primary worktree.

## 16. Success Measures

- 100% of active opportunities have one next action, owner, due time, and blocker state;
- 100% of multi-item opportunities expose item-level readiness and aggregate truth;
- zero cross-customer/contact/item/quote version mix-ups in regression and production incidents;
- zero unapproved external sends and zero guessed contacts;
- at least 95% of correlated replies notify Bill within five minutes of synchronization;
- median factory decision card requires one response turn;
- quote blockers older than one and three calendar days are reminded/escalated according to schedule;
- Atlas pilot packets have 100% evidence provenance and zero exact-domain duplicates;
- draft adoption, revision reasons, reply rate, qualified-inquiry rate, and quote-cycle time are measured by cohort, not hidden in chat history;
- every active knowledge rule has source, confirmer, scope, version, and unresolved/exclusion fields.

## 17. Decisions Fixed by Owner Approval

- Operating mode is `proactive supervisor`, not reactive chatbot.
- All conversations are archived; only explicitly confirmed knowledge becomes active.
- Bill and VMCI remain separate authoritative interaction channels with automatic cross-channel handoff.
- The supervisor proactively schedules and escalates internal work after silence.
- External email remains exact-final-confirmation only; WhatsApp remains copyable/manual in this release.
- Customer/company/contact/item/quote identities and versions must never be mixed.
- China-fit is a provenance-backed preference, not a guessed fact or universal eligibility requirement.
- English output is paired with Chinese decision support so the factory owner can approve without English proficiency.

## 蒸馏进度

- 已确认模块：主管模式、双群职责、稳定身份、多品项队列、主动催办、全对话归档、知识确认、China-fit证据、双语文案、可复制输出、FOB复核、安全外发、回复闭环、集成与发布边界。
- 未解决模块：正式实施尚未开始；现有脏工作树归属、signal registry逐行权威合并、phase1需求级移植仍需在实施阶段完成。
- 下一优先知识缺口：形成一份由官网权威资源支持的华胜对外公司事实块，并由所有者确认可公开使用的认证、设备、产品范围和交付优势。

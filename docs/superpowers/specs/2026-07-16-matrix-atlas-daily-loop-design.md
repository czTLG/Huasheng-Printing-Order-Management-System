# Matrix Atlas Daily Loop Design

Date: 2026-07-16

## Goal

Extend the existing `智能桓` Feishu runtime with a bounded daily loop that discovers public overseas company candidates, deep-reviews the highest-priority records, recommends a small evidence-backed set for human selection, prepares bilingual messages, sends only an explicitly approved immutable version, and updates the company record when a reply arrives.

The first production limits are fixed:

- Discover at most 100 new companies per calendar day.
- Deep-review at most 20 P0/P1 companies per calendar day.
- Recommend at most 5 companies per daily Feishu review batch.
- Deliver at most 5 approved first-contact emails per calendar day.

All internal components, folders, workflow identifiers, configuration keys, skill names, and user-visible feature labels use neutral technical codenames. The natural-language trigger `开发客户` remains supported because it is user input, not an internal capability name.

## Scope

### Included

- Public-company discovery from official websites and official government, association, or exhibition directories.
- Official-domain verification, evidence retention, provenance, deduplication, prioritization, and P0/P1 deep review.
- Deterministic Feishu interaction for region/category selection, candidate recommendation, candidate detail, selection, bilingual draft review, final confirmation, delivery receipt, and reply notification.
- Email-only outbound delivery after explicit human approval.
- Incremental mailbox synchronization, reply matching, translation, structured requirement extraction, company-stage updates, and suggested bilingual replies.
- Daily limits, suppression, bounce handling, opt-out handling, audit records, and sender-reputation monitoring.

### Excluded in Phase One

- Automatic WhatsApp sending.
- Website form submission.
- LinkedIn or private-profile automation.
- Login or CAPTCHA bypass.
- Guessed personal email addresses or private phone numbers.
- Purchased private lists or personal-data brokers.
- Automatic follow-up delivery without a new human confirmation.
- Automatic conversion of a candidate into a formal customer or order.

China and India remain excluded from discovery and recommendations. Domestic legacy customers remain outside this workflow.

## Neutral Components

| Codename | Responsibility |
| --- | --- |
| `matrix-atlas` | Daily scheduler and campaign boundary enforcement. |
| `stream-fetch` | Bounded discovery and official-page retrieval. |
| `signal-cache` | Evidence, provenance, content fingerprints, and freshness. |
| `schema-rank` | Deterministic exclusions, deduplication, priority, and reason codes. |
| `packet-lens` | Evidence-bound product observations and bilingual draft generation. |
| `packet-gate` | Selection, versioning, approval, delivery authorization, and audit state. |
| `stream-card` | Feishu intent routing, cards, callbacks, and notifications. |
| `reply-index` | Mail synchronization, reply matching, translation, extraction, and updates. |

Neutral naming protects commercial confidentiality only. Internal records retain real upstream project names, licenses, versions, checksums, network behavior, and source URLs.

## Daily Schedule

All business-day calculations use `Asia/Shanghai`.

### 01:30 — Discovery

`matrix-atlas` creates bounded country/category tasks and dispatches independent research workers. The daily accepted-record limit is 100; rejected or duplicate records do not consume the accepted-record quota.

Each accepted candidate must have:

- Normalized official domain and official URL.
- Company name and country.
- `discovered_via`, discovery URL, discovery source type, and discovery timestamp.
- At least one separate official evidence page.
- Product/category evidence and an evidence excerpt.
- Content fingerprint and extractor version.
- Confidence, review state, and missing-information list.

An official directory may discover a company but cannot replace official-site verification. When the official site is unavailable, the candidate remains `needs_review` and cannot enter the daily recommendation set.

### 04:00 — P0/P1 Deep Review

Select at most 20 records using stable ordering:

1. P0 before P1.
2. Never previously deep-reviewed before stale reviewed records.
3. Higher evidence completeness.
4. Higher supported product fit.
5. Better public organizational contactability.
6. Oldest `deep_reviewed_at` first, then candidate ID.

Deep review visits only a bounded set of public pages such as home, about, products, packaging/product-detail, manufacturing, export, and contact. It records:

- Confirmed product categories and representative SKUs.
- Confirmed visible packaging formats.
- Public size/specification text when explicitly shown.
- Production, brand-portfolio, export, or distribution scale signals.
- Public organizational email, telephone, WhatsApp, or contact page.
- Missing facts and questions required before a technical recommendation.
- Evidence URL and excerpt for every asserted fact.

No material structure, thickness, dimension, price, MOQ, compatibility, purchasing plan, or contact role is invented. Unsupported values remain `待核实`.

### 09:00 — Recommendation

`stream-card` sends one Feishu review card containing at most 5 candidates. A candidate is eligible only when:

- The company identity and official domain are verified.
- It is not suppressed, opted out, bounced, already contacted in the configured cooldown, or an existing domestic legacy customer.
- A public organizational contact route exists.
- Product-fit reasons have evidence.
- Deep review is current.
- The target jurisdiction policy allows the proposed contact path or marks it for additional human review.

If fewer than 5 candidates qualify, the bot recommends fewer. It never fills the batch with weak records merely to reach the limit.

## Feishu Interaction

### Entry

When an authorized user `@智能桓` and enters `开发客户`, the deterministic handler responds before the general agent:

1. Choose region or country.
2. Choose product category.
3. Choose `今日推荐`, `继续筛选`, or `查看进行中`.

The filter snapshot, page, operator, chat/thread, state version, and expiration are stored server-side. Buttons carry opaque action IDs only.

### Candidate Summary

The compact card shows:

- Company name and country.
- Priority and evidence-completeness state.
- Confirmed product categories.
- One-sentence recommendation reason.
- Current workflow stage and next action.

Actions: `查看详情`, `暂不处理`, `待核实`, `选择`.

### Candidate Detail

The detail card shows:

- Company introduction based on official evidence.
- Official website and public organizational contact routes.
- Discovery channel and discovery page.
- Confirmed products, visible packaging formats, and public specifications.
- Scale signals and analogous historical-inquiry signals.
- Recommendation reasons, risks, missing facts, and suggested next step.
- Evidence links beside the facts they support.
- Current owner, stage, last activity, next action, and event history.

Private contact data, unrelated message bodies, internal prices, costs, margins, formulas, and private rule text never appear in group cards.

## Selection and Work State

Selecting a candidate creates an append-only event and one work item. Repeated clicks with the same idempotency key do not create duplicates.

Minimum stages:

```text
observed
  -> deep_review_pending
  -> recommendation_ready
  -> selected
  -> draft_pending
  -> review_pending
  -> final_confirmation_pending
  -> approved_for_delivery
  -> delivered
  -> waiting_reply
  -> replied | no_reply_review_due | bounced | opted_out | suppressed
```

Every transition records actor, timestamp, before/after state, reason, related evidence/draft/receipt ID, and idempotency key.

## Draft Strategy

The system studies the candidate before drafting. It may also use anonymized patterns from authorized historical inbound conversations, but it must not expose or copy another company's confidential information.

The first-contact English message normally contains 80–140 words:

1. Accurate sender identity and a direct subject line.
2. One specific, sourced observation about the company's product or current format.
3. One concise explanation of why the sender may be relevant.
4. One or two evidence-bound possibilities clearly presented as possibilities.
5. Two or three useful clarification questions.
6. A small, specific next step.
7. A clear opt-out path and required sender details.

The message must not:

- Pretend to be a reply or use deceptive `Re:`/`Fwd:` subjects.
- Use generic praise that is not connected to evidence.
- Claim a final material structure, barrier, compatibility, shelf life, certification, dimension, price, MOQ, lead time, or delivery arrangement without support.
- Include hidden content, misleading links, or disguised sender identity.
- Copy a fixed template without adapting the evidence-backed observation and questions.

The system stores an English source version and Chinese translation under the same version ID. Translation cannot introduce claims absent from the English source. Any edit creates a new immutable version.

## Human Review and Delivery

The user may revise either language, but the system reconciles the pair and flags semantic differences before final confirmation.

The final card displays:

- Exact recipient and public source of the address.
- Subject, complete English body, Chinese reference translation, and attachments.
- Sending mailbox and sender identity.
- Candidate and draft version.
- Warnings, jurisdiction result, and missing facts.

`确认发送` creates a single-use authorization bound to:

- Candidate and intended recipient.
- Sending mailbox.
- Subject hash, body hash, and attachment hashes.
- Draft version and approving actor.
- Issued time and short expiration.
- Idempotency key.

Only the isolated delivery adapter can consume the authorization. Any edit, recipient change, expiration, cancellation, duplicate callback, opt-out, bounce suppression, or daily-limit exhaustion causes rejection. Successful delivery records provider message ID, SMTP response, timestamp, and consumed authorization ID.

Phase-one delivery limit is 5 successful first-contact messages per Shanghai calendar day. Retries with confirmed non-delivery do not bypass the idempotency key. An uncertain SMTP result enters reconciliation and is not blindly resent.

## Sender and Jurisdiction Gates

Before enabling delivery:

- Verify SPF and DKIM; configure DMARC and alignment for the sending domain.
- Use TLS and valid DNS/PTR where the sending infrastructure requires it.
- Use a consistent, accurate From identity and reply address.
- Provide visible opt-out instructions and standards-compliant unsubscribe handling where applicable.
- Maintain bounce, complaint, opt-out, invalid-address, and do-not-contact suppression lists.
- Keep commercial and transactional traffic logically separated.
- Start at the approved limit and do not increase automatically.

Jurisdiction rules differ. A policy record determines whether a corporate organizational address may be contacted, requires additional review/consent, or is blocked. Sole traders and personal addresses receive stricter treatment and are blocked by default unless an approved policy explicitly permits the contact.

## Reply Loop

Mailbox synchronization runs incrementally at least every 5 minutes. Reply matching uses:

1. Provider message ID and delivery receipt.
2. `In-Reply-To` and `References`.
3. Normalized sender/recipient plus conversation key.
4. Normalized subject only as a weak supporting signal.

Ambiguous matches enter `needs_review` and do not update a company automatically.

For a confident match, `reply-index`:

- Stores the original message unchanged.
- Creates a separate Chinese translation artifact.
- Extracts confirmed products, formats, dimensions, quantities, materials, artwork, destination, trade terms, timing, objections, and questions with source references.
- Updates the candidate/work item stage, last-contact time, current summary, next action, and follow-up date.
- Sends a Feishu notification to the authorized owner.
- Generates an English suggested reply and paired Chinese translation without sending.
- Requires a new version review and single-use confirmation before replying.

## Daily Limits and Health Rules

Fixed phase-one limits:

| Metric | Limit |
| --- | ---: |
| Accepted discoveries/day | 100 |
| P0/P1 deep reviews/day | 20 |
| Daily recommendations | 5 |
| Successful first-contact deliveries/day | 5 |

Automatic safety pauses:

- Any complaint signal pauses delivery pending review.
- Hard bounce suppresses the address immediately.
- Repeated soft bounce or deferral pauses the address/domain according to bounded policy.
- Authentication failure, DMARC alignment failure, or missing sender identity disables delivery.
- Daily limit, stale approval, or stale evidence blocks delivery.
- A reply, opt-out, existing open conversation, or recent contact blocks another first-contact message.

Discovery and deep review may continue while delivery is paused.

## Data Additions

The candidate database already stores `cache_records`, `cache_evidence`, `cache_discovery`, `cache_corrections`, and import runs. The main application needs append-only operational state:

- `matrix_sessions`: operator/chat/thread filter snapshot and expiration.
- `matrix_work_items`: candidate, stage, owner, current summary, next action, follow-up, and version.
- `matrix_selection_events`: append-only state transitions and idempotency keys.
- `matrix_draft_versions`: immutable English/Chinese versions and hashes.
- `matrix_delivery_authorizations`: exact single-use approvals.
- `matrix_delivery_receipts`: provider outcome and reconciliation state.
- `matrix_suppressions`: bounce, complaint, opt-out, invalid, and manual blocks.
- `matrix_reply_links`: inbound message, delivery receipt, confidence, and review state.
- `matrix_daily_counters`: timezone-bound quota accounting.
- `matrix_policy_results`: jurisdiction decision, policy version, reason, and review state.

The Feishu container receives read-only access to the candidate database. All writes and all delivery operations go through narrow authenticated application APIs; the container never receives direct write access or arbitrary SMTP credentials.

## Failure Handling

- Discovery network failures retain cursor and retry with bounded backoff.
- Robots denial, authentication requirements, or CAPTCHA stop collection for that source.
- Source conflicts or inaccessible official sites remain `needs_review`.
- Model failures leave deterministic evidence intact and analysis pending.
- Duplicate/stale Feishu callbacks return the current state without repeating side effects.
- Feishu notification failures are retryable and do not roll back a confirmed database state.
- SMTP uncertainty enters reconciliation before any retry.
- Mailbox synchronization resumes from durable UID/message cursors.
- Translation or extraction failure preserves the original reply and alerts the owner.

## Acceptance Criteria

### Daily Loop

- A Shanghai calendar day cannot accept more than 100 new unique candidates.
- A day cannot deep-review more than 20 candidates, recommend more than 5, or successfully deliver more than 5 first-contact messages.
- Restarting workers does not reset counters or duplicate work.
- Weak candidates do not fill an undersized recommendation batch.

### Evidence and Recommendation

- Every recommended fact links to evidence.
- Every candidate exposes discovery channel and official-site verification separately.
- Unsupported specifications are visibly `待核实`.
- Suppressed, opted-out, bounced, duplicate, stale, or jurisdiction-blocked records cannot be recommended for delivery.

### Feishu and Authorization

- `开发客户` always enters the deterministic selection flow for authorized users.
- Pagination and back navigation preserve filters and stable ordering.
- Unauthorized operators cannot view unmasked contact details or change state.
- Repeated selection or approval clicks are idempotent.
- Editing recipient, subject, body, translation reconciliation, or attachments invalidates approval.
- No valid single-use authorization means no delivery call.

### Reply Loop

- A test reply matched by message references updates the correct work item once.
- Ambiguous replies require review and do not mutate company state.
- Translation and suggested replies are stored separately from original messages.
- No suggested reply is delivered without a fresh human confirmation.

### Browser and Mobile

- Feishu desktop and mobile cards expose the same essential facts and actions.
- Compact cards remain usable on mobile without horizontal scrolling.
- Detail pages preserve selected filters and return position.

## Rollout

1. Read-only Feishu selection and progress tracking; delivery hard-disabled.
2. Bilingual immutable drafts and revision workflow; delivery hard-disabled.
3. Sender-domain/authentication validation and jurisdiction policy review.
4. Single-use delivery gate enabled for an explicit allowlist and 5/day maximum.
5. Reply matching, translation, notification, and suggested-reply review.
6. Review delivery, bounce, complaint, opt-out, and response metrics before any future limit change.

No phase automatically raises the daily delivery limit.

## External Guidance

- Gmail Email Sender Guidelines: <https://support.google.com/mail/answer/81126?hl=en>
- Yahoo Sender Requirements and Recommendations: <https://senders.yahooinc.com/best-practices/>
- US FTC CAN-SPAM Compliance Guide: <https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business>
- UK ICO Business-to-Business Marketing Guidance: <https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/business-to-business-marketing/>

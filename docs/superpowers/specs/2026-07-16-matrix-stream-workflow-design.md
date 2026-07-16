# Matrix Stream Workflow Design

Date: 2026-07-16

## Goal

Extend the existing `智能桓` runtime with a controlled workflow that discovers new overseas companies from public web sources, records verifiable company and product evidence, ranks candidates, prepares product-oriented analysis, pauses for two human decisions, sends email only after explicit final confirmation, and reports inbound replies through Feishu.

All new internal components, folders, workflow identifiers, configuration keys, and user-facing feature labels use neutral technical codenames.

## Relationship to Existing Design

This workflow consumes the classification contract defined in `2026-07-16-matrix-candidate-classification-design.md`.

- Existing CRM records and newly discovered records use the same `test`, `noise`, `needs_review`, and `valid` classes.
- Domestic legacy customers remain excluded from the first candidate flow.
- Source CRM records remain unchanged.
- This design adds public discovery, evidence capture, product analysis, Feishu review, controlled delivery, and reply notification.

## Component Codenames

| Codename | Responsibility |
| --- | --- |
| `matrix-stream` | Discover public company pages and retrieve permitted content. |
| `signal-cache` | Normalize and retain public evidence, provenance, timestamps, and confidence. |
| `schema-rank` | Classify and prioritize records using deterministic exclusions and evidence scores. |
| `packet-lens` | Produce evidence-bound product observations and possible structure directions. |
| `packet-gate` | Persist human selection, review, revision, final confirmation, and delivery state. |
| `stream-card` | Render Feishu cards, validate callbacks, and publish reply notifications. |

No codename is an access-control boundary. Data permissions remain enforced by the application and filesystem.

## Reference Projects and Adoption Boundary

The implementation may adapt patterns from these projects after version and license review:

- Crawl4AI: isolated public-page extraction, caching, bounded deep crawl, and resume patterns.
- LangGraph: state-transition and resumable human-review concepts only; the Python framework is not introduced in phase one.
- Lark/Feishu official Node SDK: typed API calls, card delivery, callbacks, and event handling.
- OpenClaw Feishu documentation: operational patterns for persistent connectivity and card updates only.

The implementation does not copy or install a complete third-party automation platform. Any adopted package is pinned to a reviewed version. `matrix-stream` runs isolated from application secrets and cannot access the production database directly.

## Workflow State Machine

```text
discovered
  -> evidence_pending
  -> classified_test | classified_noise | needs_review | valid
valid
  -> analysis_pending
  -> analysis_blocked | selection_pending
selection_pending
  -> dismissed | verification_requested | selected
selected
  -> review_pending
  -> revision_requested | final_confirmation_pending
final_confirmation_pending
  -> cancelled | approved_for_delivery
approved_for_delivery
  -> delivery_failed | delivered
delivered
  -> waiting_reply
  -> replied | no_reply_followup_due | unsubscribed | invalid_address
```

Only `approved_for_delivery` may call the email delivery adapter. The approval record is single-use, bound to the exact recipient, subject, body hash, attachment hashes, approving actor, and a short expiration time. Any edit invalidates the approval and returns the item to review.

## Discovery

### Initial Search Inputs

Each discovery run requires an approved campaign definition containing:

- Target countries or regions.
- Target product or application categories.
- Allowed languages.
- Maximum companies and pages per company.
- Allowed public source types.
- Exclusion terms and existing-domain suppression.

There is no unrestricted “search the whole internet” command. Every run has a bounded scope and an auditable initiator.

### Allowed Sources

- Public company websites.
- Public manufacturer, distributor, association, or exhibition directories whose terms allow access.
- Public business social pages accessible without authentication.
- Public search result pages used only to locate official sources.

### Prohibited Collection

- Login-protected pages, private groups, personal profiles, or paywalled data.
- CAPTCHA bypass, stealth fingerprints, rotating residential proxies, or access-control circumvention.
- Data leaks, purchased private lists, or personal-data brokers.
- Guessed personal email addresses.
- Personal phone numbers not clearly published for business contact.
- Automated submission of website forms.

### Fetch Controls

- Respect site access policies and rate limits.
- Default to the official domain and a small allowlist of paths such as home, about, products, and contact.
- Enforce DNS/IP checks to prevent SSRF and block private, loopback, link-local, metadata, and internal network destinations.
- Disable arbitrary browser scripts, file writes, downloads, proxies, and authenticated sessions.
- Set per-host concurrency, byte, page, redirect, and execution-time limits.
- Store sanitized text and metadata; do not retain executable HTML.

## Public Evidence Model

Every field is evidence-bound:

- Company legal/display name.
- Official domain and canonical URL.
- Country and public address.
- Product categories and described applications.
- Public business email, telephone, WhatsApp, or contact-page URL.
- Evidence URL, page title, retrieval timestamp, content fingerprint, and extraction method.
- Confidence and conflict flags.

Facts from an official company domain outrank directory entries. Conflicting identities or stale/ambiguous contact details result in `needs_review`.

Raw public page text has a retention limit. Long-term storage keeps normalized facts, short evidence excerpts, provenance, and content fingerprints.

## Identity Resolution and Deduplication

Resolution keys, in descending strength:

1. Exact official domain.
2. Exact public business email domain plus compatible company name.
3. Normalized international business phone or WhatsApp plus compatible company name.
4. Normalized company name, country, and public address.

Weak name-only similarity never merges automatically. New evidence may link to an existing CRM customer only after deterministic confidence or human confirmation. Merges are reversible and audited.

## Classification and Ranking

`schema-rank` first applies the approved four-class rules. Only `valid` records receive A/B/C priority.

Ranking inputs may include:

- Official-company identity confidence.
- Public business contact availability.
- Supported product/application fit.
- Specificity of public product evidence.
- Evidence freshness.
- Existing CRM relationship or prior substantive conversation.

Ranking excludes protected personal traits, inferred personal characteristics, and contact frequency alone. Each score exposes reason codes and evidence references.

## Product Analysis

`packet-lens` combines confirmed public product evidence, authorized prior CRM context, and private technical knowledge.

Its internal result contains:

- Confirmed company products and applications with sources.
- Confirmed technical requirements from prior conversations.
- Plausible product/structure directions clearly labelled as hypotheses.
- Missing questions needed before a reliable recommendation.
- Technical risks and rule provenance.
- Recommended communication angle based on evidence, not generic praise.

Hard guards:

- Never invent dimensions, thickness, material grade, process conditions, price, processing fee, loss, margin, freight, plate inputs, MOQ, or certification.
- Never expose internal prices, costs, margins, formulas, or private rule text.
- Order-specific knowledge is not generalized without explicit confirmation.
- Unresolved technical rules produce `analysis_blocked` or visible questions.
- Customer-facing content contains only confirmed facts, labelled possibilities, and concise clarification questions.

## Feishu Interaction

The `智能桓` bot receives `stream-card` messages. The neutral visible feature label is `矩阵候选`.

### Candidate Card

- Company name, country, official domain, and source freshness.
- Product summary and evidence links.
- Public business contact types, masked until an authorized user opens detail.
- Classification, priority, reason codes, missing information, and analysis status.
- Actions: `暂不处理`, `待核实`, `进入分析`.

### Review Card

- Exact intended recipient.
- Evidence-backed company/product summary.
- Suggested strategy and customer-facing draft.
- Warnings, missing facts, and blocked technical questions.
- Actions: `退回修改`, `提交终审`.

### Final Confirmation Card

- Exact recipient, subject, full body, attachments, and sending mailbox.
- Content hash and approval expiration.
- Actions: `取消`, `确认发送`.

Card callbacks validate signature, actor permission, expected state, version, and one-time action token. Duplicate or stale callbacks are rejected safely.

## Delivery

Phase one supports email only. WhatsApp remains read-only.

- The configured SMTP mailbox sends only after valid final confirmation.
- Per-domain and daily limits prevent burst delivery.
- Duplicate recipient/campaign suppression prevents repeated contact.
- Unsubscribe, refusal, hard bounce, invalid address, and do-not-contact status block future delivery.
- Delivery attempts store SMTP receipt metadata and sanitized failure categories.
- A failed send does not reuse approval automatically.

No automated follow-up is delivered in phase one. A no-reply condition creates a review reminder only.

## Reply Matching and Notification

Existing IMAP synchronization matches inbound replies using message identifiers, references, normalized subject, conversation key, sender, and recipient.

On a confident match:

- Update the workflow to `replied`.
- Link the reply to the source candidate and delivery record without overwriting customer data.
- Send a Feishu notification with sender, subject, time, a short authorized summary, and a CRM detail link.

Ambiguous matches enter `needs_review`; no reply content is shown to unauthorized roles.

## Security and Privacy

- `matrix-stream` has outbound web access but no production database credentials.
- A narrow import service validates extracted JSON before storing it.
- Feishu, SMTP, IMAP, and model secrets remain in the existing secret store and never enter prompts, logs, cards, or repository files.
- Candidate list APIs apply existing CRM permissions and field redaction.
- Audit events cover discovery, evidence changes, classification, selection, analysis, revision, approval, delivery, bounce, unsubscribe, and reply matching.
- Database backups keep the same encryption, retention, and access controls as CRM data.

## Failure Handling

- Network or crawl failures are retryable with bounded exponential backoff.
- Robots/access denial, CAPTCHA, and authentication requirements stop collection for that source.
- Conflicting or incomplete evidence routes to `needs_review`.
- Model failure leaves deterministic facts intact and analysis pending.
- Feishu delivery failure remains retryable without advancing workflow state.
- SMTP uncertainty is reconciled using message IDs before allowing any retry.
- Every scheduled run emits counts, failures, and a cursor for safe resume.

## Phased Delivery

### Phase 1: Safe Discovery Dry Run

- Implement bounded public-source discovery and evidence storage.
- Run against an approved small country/product scope.
- Do not send email or create production customers automatically.
- Review all valid/A candidates and samples of other classes.

### Phase 2: Analysis and Feishu Review

- Add product analysis with private-rule guards.
- Add candidate and review cards to `智能桓`.
- Keep final delivery disabled.

### Phase 3: Controlled Email Delivery

- Add single-use final approval, SMTP delivery, suppression, bounce handling, and audit receipts.
- Start with a very small daily limit.

### Phase 4: Reply Loop

- Add full mailbox history synchronization and incremental polling.
- Match replies and notify through Feishu.
- Add review-only no-reply reminders.

## Acceptance Criteria

- Every discovered candidate has public source URLs and retrieval timestamps.
- The crawler cannot access private/internal network addresses or unapproved authenticated sources.
- Domestic legacy customers remain outside the first discovery list.
- Test, noise, do-not-contact, and ambiguous records cannot reach delivery.
- Every product assertion is labelled confirmed, hypothesis, or missing and has provenance.
- Candidate and review cards expose no unauthorized raw contact or private rule data.
- Editing recipient, subject, body, or attachments invalidates final approval.
- Duplicate/stale Feishu callbacks cannot send email.
- No email can be sent without a valid single-use final confirmation.
- Replies are matched with evidence and ambiguous replies require review.
- All state changes and side effects are auditable and resumable.

## First Required Input

Before implementation runs a real discovery dry run, the user must approve one bounded initial campaign definition: target countries/regions, product/application category, languages, maximum company count, and allowed directory sources. This choice does not block building the generic workflow and tests.

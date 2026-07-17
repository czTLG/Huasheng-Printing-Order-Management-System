# Matrix Card Signal Design

## Goal

Make the daily Feishu recommendation usable without a prior session, improve the visual hierarchy on desktop and mobile, and enrich each candidate with evidence-backed supplier and approach signals. Continue expanding the candidate pool around China while excluding China, India, and EU member states from active recommendation and deep-review work.

## Scope and boundaries

- The daily card recommends at most five strict, evidence-qualified overseas companies.
- Priority geography is Japan, South Korea, Vietnam, Thailand, Malaysia, Indonesia, the Philippines, Mongolia, Russia, Kazakhstan, Uzbekistan, Kyrgyzstan, Pakistan, Bangladesh, Nepal, and Sri Lanka.
- China, India, and EU member states remain stored for audit/history but are excluded from discovery prioritization, deep review, and daily recommendation.
- Certification commentary is not shown on Feishu cards. Eligibility filters may use internal capability constraints without claiming certifications that are not held.
- Research uses public organizational information only: official sites, public exhibition/association/government records, publicly visible trade records, and public company pages. No login bypass, private-profile collection, guessed personal contacts, or unsupported relationship claims.
- No external email, WhatsApp, or website contact is sent automatically. Human approval remains mandatory.

## Interaction design

### Daily compact card

The card header is `今日优先候选` with a blue theme and a compact subtitle containing the date and qualified count. Each of A-E is a visually separated block with:

- company name, country, and P0/P1 badge;
- one-line product/category fit;
- one-line recommendation reason;
- supplier signal shown only as `已确认`, `公开线索`, or `未知`;
- one-line approach angle;
- a `查看 A/B/C/D/E` button.

The footer contains `换一批`, `查看进行中`, and a short instruction: `也可 @智能桓 回复 A-E`.

No tables are used. The full card remains within 1,500 Unicode code points and must be usable on a narrow mobile screen.

### Reply and click behavior

- Clicking `查看 A` opens A's detail card.
- `@智能桓 A`, lowercase `a`, and `@智能桓 开发客户 A` have the same meaning.
- If the operator has no active session, the runtime obtains the current strict recommendation snapshot, creates a session scoped to operator + chat + thread, and then opens the requested detail.
- A letter opens detail; it never selects immediately.
- The detail card provides `确认选择`, `返回列表`, and `换一批`.
- `确认选择` uses the existing idempotent selection gate and records the next action.
- Sessions remain isolated per operator, chat, and thread. One person's A-E mapping never applies to another person.
- If the snapshot changed or the candidate is no longer eligible, the action fails closed and offers `刷新今日候选`.

## Detail card hierarchy

1. Header: company, country, priority, current stage.
2. `为什么推荐`: concise fit and scale evidence.
3. `产品结构`: observed categories, formats, public specification signals, and unconfirmed gaps.
4. `供应链线索`:
   - current supplier name when publicly confirmed;
   - supplier country and supplied category when supported;
   - confidence: confirmed / public lead / unknown;
   - source URL and observed date in the expanded evidence view;
   - never infer a named supplier from a generic product photograph alone.
5. `开发策略`:
   - likely entry product;
   - differentiation angle;
   - first-contact objective;
   - questions that must be answered before preparing a message;
   - risks or missing facts.
6. Actions: confirm selection, generate internal suggestion, return to list.

## Supplier evidence model

- `confirmed`: an official partner page, public bill of lading/trade record naming both organizations, government record, or a direct public case study.
- `public_lead`: a public source indicates a possible relationship but does not independently establish an active supplier relationship.
- `unknown`: no reliable public evidence.

Every supplier claim stores source type, source URL, observed date, excerpt, and subject/object company identifiers. Conflicting or stale evidence lowers confidence and creates a review task instead of changing a fact automatically.

## Benchmark signals

The two benchmark organizations are tracked as evidence sources, not as hidden authority:

- Guangdong Shunshun Packaging: public marketplace metrics indicate fast response, standard pouch breadth, and flexible MOQ positioning. A publicly visible trade record names THD Agricultural Processing JSC in Vietnam and laminated packaging for a fruit-jelly product. This is a confirmed lead for researching comparable Vietnamese processors, not proof that every related brand is its customer.
- Guangdong Xintianli Holdings: its official partner section visibly lists named partners; public materials emphasize functional liquid, retort, heavy-duty, peelable-lid, anti-static powder, and high-barrier formats. Public trade summaries show recurring Philippines-bound packaging-roll records but redact at least one buyer name; redacted buyers remain unknown.

The system extracts their apparent selection pattern: recurring product demand, functional packaging need, scalable production, reachable public organization contact, and nearby-country delivery practicality. It does not copy their claims or treat marketplace-generated prose as verified fact.

## Discovery and review loop

Daily operating target:

- discover up to 100 new public-company candidates;
- deep-review up to 20 P0/P1 candidates;
- recommend at most five qualified candidates;
- send zero external messages without explicit human approval.

Discovery starts from the confirmed benchmark relationship and expands to comparable companies by country, category, product format, and scale. The initial nearby-country emphasis is Vietnam fruit processing, drinks, coffee, snacks, household liquids, and personal-care producers, followed by the remaining priority countries.

## Error handling and audit

- Missing official candidate evidence, contact route, or current audit state excludes the row from the daily recommendation. Missing supplier evidence is shown as `未知` and creates a research task; it does not by itself exclude an otherwise qualified candidate.
- A missing session is recovered by creating a fresh strict session; a stale session is never silently reused.
- Card send attempts remain idempotent. Ambiguous delivery requires manual reconciliation.
- All detail views and selections are audited. Public-source provenance is retained even when the user-facing card uses concise labels.

## Acceptance tests

- Scheduled card displays A-E buttons and remains under 1,500 Unicode code points.
- Fresh operator can click A or send `A`, `a`, or `开发客户 A` and receive A detail without first sending `开发客户`.
- Replying A does not create a selection event.
- `确认选择` creates exactly one selection event under retries.
- Two operators in the same group receive independent sessions.
- Changed/invalid candidates fail closed and prompt refresh.
- Cards contain no China, India, or EU candidates.
- Supplier names appear only with confirmed or public-lead evidence and always retain source provenance.
- Desktop and mobile card snapshots remain readable without horizontal tables.
- Production smoke verifies real Feishu inbound message, card callback, detail, confirm, back, and restart recovery.

## Out of scope

- Automatic bulk outreach.
- Private or guessed personal contact discovery.
- Claims that ISO 22000 substitutes for market-specific product or food-contact requirements.
- Deleting deferred geographic records.

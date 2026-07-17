# Matrix Signal Sprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete a one-week, zero-budget authority-building sprint for `https://gdhspack.com` with at least 15 individually reviewed submissions, complete evidence, and a target of 3–7 live referring domains by 2026-07-24.

**Architecture:** Use a file-based registry with separate identity, asset, candidate, message, evidence, and report artifacts under a neutral `docs/matrix-signal/` codename. Every candidate passes a documented quality gate before drafting, every outbound message passes a user-review gate before submission, and every claimed result passes a live-link verification gate.

**Tech Stack:** Markdown, CSV, public web research, Google Search Console exports when supplied by the user, `curl`, `rg`, and Git.

## Global Constraints

- Target only `https://gdhspack.com`.
- Sprint window is 2026-07-17 through 2026-07-24.
- External spend is zero.
- Public identity is `Huasheng Packaging Editorial Team <sales@gdhspack.com>`.
- Legal entity is `Chaozhou Chao'an Huasheng Printing Co., Ltd.`.
- Public address is `Longshewei, Dongmei Road, Chao'an District, Chaozhou, Guangdong, China`.
- No PBNs, expired-domain redirects, paid ranking links, bulk outreach, automated profile creation, forced reciprocal links, guessed private contacts, login bypass, or CAPTCHA bypass.
- No external message or form is submitted until the user reviews the exact outbound content.
- Login and CAPTCHA steps require user takeover.
- Store no passwords, session tokens, CAPTCHA data, or private personal data.
- A source root domain is counted at most once.
- `nofollow`, `sponsored`, and `ugc` links are reported separately and never misrepresented as followed links.

---

## File Map

- Create `docs/matrix-signal/identity.md`: approved public company facts and conflict log.
- Create `docs/matrix-signal/assets.csv`: target-site pages available for citations and their outreach use.
- Create `docs/matrix-signal/registry.csv`: candidate screening, submission, and verification system of record.
- Create `docs/matrix-signal/messages.md`: exact per-target outbound drafts and approval state.
- Create `docs/matrix-signal/evidence/README.md`: evidence naming and privacy rules.
- Create `docs/matrix-signal/baseline-2026-07-17.md`: starting public footprint and any supplied Search Console baseline.
- Create `docs/matrix-signal/report-2026-07-24.md`: final live, pending, rejected, blocked, and disqualified results.

### Task 1: Establish the identity and baseline gate

**Files:**
- Create: `docs/matrix-signal/identity.md`
- Create: `docs/matrix-signal/baseline-2026-07-17.md`
- Create: `docs/matrix-signal/evidence/README.md`

**Interfaces:**
- Consumes: Approved facts and constraints in `docs/superpowers/specs/2026-07-17-matrix-signal-sprint-design.md`.
- Produces: Canonical identity fields and baseline evidence rules used by every later task.

- [ ] **Step 1: Create the canonical identity record**

Create `docs/matrix-signal/identity.md` with exactly these approved fields, followed by a conflict table:

```markdown
# Matrix Signal Identity

- Brand: Huasheng Packaging
- Legal entity: Chaozhou Chao'an Huasheng Printing Co., Ltd.
- Website: https://gdhspack.com
- Address: Longshewei, Dongmei Road, Chao'an District, Chaozhou, Guangdong, China
- Outreach identity: Huasheng Packaging Editorial Team
- Outreach email: sales@gdhspack.com

## Conflict Gate

| Public URL | Conflicting field | Observed value | Approved value | Status |
|---|---|---|---|---|
```

- [ ] **Step 2: Audit public identity claims**

Inspect the homepage, About page, Contact page, footer, organization structured data, and at least the English and German About variants. Record every mismatch involving legal name, city, address, founding year, factory area, certification, equipment count, or capacity. Use `blocked` for any fact not already approved by the user.

- [ ] **Step 3: Capture the public baseline**

Create `docs/matrix-signal/baseline-2026-07-17.md` with sections for:

```markdown
# Matrix Signal Baseline — 2026-07-17

## Publicly Discoverable Mentions

## Search Console Export

Not supplied at sprint start. Add only if the user provides an export.

## Known Referring Root Domains

## Target-Site Identity Conflicts

## Baseline Limitations

Public search results and Search Console are sampled views; absence is not proof that no link exists.
```

Search the exact domain and the approved legal name separately. Record only public source URLs; do not copy personal contact details.

- [ ] **Step 4: Define evidence handling**

Create `docs/matrix-signal/evidence/README.md` specifying filename format `YYYYMMDD-domain-stage.md`, allowed evidence (public URL, timestamp, non-sensitive confirmation text), and forbidden evidence (passwords, cookies, session tokens, CAPTCHA material, private personal data).

- [ ] **Step 5: Validate Task 1 artifacts**

Run:

```bash
rg -n "Brand: Huasheng Packaging|Legal entity: Chaozhou Chao'an Huasheng Printing Co., Ltd.|Website: https://gdhspack.com|Outreach email: sales@gdhspack.com" docs/matrix-signal/identity.md
rg -n "Publicly Discoverable Mentions|Known Referring Root Domains|Baseline Limitations" docs/matrix-signal/baseline-2026-07-17.md
rg -n "passwords|session tokens|CAPTCHA" docs/matrix-signal/evidence/README.md
```

Expected: every pattern is present and no command exits nonzero.

- [ ] **Step 6: Commit the baseline gate**

```bash
git add docs/matrix-signal/identity.md docs/matrix-signal/baseline-2026-07-17.md docs/matrix-signal/evidence/README.md
git commit -m "docs: establish matrix signal baseline"
```

### Task 2: Inventory linkable target-site assets

**Files:**
- Create: `docs/matrix-signal/assets.csv`

**Interfaces:**
- Consumes: Target domain and conflict gate from Task 1.
- Produces: Approved `asset_id` and `target_url` values used by the candidate registry and messages.

- [ ] **Step 1: Create the asset schema**

Create `docs/matrix-signal/assets.csv` with this header:

```csv
asset_id,target_url,page_type,language,audience_problem,unique_value,identity_conflict,http_status,indexable,approved_for_outreach,notes
```

- [ ] **Step 2: Inventory current assets**

Add the homepage, About page, material knowledge center, packaging options library, solutions hub, and the six packaging guides exposed from the homepage. Add directly relevant product/application pages only when they offer information beyond a sales CTA.

Use stable identifiers such as `asset_home`, `asset_about`, `asset_material_hub`, and `asset_guide_artwork`. Mark `approved_for_outreach=no` when the page depends on a blocked identity fact, returns a non-200 status, has a canonical mismatch, or is not publicly indexable.

- [ ] **Step 3: Check response and canonical behavior**

For each target URL, use an HTTP header request and inspect page source or rendered metadata for canonical and robots directives. Record exact observations rather than assuming indexability.

- [ ] **Step 4: Validate the asset inventory**

Run:

```bash
head -1 docs/matrix-signal/assets.csv
rg -n "asset_home|asset_about|asset_material_hub|asset_guide_artwork" docs/matrix-signal/assets.csv
```

Expected first line:

```text
asset_id,target_url,page_type,language,audience_problem,unique_value,identity_conflict,http_status,indexable,approved_for_outreach,notes
```

- [ ] **Step 5: Commit the asset inventory**

```bash
git add docs/matrix-signal/assets.csv
git commit -m "docs: inventory matrix signal assets"
```

### Task 3: Build and screen the 30–40 domain candidate pool

**Files:**
- Create: `docs/matrix-signal/registry.csv`

**Interfaces:**
- Consumes: Approved target assets from `docs/matrix-signal/assets.csv`.
- Produces: Unique `candidate_id` rows in state `screened`, `disqualified`, or `blocked` for drafting tasks.

- [ ] **Step 1: Create the registry schema**

Create `docs/matrix-signal/registry.csv` with this header:

```csv
candidate_id,root_domain,source_url,source_class,topic,official_contact_url,asset_id,target_url,relevance,editorial_owner,indexable_path,no_link_sales,no_forced_exchange,public_contact_only,quality_decision,quality_reason,state,draft_id,user_approval,submitted_at,evidence_ref,live_url,rel_value,verified_at,follow_up_at,notes
```

- [ ] **Step 2: Discover candidates using four source lanes**

Research 30–40 unique root domains with public search and official-site verification:

1. Reviewed free industry, manufacturing, and regional directories.
2. Packaging, food-production, converting, printing, and materials publications with public contributor routes.
3. Resource pages and currently broken citations relevant to material selection, artwork preparation, pouch types, coffee valves, or spout pouches.
4. Existing public mentions and genuine supplier, machinery, certification, exhibition, association, or regional ecosystem pages.

Use focused queries that combine the topic with terms such as `directory`, `supplier listing`, `write for us`, `contributor guidelines`, `resources`, and exact broken resource titles. Search results only discover candidates; the official site supplies verification.

- [ ] **Step 3: Apply the mandatory quality columns**

Set each of `relevance`, `editorial_owner`, `indexable_path`, `no_link_sales`, `no_forced_exchange`, and `public_contact_only` to `yes`, `no`, or `unknown`. A row can be `screened` only when all six are `yes`. Any `no` becomes `disqualified`; any `unknown` becomes `blocked` pending evidence.

Do not promote a candidate based on domain rating alone. Record the official public submission/contact URL, not a scraped or guessed email address.

- [ ] **Step 4: Enforce source-mix and reserve requirements**

The screened pool must contain at least:

- 8 directory/profile candidates
- 8 editorial contribution candidates
- 8 resource/broken-citation candidates
- 4 mention/relationship candidates
- 5 additional screened reserve candidates across any approved class

If a lane cannot meet its minimum without lowering quality, document the shortfall and increase another editorially valid lane; do not add low-quality rows to satisfy a number.

- [ ] **Step 5: Validate registry shape and uniqueness**

Run:

```bash
head -1 docs/matrix-signal/registry.csv
awk -F, 'NR>1 {count[$2]++} END {for (d in count) if (count[d]>1) print d}' docs/matrix-signal/registry.csv
rg -n ",screened,|,disqualified,|,blocked," docs/matrix-signal/registry.csv
```

Expected: header matches the schema, the `awk` command prints nothing, and at least one explicit state is present.

- [ ] **Step 6: Commit the screened pool**

```bash
git add docs/matrix-signal/registry.csv
git commit -m "docs: screen matrix signal candidate pool"
```

### Task 4: Draft and approve the first five submissions

**Files:**
- Create: `docs/matrix-signal/messages.md`
- Modify: `docs/matrix-signal/registry.csv`

**Interfaces:**
- Consumes: Five highest-quality screened candidates with approved `asset_id` values.
- Produces: `draft_id` values in `messages.md` and registry rows in `user_review` or `submitted` state.

- [ ] **Step 1: Select the first cohort**

Choose five candidates with the clearest official submission routes, strongest topical relevance, and shortest likely review path. Prefer a varied cohort rather than five copies of one source class.

- [ ] **Step 2: Create the message records**

For each selected candidate, add a section whose heading is `draft_` followed by that row's exact `candidate_id`. Under the heading, copy the row's candidate ID, root domain, `official_contact_url`, and `target_url`; set proposed anchor context to `brand`, `bare_url`, or `publisher_selected`; set approval to `pending`; then add the complete target-specific form response or email under `### Exact outbound content`. Sign every message `Huasheng Packaging Editorial Team`. Do not save an empty field or generic reusable pitch.

- [ ] **Step 3: Apply the message quality check**

Each draft must explain why the destination helps that site's readers, mention one specific page or guideline on the target site, avoid requesting followed links or exact-match anchors, avoid unsupported claims, and contain no guessed personal name.

- [ ] **Step 4: Present the five exact drafts for user approval**

Show the complete outbound content and destination for each candidate. Record `approved`, `rejected`, or `changes_requested` only from the user's explicit response.

- [ ] **Step 5: Submit approved drafts individually**

Use the official route recorded in the registry. Pause for the user on login or CAPTCHA. After each completed submission, set `state=submitted`, record an ISO-8601 `submitted_at`, and create a non-sensitive evidence note using the Task 1 naming rule. If submission cannot be completed, set `state=blocked` and record the exact operational reason.

- [ ] **Step 6: Validate and commit the first cohort**

Run:

```bash
rg -n "^## draft_|Approval: (approved|rejected|changes_requested|pending)|Huasheng Packaging Editorial Team" docs/matrix-signal/messages.md
rg -n ",submitted,|,blocked," docs/matrix-signal/registry.csv
```

Expected: five draft headings exist, every draft has an approval state and signature, and every attempted registry row has a terminal sprint-attempt state.

```bash
git add docs/matrix-signal/messages.md docs/matrix-signal/registry.csv docs/matrix-signal/evidence
git commit -m "docs: submit first matrix signal cohort"
```

### Task 5: Complete ten additional qualified submissions

**Files:**
- Modify: `docs/matrix-signal/messages.md`
- Modify: `docs/matrix-signal/registry.csv`
- Create: `docs/matrix-signal/evidence/YYYYMMDD-domain-stage.md` as submissions occur

**Interfaces:**
- Consumes: Screened reserve candidates and the approved drafting/submission workflow from Task 4.
- Produces: At least 15 total qualified submitted rows, or an explicit operational block record for any user-controlled login/CAPTCHA gate.

- [ ] **Step 1: Select two review cohorts of five**

Choose candidates that move the portfolio toward the design mix. Do not reduce the quality gate to hit the submission target.

- [ ] **Step 2: Draft the second cohort**

Add five complete target-specific drafts using the exact record structure from Task 4. Map every pitch to an approved target asset and a concrete reader need.

- [ ] **Step 3: Obtain user approval and submit the second cohort**

Present exact messages, record explicit decisions, submit individually, pause on login/CAPTCHA, and update registry/evidence after each attempt.

- [ ] **Step 4: Draft the third cohort**

Add five complete target-specific drafts. Prefer editorial, resource, or mention-reclamation candidates if directory/profile submissions dominate the first ten.

- [ ] **Step 5: Obtain user approval and submit the third cohort**

Repeat the same exact review, submission, pause, and evidence requirements. One customized first contact per target; do not bulk-send.

- [ ] **Step 6: Verify submission count and commit**

Run:

```bash
awk -F, 'NR>1 && $17=="submitted" {n++} END {print n+0}' docs/matrix-signal/registry.csv
rg -c "^## draft_" docs/matrix-signal/messages.md
```

Expected: submitted count is at least `15`, and draft count is at least `15`. If user-controlled gates prevent 15 completed submissions, the report must show each exact blocked row and no success claim may be made.

```bash
git add docs/matrix-signal/messages.md docs/matrix-signal/registry.csv docs/matrix-signal/evidence
git commit -m "docs: complete matrix signal submissions"
```

### Task 6: Verify live results and perform one permitted follow-up

**Files:**
- Modify: `docs/matrix-signal/registry.csv`
- Create: `docs/matrix-signal/evidence/YYYYMMDD-domain-live.md` as links appear

**Interfaces:**
- Consumes: Submitted and pending rows from Tasks 4–5.
- Produces: Verified `live`, `pending`, `rejected`, `blocked`, or `disqualified` rows for reporting.

- [ ] **Step 1: Check every submitted route for status**

Use public confirmation URLs, publisher replies supplied by the user, or published pages. Do not infer publication from a successful form submission.

- [ ] **Step 2: Verify every claimed live link**

For each live page, confirm public HTTP access, visible clickable placement, destination on `gdhspack.com`, unique source root domain, contextual relevance, and observed `rel` value. Set `verified_at` only after all checks pass.

- [ ] **Step 3: Draft the single permitted follow-up**

Only draft a follow-up when the site's process allows it and sufficient review time has elapsed. Present the exact follow-up to the user before sending. Do not send a second follow-up within this sprint.

- [ ] **Step 4: Reapply the quality gate**

Disqualify any source that begins selling ranking links, adds unrelated bulk content, forces reciprocity, or otherwise fails the original screen. Replace it from the screened reserve when sprint time permits.

- [ ] **Step 5: Validate live records and commit**

Run:

```bash
awk -F, 'NR>1 && $17=="live" && ($22=="" || $23=="" || $24=="") {print $1}' docs/matrix-signal/registry.csv
```

Expected: no output; every live row has a `rel_value` and `verified_at`.

```bash
git add docs/matrix-signal/registry.csv docs/matrix-signal/messages.md docs/matrix-signal/evidence
git commit -m "docs: verify matrix signal results"
```

### Task 7: Deliver the sprint report

**Files:**
- Create: `docs/matrix-signal/report-2026-07-24.md`
- Modify: `docs/matrix-signal/registry.csv`

**Interfaces:**
- Consumes: Final registry and evidence records.
- Produces: Auditable sprint outcome and post-sprint follow-up queue.

- [ ] **Step 1: Freeze final sprint states**

Ensure every attempted candidate is exactly one of `live`, `pending`, `rejected`, `blocked`, or `disqualified`. Preserve `submitted_at` and evidence references.

- [ ] **Step 2: Write the final report**

Create `docs/matrix-signal/report-2026-07-24.md` with:

```markdown
# Matrix Signal Sprint Report — 2026-07-24

## Outcome Summary

## Live Referring Root Domains

## Pending Reviews and One Follow-up Date

## Rejected, Blocked, and Disqualified Targets

## Source-Mix Comparison

## Link-Attribute Breakdown

## Target-Page Distribution

## Evidence Index

## Limitations and Next Review Date
```

Report submitted and live counts separately. Never count a pending, blocked, rejected, or disqualified row as live. State that publication timing and ranking effects are controlled by third parties and search systems.

- [ ] **Step 3: Cross-check report totals against the registry**

Run:

```bash
awk -F, 'NR>1 {count[$17]++} END {for (s in count) print s, count[s]}' docs/matrix-signal/registry.csv | sort
rg -n "Outcome Summary|Live Referring Root Domains|Pending Reviews|Evidence Index|Limitations" docs/matrix-signal/report-2026-07-24.md
git diff --check -- docs/matrix-signal
```

Expected: registry state totals are printed, all report sections exist, and `git diff --check` exits zero.

- [ ] **Step 4: Commit the sprint report**

```bash
git add docs/matrix-signal/registry.csv docs/matrix-signal/report-2026-07-24.md docs/matrix-signal/evidence
git commit -m "docs: report matrix signal sprint"
```

## Final Verification

Run:

```bash
test -f docs/matrix-signal/identity.md
test -f docs/matrix-signal/assets.csv
test -f docs/matrix-signal/registry.csv
test -f docs/matrix-signal/messages.md
test -f docs/matrix-signal/report-2026-07-24.md
git diff --check -- docs/matrix-signal docs/superpowers/plans/2026-07-17-matrix-signal-sprint.md
```

Expected: all commands exit zero. Completion claims must quote the actual submitted count, verified live unique-root-domain count, attribute breakdown, and any remaining user-controlled blocks.

# Matrix Regional Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Research six priority Asian/Central Asian manufacturers, build reusable localized Huasheng buyer journeys from confirmed evidence, verify those journeys on desktop and mobile, and prepare six review-only first-contact drafts after all gates pass.

**Architecture:** The management project remains authoritative for company-specific evidence, score state and drafts. The public-site project receives only reusable country/segment content and route-verification records without prospect names. A deterministic route manifest connects candidate segment and locale to verified public URLs; deployment and every external send remain separately approval-gated.

**Tech Stack:** Node.js 22, Express, SQLite (`better-sqlite3`), TypeScript, React, Vite, JSON locale shards, Playwright/browser smoke scripts, systemd production services.

## Global Constraints

- Fixed cohort and order: Mit Mongkol, Lix Detergent, JD Food, Cholimex Food, Orda Trade Astana, PT Adev Natural Indonesia.
- India is excluded and EU prospects remain deferred.
- Use public organizational information only; no login bypass, CAPTCHA evasion, private profiles or guessed personal contacts.
- Company-specific evidence stays in `/home/admin/work/packaging-system`; prospect names never enter public website copy.
- Initial draft requires strategy match at least 75/100 with no critical blocker and a production-verified localized route.
- English is the authoritative body; add one brief local-language courtesy closing and a complete Chinese internal translation.
- Do not deploy, restart production, publish, email, WhatsApp or submit a contact form without explicit approval.
- Preserve unrelated dirty-worktree files in both repositories.

---

### Task 1: Authoritative Research Ledger

**Files:**
- Modify: `/home/admin/work/packaging-system/src/db.js`
- Create: `/home/admin/work/packaging-system/src/services/matrixResearchLedger.js`
- Create: `/home/admin/work/packaging-system/scripts/test-matrix-research-ledger.js`

**Interfaces:**
- Consumes: `cache_records.id` from `data/matrix-stream.db` and authenticated management actor IDs.
- Produces: `saveDossier(db, input)`, `getDossier(db, candidateId)`, `saveRouteAssessment(db, input)`, and immutable source/fact rows.

- [ ] **Step 1: Write the failing ledger test**

Create a temporary SQLite database, initialize migrations, save three official sources and facts classified as `confirmed`, `inferred`, `unknown`, and `not_relevant`, then assert that a dossier with fewer than three distinct official sources or missing profile/product/process/contact roles returns `status: 'insufficient'`. Assert duplicate URLs update by fingerprint without duplicating rows.

- [ ] **Step 2: Run the test and verify failure**

Run: `node scripts/test-matrix-research-ledger.js`

Expected: FAIL because `matrixResearchLedger` and its tables do not exist.

- [ ] **Step 3: Add focused schema and service**

Add tables `matrix_research_dossiers`, `matrix_research_sources`, `matrix_research_facts`, and `matrix_route_assessments`. Use foreign keys, `UNIQUE(candidate_id, source_url, fingerprint)`, allowed confidence values, checked timestamps, and JSON only for bounded arrays. Do not store credentials, raw messages, or private contacts.

Implement dossier completion as:

```js
const REQUIRED_ROLES = new Set(['profile', 'products', 'process', 'contact']);
const complete = distinctOfficialUrls >= 3
  && [...REQUIRED_ROLES].every(role => coveredRoles.has(role));
return { status: complete ? 'complete' : 'insufficient', blockers };
```

- [ ] **Step 4: Verify ledger behavior**

Run: `node scripts/test-matrix-research-ledger.js`

Expected: PASS with incomplete dossiers blocked and complete dossiers round-tripped.

- [ ] **Step 5: Commit**

```bash
git add src/db.js src/services/matrixResearchLedger.js scripts/test-matrix-research-ledger.js
git commit -m "feat(matrix): add public research ledger"
```

### Task 2: Six Official-Site Dossiers

**Files:**
- Create: `/home/admin/work/packaging-system/scripts/matrix-research-import.js`
- Create privately at runtime: `/home/admin/work/packaging-system/runtime-data-matrix-research-private/<candidate-id>.json`
- Test: `/home/admin/work/packaging-system/scripts/test-matrix-research-import.js`

**Interfaces:**
- Consumes: official URLs for candidate IDs `18`, `63`, `75`, `121`, `116`, and `98`.
- Produces: validated ledger rows and a per-candidate completion/blocker report; private JSON inputs are not committed.

- [ ] **Step 1: Write the failing importer test**

Test strict allowed fields, HTTPS official sources, ISO timestamps, source roles, confidence classification, rejection of prospect facts in `public_copy`, and atomic failure without partial writes.

- [ ] **Step 2: Run the failing test**

Run: `node scripts/test-matrix-research-import.js`

Expected: FAIL because the importer does not exist.

- [ ] **Step 3: Implement the importer**

Accept only `candidate_id`, `checked_at`, `reviewer`, `sources`, `facts`, `content_gaps`, and `unanswered_questions`. Require source roles from `home`, `profile`, `products`, `process`, `quality`, `sustainability`, `contact`; absent optional roles must be explicitly recorded as unavailable.

- [ ] **Step 4: Research and import each dossier sequentially**

For each fixed candidate, read the official home/profile/products/process/quality/contact pages plus authoritative public corporate material when the official site lacks a required role. Record exact URLs and checked date. Keep `inferred` supplier and buyer-priority hypotheses internal. Do not modify the next company until the current dossier reports either `complete` or an explicit blocker.

- [ ] **Step 5: Verify all six reports**

Run: `node scripts/matrix-research-import.js --verify-cohort 18,63,75,121,116,98`

Expected: six rows, each `complete` or `blocked` with named missing roles; no ambiguous state.

- [ ] **Step 6: Commit only code and tests**

```bash
git add scripts/matrix-research-import.js scripts/test-matrix-research-import.js
git commit -m "feat(matrix): validate regional research dossiers"
```

### Task 3: Reusable Route Manifest and Content Contract

**Files:**
- Create: `/home/admin/work/huasheng-packing/src/buyer-route-manifest.ts`
- Create: `/home/admin/work/huasheng-packing/scripts/verify-buyer-route-manifest.mjs`
- Modify: `/home/admin/work/huasheng-packing/package.json`

**Interfaces:**
- Consumes: reusable `locale`, `marketSlug`, `applicationSlug`, `productSlugs`, and segment identifiers only.
- Produces: `BUYER_ROUTE_MANIFEST` and `getBuyerRoute(locale, segment)`; no company names.

- [ ] **Step 1: Write a failing manifest verifier**

Require route IDs for `th-liquid-care`, `th-seasoning-sauce`, `vi-liquid-care`, `vi-sauce`, `ru-central-asia-tea`, and `id-personal-care`. Assert one application primary link, one about secondary link, one or two products, canonical slugs, supported locales, and absence of all six prospect names.

- [ ] **Step 2: Run and confirm failure**

Run: `node scripts/verify-buyer-route-manifest.mjs`

Expected: FAIL because the manifest is missing.

- [ ] **Step 3: Implement the typed manifest**

Use:

```ts
export type BuyerRoute = Readonly<{
  id: string; locale: 'th'|'vi'|'ru'|'id'; segment: string;
  marketSlug: string; applicationSlug: string; productSlugs: readonly string[];
  primaryUrl: string; aboutUrl: string;
}>;
```

Build URLs from canonical locale and slug helpers; do not hard-code prospect-specific campaign paths.

- [ ] **Step 4: Verify and commit**

Run: `node scripts/verify-buyer-route-manifest.mjs`

Expected: PASS for six route IDs and prospect-name scan.

```bash
git add src/buyer-route-manifest.ts scripts/verify-buyer-route-manifest.mjs package.json
git commit -m "feat(site): define reusable regional buyer routes"
```

### Task 4: Shared Application Decision Sections

**Files:**
- Modify: `/home/admin/work/huasheng-packing/src/application-route-views.tsx`
- Modify: `/home/admin/work/huasheng-packing/src/application-sections.ts`
- Modify: `/home/admin/work/huasheng-packing/src/index.css`
- Create: `/home/admin/work/huasheng-packing/scripts/verify-regional-buyer-sections.mjs`

**Interfaces:**
- Consumes: locale content keys for buyer inputs, review workflow, multi-SKU control, validation boundaries, and China handoff.
- Produces: reusable responsive decision sections shared by liquid-care, sauce, seasoning, snack and tea applications.

- [ ] **Step 1: Write the failing section verifier**

Assert every target application provides: `fit`, `risks`, `buyerInputs`, `reviewSteps`, `multiSku`, `validationBoundary`, and `chinaHandoff`. Scan rendered source for fixed price, universal MOQ, unconditional leak/barrier promise, and prospect names.

- [ ] **Step 2: Run and verify failure**

Run: `node scripts/verify-regional-buyer-sections.mjs`

Expected: FAIL listing missing sections.

- [ ] **Step 3: Implement reusable rendering**

Render semantic headings, short cards and one clear CTA. Liquid pages request formula, viscosity, fill temperature, volume, fitment and storage. Roll-film pages request machine model, web width, repeat length, unwind direction and sealing window. Food pages request oil/moisture/aroma exposure and storage. All final structures remain conditional on representative testing.

- [ ] **Step 4: Add responsive behavior**

Use a single column below `768px`, touch targets at least `44px`, wrapping links and `overflow-wrap:anywhere`; prevent horizontal overflow at 390px.

- [ ] **Step 5: Verify and commit**

Run: `node scripts/verify-regional-buyer-sections.mjs`

Expected: PASS.

```bash
git add src/application-route-views.tsx src/application-sections.ts src/index.css scripts/verify-regional-buyer-sections.mjs
git commit -m "feat(site): add reusable buyer decision sections"
```

### Task 5: Thai Liquid-Care and Food Journeys

**Files:**
- Modify: `/home/admin/work/huasheng-packing/src/ui-locales/th.json`
- Modify: `/home/admin/work/huasheng-packing/src/product-detail-locales.ts`
- Modify: `/home/admin/work/huasheng-packing/src/product-details/spout-pouch.json`
- Modify: `/home/admin/work/huasheng-packing/data/app-solution-translations.json`
- Create: `/home/admin/work/huasheng-packing/scripts/verify-th-regional-routes.mjs`

**Interfaces:**
- Consumes: confirmed reusable gaps from Mit Mongkol and JD Food dossiers.
- Produces: Thai liquid-care and seasoning/sauce journeys without either company name.

- [ ] **Step 1: Write failing Thai route assertions**

Require Thai-visible headings and decision copy on home/about/market/application/product paths, formula/filling/fitment inputs for liquid care, oil/moisture/seal inputs for sauces and seasoning, one-SKU-first workflow, multi-SKU control and China handoff.

- [ ] **Step 2: Run and confirm failure**

Run: `node scripts/verify-th-regional-routes.mjs`

Expected: FAIL on the missing Thai food route and any remaining generic or unsupported claims.

- [ ] **Step 3: Add evidence-led reusable Thai content**

Extend existing Thai content rather than duplicating pages. Replace unconditional leak, retort, AQL, shelf-life or material statements with conditional review language when evidence does not support the stronger claim.

- [ ] **Step 4: Verify and commit**

Run: `node scripts/verify-th-regional-routes.mjs && npm run build`

Expected: PASS and successful build.

```bash
git add src/ui-locales/th.json src/product-detail-locales.ts src/product-details/spout-pouch.json data/app-solution-translations.json scripts/verify-th-regional-routes.mjs
git commit -m "feat(site): strengthen Thai liquid and food journeys"
```

### Task 6: Vietnamese Liquid-Care and Sauce Journeys

**Files:**
- Modify: `/home/admin/work/huasheng-packing/src/ui-locales/vi.json`
- Modify: `/home/admin/work/huasheng-packing/src/product-detail-locales.ts`
- Modify: `/home/admin/work/huasheng-packing/data/app-solution-translations.json`
- Create: `/home/admin/work/huasheng-packing/scripts/verify-vi-regional-routes.mjs`

**Interfaces:**
- Consumes: confirmed reusable gaps from Lix Detergent and Cholimex Food dossiers.
- Produces: Vietnamese liquid-care and sauce routes with segment-specific decision inputs.

- [ ] **Step 1: Write failing Vietnamese assertions**

Require Vietnamese headings, liquid formula/filling/storage fields, powder moisture/seal fields, sauce viscosity/fill-temperature fields, representative-test boundaries, multi-SKU controls and official contact CTA.

- [ ] **Step 2: Run, implement, rerun**

Run before implementation: `node scripts/verify-vi-regional-routes.mjs`

Expected: FAIL.

Add reusable Vietnamese copy, then run: `node scripts/verify-vi-regional-routes.mjs && npm run build`

Expected: PASS and successful build.

- [ ] **Step 3: Commit**

```bash
git add src/ui-locales/vi.json src/product-detail-locales.ts data/app-solution-translations.json scripts/verify-vi-regional-routes.mjs
git commit -m "feat(site): add Vietnamese liquid and sauce journeys"
```

### Task 7: Central Asian Tea and Indonesian Personal-Care Journeys

**Files:**
- Modify: `/home/admin/work/huasheng-packing/src/ui-locales/ru.json`
- Modify: `/home/admin/work/huasheng-packing/src/ui-locales/id.json`
- Modify: `/home/admin/work/huasheng-packing/src/product-detail-locales.ts`
- Modify: `/home/admin/work/huasheng-packing/data/app-solution-translations.json`
- Create: `/home/admin/work/huasheng-packing/scripts/verify-ru-id-regional-routes.mjs`

**Interfaces:**
- Consumes: confirmed reusable gaps from Orda Trade Astana and PT Adev dossiers.
- Produces: Russian Central Asian tea route and Indonesian personal-care OEM route.

- [ ] **Step 1: Write failing locale assertions**

For Russian tea, require aroma/moisture, retail pouch versus tea-bag overwrap, machine web/repeat/unwind inputs and multi-brand controls. For Indonesian personal care, require formula/viscosity/fill/fitment, representative SKU, multi-brand artwork and packaging handoff.

- [ ] **Step 2: Run, implement, rerun**

Run before: `node scripts/verify-ru-id-regional-routes.mjs`

Expected: FAIL.

Add reusable localized copy, then run: `node scripts/verify-ru-id-regional-routes.mjs && npm run build`

Expected: PASS and successful build.

- [ ] **Step 3: Commit**

```bash
git add src/ui-locales/ru.json src/ui-locales/id.json src/product-detail-locales.ts data/app-solution-translations.json scripts/verify-ru-id-regional-routes.mjs
git commit -m "feat(site): add Central Asian tea and Indonesian care journeys"
```

### Task 8: Desktop, Mobile, Canonical and Fallback Verification

**Files:**
- Create: `/home/admin/work/huasheng-packing/scripts/verify-regional-route-browser.mjs`
- Create: `/home/admin/work/huasheng-packing/scripts/verify-regional-route-ssr.mjs`
- Modify: `/home/admin/work/huasheng-packing/package.json`

**Interfaces:**
- Consumes: `BUYER_ROUTE_MANIFEST` and a local or production origin.
- Produces: JSON verification record with status `verified-local`, `ready`, `blocked`, or `stale`.

- [ ] **Step 1: Write failing browser and SSR checks**

For all manifest URLs assert HTTP 200, expected canonical/hreflang, target-language `<html lang>`, no P0/P1 English leakage, visible H1/CTA, valid links, no horizontal overflow at 390×844 and 1440×900, and 44px minimum interactive controls.

- [ ] **Step 2: Run against local build and confirm initial failures**

Run: `npm run build && node scripts/verify-regional-route-ssr.mjs --origin http://127.0.0.1:3333 && node scripts/verify-regional-route-browser.mjs --origin http://127.0.0.1:3333`

Expected: FAIL until all route mappings and localized content are complete.

- [ ] **Step 3: Correct only reported route/content defects**

Return each defect to its owning Task 5, 6, or 7 file list, add a regression assertion to that locale verifier, and commit it with that task's exact paths. Do not stage unrelated `src/` or `data/` files. Re-run after each defect class until all six route IDs pass.

- [ ] **Step 4: Commit verification tooling and resulting focused fixes**

```bash
git add scripts/verify-regional-route-browser.mjs scripts/verify-regional-route-ssr.mjs package.json
git commit -m "test(site): verify regional buyer journeys"
```

### Task 9: Deployment Gate and Production Verification

**Files:**
- Modify after verification only: `/home/admin/.codex/matrix-runtime/resources/site-runtime.md`
- Modify after verification only: `/home/admin/.codex/matrix-runtime/capabilities/matrix-route-guard.md`
- Modify after verification only: `/home/admin/.codex/matrix-runtime/INDEX.md`

**Interfaces:**
- Consumes: clean website commits and local verification records.
- Produces: approved release, production route status and catalog reconciliation.

- [ ] **Step 1: Run full pre-deployment checks**

Run: `npm run lint`, `npm run build`, all four regional verifier scripts, SSR verifier and browser verifier.

Expected: all PASS; no production mutation.

- [ ] **Step 2: Stop for explicit deployment approval**

Report commits, routes, desktop/mobile results and rollback target. Do not deploy until the user explicitly approves.

- [ ] **Step 3: Deploy through the canonical entry**

After approval run `/home/admin/work/huasheng-packing/scripts/deploy-native.sh` according to `site-runtime`, restart only the website service, and retain the prior release.

- [ ] **Step 4: Verify production**

Run both verification scripts against `https://gdhspack.com`, check service health and restart count, and mark each route `ready` only when every check passes. Roll back on P0/P1 failure.

- [ ] **Step 5: Reconcile the user catalog**

Update only paths, commit/release, status and verification date. Scan the catalog for credentials, message IDs and actual business records.

### Task 10: Strategy Scoring and Six Review-Only Drafts

**Files:**
- Modify: `/home/admin/work/packaging-system/src/services/matrixSignalMatch.js`
- Modify: `/home/admin/work/packaging-system/src/routes/matrix.js`
- Create: `/home/admin/work/packaging-system/src/services/matrixRegionalDraft.js`
- Create: `/home/admin/work/packaging-system/scripts/test-matrix-regional-draft.js`
- Modify: `/home/admin/work/packaging-system/.runtime/vm_debug_ci/workspace/extensions/stream-card.cjs`

**Interfaces:**
- Consumes: complete dossier, production route status `ready`, official organizational recipient, current evidence and route manifest ID.
- Produces: English draft, Chinese translation, one local courtesy closing, primary localized URL, optional about URL, separate strategy and text-quality scores.

- [ ] **Step 1: Write failing draft tests**

For each candidate fixture assert: blocked dossier or stale route creates no draft row; score below 75 creates no draft; passing input creates exactly one immutable next revision; body has separated greeting/paragraph/question/links/local closing/signature; no ellipsis; no unsupported claims; no more than two URLs; no send job.

- [ ] **Step 2: Run and confirm failure**

Run: `node scripts/test-matrix-regional-draft.js`

Expected: FAIL because the regional draft composer does not exist.

- [ ] **Step 3: Implement deterministic draft composition**

Compose from the dossier's confirmed company observation and route manifest. Use this layout:

```text
Dear <official team role>,

<one confirmed company observation>

<one relevant packaging scenario and bounded Huasheng capability>

<one-SKU/sample/specification next step>

<one answerable question>

<primary localized application URL>
<optional localized about URL>

<brief local courtesy closing>

Best regards,
Gavin
Huasheng Printing Co., Ltd.
```

- [ ] **Step 4: Render complete review cards**

Show full paragraph-preserving English and Chinese bodies, company/country, source URLs, route readiness, strategy score and text score. Buttons remain review-only; do not add automatic sending.

- [ ] **Step 5: Verify all management tests**

Run: `node scripts/test-matrix-signal-match.js`, `node scripts/test-matrix-regional-draft.js`, `node scripts/test-matrix-api.js`, and `node .runtime/vm_debug_ci/workspace/tests/test-stream-card-extension.js`.

Expected: all PASS and outbound job count unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/services/matrixSignalMatch.js src/services/matrixRegionalDraft.js src/routes/matrix.js scripts/test-matrix-regional-draft.js .runtime/vm_debug_ci/workspace/extensions/stream-card.cjs
git commit -m "feat(matrix): prepare evidence-led regional drafts"
```

### Task 11: Final Read-Only Acceptance

**Files:**
- Create: `/home/admin/work/packaging-system/docs/matrix-regional-route-acceptance-2026-07-22.md`

**Interfaces:**
- Consumes: six dossier reports, website production verification, score reports and review-only draft IDs.
- Produces: signed acceptance matrix without copying message bodies, private contacts, prices or credentials.

- [ ] **Step 1: Build the acceptance matrix**

For each company record dossier status, route-set ID, public URLs, desktop/mobile result, strategy score, blockers, draft revision or `not_created`, and next action.

- [ ] **Step 2: Verify no side effects or sensitive leakage**

Confirm no outbound email/WhatsApp/contact-form job was created. Scan changed docs and user catalog for passwords, tokens, cookies, message IDs, customer message bodies and prices.

- [ ] **Step 3: Run final repository checks**

Run `git diff --check`, relevant management tests, website lint/build, regional browser checks, service health and production route checks.

Expected: all applicable checks PASS; blocked companies remain explicitly blocked rather than represented as complete.

- [ ] **Step 4: Commit the acceptance record**

```bash
git add docs/matrix-regional-route-acceptance-2026-07-22.md
git commit -m "docs(matrix): record regional route acceptance"
```

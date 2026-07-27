# Matrix Route Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one deterministic Vietnamese food-sauce route profile and complete the selected Dh Foods preparation workflow through an unapproved, unsent final package.

**Architecture:** Extract localized buyer-route metadata into a reusable profile registry, extend the shared bilingual ontology with the evidenced food concepts, and make the Matrix draft builder select either the existing liquid profile or the new food-sauce profile. Production evidence remains in protected databases; project code stores only reusable route and language rules.

**Tech Stack:** Node.js 22, Express, Better SQLite3, built-in `fetch`, deterministic Matrix scoring services, systemd production service.

## Global Constraints

- Selecting the named candidate authorizes research, routine tests, reusable content changes, deployment, canonical record creation, and draft creation without intermediate prompts.
- No customer-facing message may be sent before the final package is shown and the user explicitly chooses send.
- Reusable source must not contain prospect-specific names, recipients, pricing, MOQ, lead time, or unsupported performance promises.
- Candidate evidence retains official source URLs and timestamps in the protected candidate database.
- Customer identity, contacts, versions, approvals, delivery state, and follow-up tasks remain in the canonical management database.
- A draft requires strategy score at least `75`, bilingual quality score at least `80`, and zero hard failures.
- Use one idempotency key per selection, version creation, and final delivery action.
- Use neutral technical codenames for private capabilities and workflow identifiers.

---

### Task 1: Shared Food Concept Ontology

**Files:**
- Modify: `src/services/matrixStreamOntology.js`
- Modify: `src/services/matrixStreamGate.js`
- Test: `scripts/test-matrix-stream-gates.js`

**Interfaces:**
- Consumes: `extractOntologyFacts(text, language)` and `scoreDraft(input)`.
- Produces: canonical `product_category` facts for `sauce`, `chili_sauce`, `seasoning`, `seasoning_powder`, `soup_base`, and package facts for `sachet`, `spout_pouch`, and `roll_film`.

- [ ] **Step 1: Write the failing bilingual ontology test**

Add assertions that these texts produce the same canonical facts:

```js
assert.deepStrictEqual(
  extractBilingualFacts('sauces, chili sauces, seasonings, soup bases, sachets, spout pouches and roll film', 'en'),
  {
    bag_type: ['spout_pouch'],
    product_category: ['chili_sauce', 'sauce', 'seasoning', 'soup_base'],
    package_format: ['roll_film', 'sachet']
  }
);
assert.deepStrictEqual(
  extractBilingualFacts('酱料、辣椒酱、调味品、汤底、小袋、吸嘴袋和卷膜', 'cn'),
  {
    bag_type: ['spout_pouch'],
    product_category: ['chili_sauce', 'sauce', 'seasoning', 'soup_base'],
    package_format: ['roll_film', 'sachet']
  }
);
```

- [ ] **Step 2: Run the gate test and verify RED**

Run: `node scripts/test-matrix-stream-gates.js`  
Expected: FAIL because `chili_sauce` and one or more food/package concepts are absent or inconsistent.

- [ ] **Step 3: Add the minimal canonical mappings**

Add non-overlapping expressions:

```js
['chili_sauce', /\bchili\s+sauces?\b/i, /辣椒酱/u],
['sauce', /\bsauces?\b(?!\s)/i, /酱料/u]
```

Keep `seasoning_powder` before `seasoning`, and keep `spout_pouch` under `bag_type`.

- [ ] **Step 4: Run the gate test and verify GREEN**

Run: `node scripts/test-matrix-stream-gates.js`  
Expected: `matrix stream gate tests passed`.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/services/matrixStreamOntology.js src/services/matrixStreamGate.js scripts/test-matrix-stream-gates.js
git commit -m "feat(matrix): align food route ontology"
```

### Task 2: Reusable Localized Route Profiles

**Files:**
- Create: `src/services/matrixRouteProfiles.js`
- Create: `scripts/test-matrix-route-profiles.js`
- Modify: `src/routes/matrix.js`

**Interfaces:**
- Produces:

```js
profileFor({ countryCode, categories })
// => null | {
//   kind, language, categories, home, about, market, application, product,
//   courtesy, linkLabels
// }

verifyProfileRoutes(profile, { origin, fetchImpl, timeoutMs })
// => Promise<profile>
```

- Consumes: canonical country code and lower-case candidate categories.

- [ ] **Step 1: Write the failing profile selection tests**

```js
assert.strictEqual(profileFor({ countryCode: 'VN', categories: ['sauces', 'seasonings'] }).kind, 'food_sauce');
assert.strictEqual(profileFor({ countryCode: 'VN', categories: ['sauces'] }).application, '/vi/applications/sauce-packaging');
assert.strictEqual(profileFor({ countryCode: 'ID', categories: ['liquid detergent'] }).kind, 'liquid_care');
assert.strictEqual(profileFor({ countryCode: 'VN', categories: ['steel'] }), null);
```

Add a real verifier test using a local `fetchImpl` response whose HTML contains `lang="vi"` and the canonical application path. Add rejection cases for HTTP 404 and wrong language.

- [ ] **Step 2: Run the profile test and verify RED**

Run: `node scripts/test-matrix-route-profiles.js`  
Expected: FAIL because `matrixRouteProfiles.js` does not exist.

- [ ] **Step 3: Implement the minimal registry**

The Vietnam food profile must be:

```js
{
  kind: 'food_sauce',
  language: 'vi',
  home: '/vi',
  about: '/vi/about',
  market: '/vi/markets/vietnam',
  application: '/vi/applications/sauce-packaging',
  product: '/vi/products/spout-pouches',
  courtesy: 'Cảm ơn Quý công ty đã dành thời gian xem thư. Chúng tôi mong có cơ hội trao đổi cùng đội ngũ thu mua bao bì của Quý công ty.'
}
```

Move the existing Thailand and Indonesia liquid profiles into this module without changing their routes or courtesy text.

- [ ] **Step 4: Replace the inline liquid verifier**

In `src/routes/matrix.js`, import the new functions and replace `LIQUID_ROUTE_SETS` and `verifyLiquidRouteSet()` with:

```js
const routeProfile = profileFor({ countryCode, categories });
const localizedRoutes = routeProfile
  ? await verifyProfileRoutes(routeProfile, {
      origin: process.env.MATRIX_PUBLIC_SITE_ORIGIN || 'https://gdhspack.com'
    })
  : null;
```

- [ ] **Step 5: Run profile, API, and existing route tests**

Run:

```bash
node scripts/test-matrix-route-profiles.js
node scripts/test-matrix-api.js
node scripts/test-matrix-signal-match.js
```

Expected: all pass; the previous Indonesian liquid draft remains unchanged.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/services/matrixRouteProfiles.js scripts/test-matrix-route-profiles.js src/routes/matrix.js
git commit -m "feat(matrix): add localized route profiles"
```

### Task 3: Deterministic Food-Sauce Draft

**Files:**
- Modify: `src/routes/matrix.js`
- Modify: `scripts/test-matrix-api.js`

**Interfaces:**
- Consumes: `routeProfile.kind === 'food_sauce'`, current official evidence, strategy signal, and official recipient evidence.
- Produces: one immutable English/Chinese version with localized links and a Vietnamese courtesy closing.

- [ ] **Step 1: Add a failing Dh Foods-style API fixture**

Seed a Vietnam candidate with:

```js
categories: ['spices', 'seasonings', 'sauces', 'rice-based foods']
recipient: 'purchase@delta.test'
contact: 'https://delta.test/factory'
```

Seed at least three distinct official pages covering profile, product range, factory/packaging inspection, purchasing supplier evaluation, and purchasing contact. Add a strategy signal for printed sachets, spout pouches, or roll film as formats to assess.

Assert the created version:

```js
assert.match(version.body.subject, /sauce|seasoning/i);
assert.match(version.body.body_en, /packaging and label inspection/i);
assert.match(version.body.body_en, /supplier-evaluation process/i);
assert.match(version.body.body_en, /one current.*pack photo/i);
assert.match(version.body.body_en, /https:\/\/gdhspack\.com\/vi\/applications\/sauce-packaging/);
assert.match(version.body.body_en, /Cảm ơn Quý công ty/);
assert.doesNotMatch(version.body.body_en, /current pouch supplier|guarantee|final structure/i);
assert.strictEqual(JSON.parse(version.body.quality_json).passed, true);
```

- [ ] **Step 2: Run the API test and verify RED**

Run: `node scripts/test-matrix-api.js`  
Expected: candidate draft creation returns `invalid_review_request` because the food profile has no deterministic builder.

- [ ] **Step 3: Implement the minimal food builder**

Generate:

```text
Dear [Company] Purchasing Team,

We reviewed [Company]'s public sauce, seasoning and soup-base range, together with its published packaging-and-label inspection and purchasing supplier-evaluation process.

Huasheng Printing Co., Ltd. manufactures printed flexible packaging in China. For one representative product, we can assess sachets, spout pouches or roll film around filling method, seal compatibility, contamination control and repeat-print consistency.

Could you share one current product pack photo, dimensions, fill weight or volume, filling method and estimated quantity, or forward this message to the packaging purchasing colleague responsible?
```

Append the Vietnamese application link, Vietnamese about link, courtesy closing, and signature. Generate a fact-aligned Chinese translation with exactly one question.

- [ ] **Step 4: Verify strategy and quality fail closed**

Add and run cases that remove the purchasing page, make the localized route unavailable, and introduce an unsupported “current pouch supplier” assertion. Each case must create zero versions and zero jobs.

- [ ] **Step 5: Run the full relevant regression**

Run:

```bash
node scripts/test-matrix-api.js
node scripts/test-matrix-route-profiles.js
node scripts/test-matrix-stream-gates.js
node scripts/test-cache-index-view.js
node scripts/test-matrix-signal-match.js
node --check src/routes/matrix.js
git diff --check
```

Expected: all pass.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/routes/matrix.js scripts/test-matrix-api.js
git commit -m "feat(matrix): generate evidence-bound food drafts"
```

### Task 4: Dh Foods Evidence, Deployment, and Final Package

**Files:**
- Modify operationally: `data/matrix-stream.db`
- Modify operationally: `data/app.db`
- Update after verification: `/home/admin/.codex/matrix-runtime/resources/matrix-console.md`

**Interfaces:**
- Consumes: candidate `1`, official Dh Foods URLs, candidate selection APIs, and the canonical Matrix draft API.
- Produces: one canonical customer/contact link, one score-passing draft version, and zero delivery jobs.

- [ ] **Step 1: Back up both authoritative databases**

Create permission-`0600` SQLite backups under `runtime-data-matrix-signal-private/backups/` before any operational write.

- [ ] **Step 2: Upsert current official evidence and strategy**

Record the checked URLs:

```text
https://www.dhfoods.com.vn/en
https://www.dhfoods.com.vn/en/gioi-thieu
https://www.dhfoods.com.vn/en/san-pham
https://www.dhfoods.com.vn/en/nha-may
```

Bind `purchase@dhfoods.com.vn` to the official factory/purchasing page. Store explicit unknowns for current pouch structure, incumbent supplier, fill conditions, and annual flexible-packaging volume.

- [ ] **Step 3: Verify the five production buyer routes**

Check HTTP 200, `lang="vi"`, canonical identity, visible headings/links, and no obvious mobile overflow for:

```text
/vi
/vi/about
/vi/markets/vietnam
/vi/applications/sauce-packaging
/vi/products/spout-pouches
```

If a P0/P1 content problem is found, repair the reusable website route, run its project validation, deploy under the selection contract, and repeat this step.

- [ ] **Step 4: Push and deploy the management changes**

Run all Task 3 tests, push `main`, restart `packaging-system.service`, and verify:

```bash
systemctl is-active packaging-system.service
systemctl show packaging-system.service -p NRestarts --no-pager
curl -sS -o /dev/null -w '%{http_code}\n' https://cahs.top/new/
```

Expected: `active`, `NRestarts=0`, HTTP `200`.

- [ ] **Step 5: Create the canonical selection and draft**

Use one session snapshot and one selection idempotency key for candidate `1`. Create one version with one creation idempotency key. Do not call approval or delivery endpoints.

- [ ] **Step 6: Verify the final package**

Read back recipient, source URL, subject, English body, Chinese body, quality JSON, content hash, attachment manifest, and final-preview blockers. Verify:

```text
quality_score = 100
quality.passed = true
hardFailures = []
status = draft
attachments = []
delivery job count = 0
```

- [ ] **Step 7: Reconcile the user-level catalog**

Record only generic capability evidence, commit hashes, test results, service health, and zero-send status. Scan the catalog for credentials, message identifiers, recipients, prospect names, and business records.

- [ ] **Step 8: Present the final customer-facing decision**

Show the exact recipient, subject, English body, Chinese translation, Vietnamese closing, links, and attachment state. Offer only:

```text
A（推荐）：发送这一最终版本
B：不发送，保留草稿
C：修改后再看
```

# Foreign Trade Costing Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an internal pre-costing assistant inside the existing cost module so CRM/订单输入 can be AI-parsed, mapped to current cost fields, recalculated by the existing `quoteEngine.js`, and reviewed by Chen Yongjie before any customer-facing quote exists.

**Architecture:** Use a four-stage pipeline: `AI/provider parser -> material alias normalization -> quote input normalization -> existing quoteEngine.js recalculation -> Chen Yongjie review record`. The assistant is only an internal pre-quote workspace; it reuses the current cost module field vocabulary and never replaces the current pricing engine.

**Tech Stack:** Express, SQLite (`better-sqlite3`), React, existing `Cost.tsx`, existing `mockService.ts`, existing `quoteEngine.js`, existing auth middleware.

---

## Context and Constraints

- Keep the current costing formulas untouched.
- Keep the current `quoteEngine.js` as the only calculation source.
- Keep all generated outputs labeled as `internal_pre_quote` until manual review is saved.
- Do not auto-send customer quotes.
- Do not infer a better unit system by rewriting formulas.
- Use the actual `Cost.tsx` labels as the source of truth for the assistant UI.

### Cost.tsx field labels to reuse

- `jgf` = `每平方加工费`
- `zxyf` = `运费`
- `yf` = `运费(自动包)`
- `fqfy` = `分切费用`
- `lldj` = `拉链单价`
- `ba_zdf` = `拉链总费用`
- `sh` = `损耗`
- `lr` = `利润`
- `thick` = `厚度(C)`
- `price` = `单价(元/kg)`
- `proportion` = `比重`
- `ba_chang` = `高/长` or `高/长（米）` in `material_weight`
- `ba_kuang` = `宽` or `宽（米）` in `material_weight`
- `ba_di` = `底`
- `ba_ce` = `侧边`

---

## Task 1: Lock the data model for drafts, reviews, and material aliases

**Files:**
- Modify: `src/db.js`
- Test: `scripts/smoke-test.js`

- [ ] **Step 1: Add append-only tables to `initDb()`**

Add `CREATE TABLE IF NOT EXISTS` statements in `src/db.js` for:

```sql
CREATE TABLE IF NOT EXISTS material_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_name TEXT NOT NULL,
  normalized_material TEXT NOT NULL,
  display_name_cn TEXT,
  density REAL,
  price REAL,
  price_unit TEXT,
  confidence TEXT NOT NULL DEFAULT 'medium',
  needs_confirm INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(raw_name)
);

CREATE TABLE IF NOT EXISTS foreign_costing_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  crm_inquiry_id INTEGER,
  customer_id INTEGER,
  customer_name TEXT,
  source_text TEXT,
  parsed_spec_json TEXT,
  material_mapping_json TEXT,
  quote_input_json TEXT,
  quote_result_json TEXT,
  calculation_table_json TEXT,
  ai_provider TEXT,
  ai_model TEXT,
  status TEXT NOT NULL DEFAULT 'internal_pre_quote',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS foreign_costing_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER NOT NULL,
  reviewer TEXT,
  reviewed_input_json TEXT,
  reviewed_result_json TEXT,
  approved_unit_price REAL,
  approved_total_price REAL,
  father_note TEXT,
  father_correction_note TEXT,
  changed_fields_json TEXT,
  status TEXT NOT NULL DEFAULT 'reviewed',
  created_at TEXT NOT NULL
);
```

Create indexes only if they are needed for `draft_id`, `crm_inquiry_id`, or `customer_id` lookups in the assistant route.

- [ ] **Step 2: Seed `material_aliases` with explicit rows**

Add a small seed routine inside `initDb()` that inserts missing rows only if the `raw_name` is not already present. Use the current material mapping list from the approved design:

```sql
INSERT OR IGNORE INTO material_aliases (...) VALUES (...);
```

Seed rows must cover:

- `LDPE`
- `LDPE Tr.`
- `LLDPE`
- `PE`
- `CPE`
- `CPP`
- `RCPP`
- `PET`
- `BOPP`
- `MOPP`
- `MBOPP`
- `VMPET`
- `MET PET`
- `VMCPP`
- `AL`
- `Aluminum foil`
- `ALOX`
- `Kraft`
- `Matt varnish`

- [ ] **Step 3: Extend smoke coverage for schema existence**

Update `scripts/smoke-test.js` so it asserts the assistant tables exist and can be queried in a readonly way. The smoke test must check for table names, not data counts.

Run:

```bash
node scripts/smoke-test.js
```

Expected:

- assistant tables exist
- no formula changes
- no customer-facing quote generation

---

## Task 2: Build the AI provider adapter and assistant service

**Files:**
- Create: `src/services/aiProvider.js`
- Create: `src/services/foreignCostingAssistant.js`
- Modify: `src/services/quoteEngine.js` only for import wiring if needed; do not edit formulas
- Test: `node` script or assistant route smoke tests

- [ ] **Step 1: Implement the provider adapter**

Create `src/services/aiProvider.js` with a single contract:

```js
async function runCostingParse({ provider, model, prompt, schema }) {
  // returns { ok, provider, model, rawText, json, fallbackUsed, error }
}
```

Provider selection rules:

- `COSTING_AI_PROVIDER=deepseek|openai|glm|mock`
- no API key or invalid JSON -> fallback to rule-based parser
- schema validation happens before the assistant consumes output

- [ ] **Step 2: Implement `parseInquiryText()`**

Create the assistant parser to output:

```json
{
  "customer_order_info": {},
  "customer_provided": {},
  "ai_inferred": {},
  "missing_fields": [],
  "risk_flags": [],
  "material_mapping_warnings": [],
  "suggested_cost_type": "",
  "confidence": "",
  "status": "internal_pre_quote"
}
```

The parser must separate:

- `customer_provided`
- `ai_inferred`
- `missing_fields`
- `risk_flags`

It must also preserve:

- total quantity
- variants
- quantity per variant
- trade term
- destination country
- size
- material layers
- accessories

- [ ] **Step 3: Implement `normalizeMaterialLayers()`**

This function should:

- read `material_aliases`
- normalize raw names to system names
- preserve `raw_name`, `normalized_material`, `confidence`, `price_used`, `proportion_used`
- put `Matt varnish` / `matte varnish` / `gloss varnish` into `surface_finish`
- emit a warning whenever `confidence !== 'high'`

Use explicit output shape:

```json
{
  "layers": [
    {
      "layer_order": 1,
      "raw_name": "transparent LDPE",
      "normalized_material": "PE",
      "display_name_cn": "透明PE",
      "confidence": "medium",
      "price_used": 0,
      "proportion_used": 0,
      "needs_confirm": true,
      "note": "material unit and density need confirmation"
    }
  ]
}
```

- [ ] **Step 4: Implement `normalizeToQuoteInput()`**

Map parsed specs into the current quote engine input shape without changing the engine:

- mm -> cm
- micron -> `C`
- `flat bottom pouch` / `3D pouch` -> `eight_side_seal`
- `stand up pouch` -> `stand_zipper_bag`
- `three side seal` / `sachet` -> `three_side_seal`
- `roll film` / `roll stock` -> `auto_bag`

Use exact examples like:

```js
// 165mm W × 245mm H × 40+40mm gusset
{
  cost_type: 'eight_side_seal',
  ba_kuang: 16.5,
  ba_chang: 24.5,
  ba_di: 4
}
```

- [ ] **Step 5: Implement `applyDefaultCostParams()`**

Apply internal defaults only as defaults, never as final truth:

- finished pouch `sh = 0.10`
- roll film `sh = 0.02`
- `stand_zipper_bag` `jgf = 0.65`
- `eight_side_seal` `jgf = 0.8` or `0.81` but flagged for review
- `zxyf`, `yf`, `fqfy`, `lldj`, `lr` are loaded from current historical habit or defaults and marked `system_default_need_review`

Also generate MOQ warnings using both:

- total quantity
- quantity per variant

Do not change price because of MOQ; only warn and flag for review.

- [ ] **Step 6: Implement `runPreCosting()`**

Call the existing engine only:

```js
const result = generateQuote(normalizedQuoteInput);
```

Do not calculate a second independent price path in the assistant.

- [ ] **Step 7: Implement `buildCalculationTable()` and `buildFatherReviewPanel()`**

Calculation table rows must include:

- `section`
- `label`
- `field_key`
- `formula`
- `input_value`
- `calculated_value`
- `note`
- `editable`

Review panel must include:

- template correctness
- size correctness
- material mapping correctness
- price / density correctness
- `jgf`
- `sh`
- `lr`
- `zxyf / yf / fqfy`
- `lldj / ba_zdf`
- plate / cylinder cost
- sample fee
- special process fees
- zipper / valve / spout / window / handle / tear notch
- whether usable as internal EXW pre-costing

---

## Task 3: Add the API layer and wire it into the server

**Files:**
- Create: `src/routes/foreignCostingAssistant.js`
- Modify: `src/server.js`
- Modify: `src/routes/crm.js` only if a shared helper is needed
- Test: `scripts/smoke-test.js`

- [ ] **Step 1: Add route registration**

Mount the route in `src/server.js` with the existing style used by `auth`, `orders`, `cost`, and `crm`.

```js
const foreignCostingAssistantRouter = require('./routes/foreignCostingAssistant');
app.use('/api/foreign-costing-assistant', foreignCostingAssistantRouter);
```

- [ ] **Step 2: Implement `POST /parse`**

Request:

```json
{ "text": "..." }
```

Response:

```json
{
  "customer_order_info": {},
  "customer_provided": {},
  "ai_inferred": {},
  "missing_fields": [],
  "risk_flags": [],
  "material_mapping_warnings": [],
  "suggested_cost_type": "eight_side_seal",
  "confidence": "medium"
}
```

- [ ] **Step 3: Implement `POST /draft`**

This endpoint must:

1. parse text
2. normalize materials
3. normalize quote input
4. run pre-costing with `quoteEngine.js`
5. build calculation table
6. build father review panel
7. save a row in `foreign_costing_drafts`

Response:

```json
{
  "customer_order_info": {},
  "parsed_spec": {},
  "quote_input": {},
  "quote_result": {},
  "calculation_table": [],
  "father_review_panel": {},
  "warnings": [],
  "status": "internal_pre_quote"
}
```

- [ ] **Step 4: Implement `POST /review`**

Request:

```json
{
  "draft_id": 1,
  "reviewed_input": {},
  "father_note": "",
  "father_correction_note": "",
  "approved_unit_price": 0,
  "approved_total_price": 0,
  "changed_fields": {}
}
```

Response:

```json
{
  "review_id": 1,
  "status": "reviewed"
}
```

- [ ] **Step 5: Add auth and safety checks**

Use the existing role/permission pattern so that:

- cost users can only access if already allowed in the current cost module
- CRM roles do not get broad order permissions
- no endpoint can send a customer quote

- [ ] **Step 6: Smoke-test the route**

Add route checks to `scripts/smoke-test.js`:

- parse endpoint returns JSON
- draft endpoint returns `internal_pre_quote`
- review endpoint persists a review record
- no endpoint returns `undefined`
- no endpoint returns `NaN`
- no endpoint returns `[object Object]`

---

## Task 4: Add the frontend assistant tab and reuse Cost.tsx field order

**Files:**
- Modify: `frontend-next/src/components/Cost.tsx`
- Create: `frontend-next/src/components/ForeignCostingAssistant.tsx`
- Modify: `frontend-next/src/lib/mockService.ts`
- Test: `frontend-next` build + browser smoke

- [ ] **Step 1: Add a new tab to the cost module**

Inside `Cost.tsx`, add a new tab or section called:

`外贸成本复核智能核价助手`

The assistant tab must sit beside the existing cost calculator, not replace it.

- [ ] **Step 2: Reuse the existing field order**

Reuse the current `Cost.tsx` field grouping and ordering so Chen Yongjie sees the same inputs he already knows.

Keep the label text exactly as `Cost.tsx` currently shows it:

- `jgf` -> `每平方加工费`
- `zxyf` -> `运费`
- `yf` -> `运费(自动包)`
- `fqfy` -> `分切费用`
- `lldj` -> `拉链单价`
- `ba_zdf` -> `拉链总费用`
- `sh` -> `损耗`
- `lr` -> `利润`
- `thick` -> `厚度(C)`
- `price` -> `单价(元/kg)`
- `proportion` -> `比重`

- [ ] **Step 3: Build the assistant component**

Create `frontend-next/src/components/ForeignCostingAssistant.tsx` with these panels:

1. Customer order info
2. AI interpretation
3. Costing form
4. Calculation table
5. Chen Yongjie review

The review panel must include:

- `father_note`
- `father_correction_note`
- approved unit price
- approved total price
- modified fields
- save review
- recalculate
- generate customer follow-up questions
- generate quotation draft

- [ ] **Step 4: Add API calls to `mockService.ts`**

Extend `frontend-next/src/lib/mockService.ts` with assistant methods:

```ts
parseForeignCosting(text: string): Promise<any>;
createForeignCostingDraft(payload: any): Promise<any>;
saveForeignCostingReview(payload: any): Promise<any>;
```

The first version can call the real API directly when available and fall back to local mocks in development.

- [ ] **Step 5: Show warnings clearly**

The UI must show yellow warnings when:

- material alias confidence is not high
- MOQ is low per variant
- `jgf`, `sh`, `lr`, `zxyf`, `yf`, `fqfy`, `lldj`, `ba_zdf` are system defaults
- a surface treatment was detected and excluded from material layers

The UI must never auto-promote the result to a customer quote.

---

## Task 5: Add Ferreno validation and regression coverage

**Files:**
- Create: `scripts/verify-foreign-costing-assistant.js`
- Modify: `scripts/smoke-test.js`
- Test: `npm run build`, `node scripts/smoke-test.js`

- [ ] **Step 1: Add the Ferreno sample**

Use this payload:

```text
Ferreno Chocolate Industry L.L.C, UAE.
Item No.1 flat bottom pouch / 3D pouch for chocolate hazelnut product.
Filling weight 500g.
Size 165mm W × 245mm H × 40+40mm gusset.
Material 12mic PET + 100mic transparent LDPE + matt varnish.
Zipper shown in artwork.
Artwork will be provided.
Quantity 25,000 pcs × 4 variants, total 100,000 pcs.
Incoterms EXW.
Destination UAE.
```

- [ ] **Step 2: Verify parser output**

Expected parsing:

- `suggested_cost_type = eight_side_seal`
- `ba_kuang = 16.5`
- `ba_chang = 24.5`
- `ba_di = 4`
- `PET thick = 1.2`
- `LDPE / PE thick = 10`
- `matt varnish` -> `surface_finish`
- `quantity_total = 100000`
- `quantity_per_variant = 25000`
- `variants = 4`
- `trade_term = EXW`
- `status = internal_pre_quote`

Expected warnings:

- final artwork not provided
- printing colors not confirmed
- gold effect not confirmed
- 4 variants may require 4 sets of cylinders
- zipper cost needs father confirmation
- `LDPE Tr. / transparent LDPE` mapping needs father confirmation
- `jgf / sh / lr` need father confirmation

- [ ] **Step 3: Verify route output shape**

Acceptance checks for the draft response:

- no `undefined`
- no `NaN`
- no `[object Object]`
- `father_note` exists
- `material_mapping_warnings` exists
- `calculation_table` exists
- `father_review_panel` exists
- `status === 'internal_pre_quote'`

- [ ] **Step 4: Run build and smoke**

Run:

```bash
cd frontend-next && npm run build
cd .. && node scripts/smoke-test.js
curl -s -X POST http://127.0.0.1:3333/api/foreign-costing-assistant/draft \
  -H "Content-Type: application/json" \
  -d '{"text":"Ferreno Chocolate Industry L.L.C UAE Item No.1 flat bottom pouch / 3D pouch for chocolate hazelnut product. Filling weight 500g. Size 165mm W x 245mm H x 40+40mm gusset. Material 12mic PET + 100mic transparent LDPE + matt varnish. Zipper shown in artwork. Quantity 25000 pcs x 4 variants total 100000 pcs. Incoterms EXW. Destination UAE."}' | jq .
```

Expected:

- build passes
- smoke passes
- draft API returns internal pre-quote JSON

---

## Rollback Plan

If the assistant creates friction or noise, rollback in this order:

1. Remove the `/api/foreign-costing-assistant` route mount from `src/server.js`
2. Hide the new tab from `Cost.tsx`
3. Leave `quoteEngine.js` untouched
4. Keep the database tables if already created; they are append-only and safe to leave in place

Do not roll back `quoteEngine.js`, `cost.js`, or any order/CRM logic.

---

## Coverage Check Before Implementation

This plan covers the following spec points:

- AI parse + rule fallback
- material alias mapping
- quoteEngine pre-costing
- internal draft persistence
- Chen Yongjie review persistence
- Cost.tsx label reuse
- Ferreno test case
- AI provider adapter
- build / smoke / curl verification

No task in this plan changes the costing formulas or creates a customer-facing quote path.

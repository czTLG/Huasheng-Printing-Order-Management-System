### Task 1: Deterministic Classification Core

**Files:**
- Create: `src/lib/schemaRank.js`
- Create: `scripts/test-schema-rank.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `classifyRecord(record, context) -> { classification, priority, reason_codes, confidence }`
- Produces: `isApprovedCountry(country) -> boolean`
- Produces: `APPROVED_COUNTRIES`, `EXCLUDED_COUNTRIES`, and `RULESET_VERSION`

- [ ] **Step 1: Write the failing classifier test**

```js
const assert = require('assert');
const { classifyRecord, isApprovedCountry } = require('../src/lib/schemaRank');

assert.equal(isApprovedCountry('Vietnam'), true);
assert.equal(isApprovedCountry('India'), false);
assert.equal(classifyRecord({ fixture_marker: 'token-verification' }, {}).classification, 'test');
assert.equal(classifyRecord({ source_kind: 'security_notice', country: 'Malaysia' }, {}).classification, 'noise');
assert.equal(classifyRecord({ country: 'Thailand', business_email: 'sales@example.co.th' }, {}).classification, 'needs_review');
const valid = classifyRecord({
  country: 'Indonesia',
  official_domain: 'brand.example',
  business_email: 'sales@brand.example',
  product_evidence: ['coffee'],
  last_interaction_at: '2026-07-01'
}, { now: '2026-07-16' });
assert.equal(valid.classification, 'valid');
assert(valid.reason_codes.includes('official_domain'));
console.log('schema-rank tests passed');
```

- [ ] **Step 2: Run the test and observe the missing-module failure**

Run: `node scripts/test-schema-rank.js`

Expected: FAIL with `Cannot find module '../src/lib/schemaRank'`.

- [ ] **Step 3: Implement the minimal pure classifier**

Implement fixed precedence `test -> noise -> needs_review -> valid`, approved/excluded country normalization, reason codes, and A/B/C priority. Treat missing identity, ambiguous contacts, unknown WhatsApp sender, malformed source time, and conflicting domains as `needs_review`. Do not use an LLM in this module.

- [ ] **Step 4: Add and run the package script**

Add:

```json
"test:matrix-rank": "node scripts/test-schema-rank.js"
```

Run: `npm run test:matrix-rank`

Expected: `schema-rank tests passed`.

- [ ] **Step 5: Commit the classifier**

```bash
git add src/lib/schemaRank.js scripts/test-schema-rank.js package.json
git commit -m "feat: add schema rank classifier"
```


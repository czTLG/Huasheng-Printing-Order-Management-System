### Task 2: Versioned Evidence and Run Storage

**Files:**
- Modify: `src/db.js`
- Create: `src/lib/signalCache.js`
- Create: `scripts/test-signal-cache.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `RULESET_VERSION` from `src/lib/schemaRank.js`
- Produces: `createRun(db, campaign)`, `upsertEntity(db, input)`, `appendEvidence(db, entityId, evidence)`, `saveClassification(db, entityId, result, runId)`, and `listCandidates(db, filters)`

- [ ] **Step 1: Write a failing temporary-database test**

The test must set `DB_PATH` before requiring `src/db`, call `initDb()`, and assert these behaviors:

```js
const first = upsertEntity(db, { official_domain: 'brand.example', display_name: 'Brand', country: 'Vietnam' });
const second = upsertEntity(db, { official_domain: 'https://www.brand.example/', display_name: 'Brand Co', country: 'Vietnam' });
assert.equal(first.id, second.id);
appendEvidence(db, first.id, { field: 'product', value: 'coffee', source_url: 'https://brand.example/products', retrieved_at: '2026-07-16T00:00:00Z', confidence: 'high' });
saveClassification(db, first.id, { classification: 'valid', priority: 'A', reason_codes: ['official_domain'] }, run.id);
assert.equal(listCandidates(db, { classification: 'valid' }).length, 1);
assert.equal(db.prepare('select count(*) n from customers').get().n, 0);
```

- [ ] **Step 2: Run and observe missing tables/functions**

Run: `node scripts/test-signal-cache.js`

Expected: FAIL because `signalCache` or its tables do not exist.

- [ ] **Step 3: Add append-only neutral tables**

Add `CREATE TABLE IF NOT EXISTS` definitions in `initDb()` for:

- `matrix_runs`: run ID, campaign JSON, ruleset version, status, counters, timestamps, actor.
- `matrix_entities`: normalized domain, display name, country, public contact JSON, status, timestamps.
- `matrix_evidence`: entity ID, field, value, source URL, page title, retrieval time, content fingerprint, confidence, extraction method.
- `matrix_classifications`: entity ID, run ID, class, priority, reason JSON, confidence, human override fields, timestamps.

Add unique indexes for normalized domain and `(entity_id, field, source_url, content_fingerprint)`.

- [ ] **Step 4: Implement storage functions with transactions**

Normalize domains by removing scheme, credentials, port, leading `www.`, path, query, fragment, and trailing dot. Reject blank source URLs and evidence without retrieval time. Store public contacts as JSON but never place raw page HTML in these tables.

- [ ] **Step 5: Run focused and smoke tests**

Run: `node scripts/test-signal-cache.js`

Expected: `signal-cache tests passed`.

Run: `npm run verify:smoke`

Expected: existing smoke suite passes.

- [ ] **Step 6: Commit storage**

```bash
git add src/db.js src/lib/signalCache.js scripts/test-signal-cache.js package.json
git commit -m "feat: add signal cache storage"
```


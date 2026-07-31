### Task 5: Read-Only Candidate API

**Files:**
- Create: `src/routes/matrix.js`
- Modify: `src/server.js`
- Create: `scripts/test-matrix-api.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `GET /api/matrix/runs`
- Produces: `GET /api/matrix/candidates?classification=&priority=&country=`
- Produces: `GET /api/matrix/candidates/:id`
- Consumes: `listCandidates(db, filters)`

- [ ] **Step 1: Write failing permission and redaction tests**

Assert unauthenticated and non-CRM roles receive 401/403; authorized CRM administrators receive paginated candidate summaries; list responses include evidence URLs and reason codes but omit raw page text, private CRM message bodies, unmasked contact values, internal rule text, and all secret/config fields.

- [ ] **Step 2: Run and observe missing routes**

Run: `node scripts/test-matrix-api.js`

Expected: FAIL with 404 for `/api/matrix/candidates`.

- [ ] **Step 3: Add the read-only router**

Follow the existing `fakeAuth` and CRM permission patterns. Validate enum filters, use parameterized SQL, cap page size at 100, default to 20, and record read audit events only for detail views. Do not add POST/PATCH/DELETE routes in phase one.

- [ ] **Step 4: Mount and verify the API**

Mount with `app.use('/api/matrix', matrixRouter)` after authentication middleware.

Run: `node scripts/test-matrix-api.js`

Expected: `matrix API tests passed`.

Run: `npm run verify:smoke`

Expected: existing smoke suite passes.

- [ ] **Step 5: Commit the API**

```bash
git add src/routes/matrix.js src/server.js scripts/test-matrix-api.js package.json
git commit -m "feat: expose read only matrix candidates"
```


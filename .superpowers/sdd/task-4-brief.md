### Task 4: Existing CRM Dry-Run Adapter

**Files:**
- Create: `src/lib/matrixCrmAdapter.js`
- Create: `scripts/matrix-classify-current.js`
- Create: `scripts/test-matrix-crm-adapter.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `readEligibleCrmRecords(db) -> normalized records`
- Produces: `classifyCurrentCrm(db, options) -> dry-run report`
- Consumes: `classifyRecord`

- [ ] **Step 1: Write a failing fixture test**

Seed a temporary database with one domestic legacy customer, the known token-verification pattern, one system email, one unknown WhatsApp sender, one valid overseas email conversation, and one valid overseas WhatsApp conversation. Assert respectively: excluded domestic, test, noise, needs-review, valid, valid.

- [ ] **Step 2: Run and observe missing adapter**

Run: `node scripts/test-matrix-crm-adapter.js`

Expected: FAIL because `matrixCrmAdapter` is missing.

- [ ] **Step 3: Implement read-only normalization**

Read `customers`, `crm_messages`, and `email_messages`; group by deterministic customer/contact identity; retain source record IDs rather than copied private bodies in the report; detect fixture markers, automated sender patterns, missing identities, malformed timestamps, and duplicated message segments. Do not update any database row.

- [ ] **Step 4: Implement the production dry-run CLI**

`scripts/matrix-classify-current.js` must default to read-only, print aggregate counts and internal IDs only, and require `--include-private-preview` plus an authenticated local operator context before showing contact details. It must write no files unless `--output <workspace-path>` is supplied.

- [ ] **Step 5: Verify fixture and production dry run**

Run: `node scripts/test-matrix-crm-adapter.js`

Expected: `matrix CRM adapter tests passed`.

Run: `node scripts/matrix-classify-current.js`

Expected: JSON summary containing excluded domestic, test, noise, needs-review, and valid counts; known token record is counted as test; exit code 0; database checksum unchanged.

- [ ] **Step 6: Commit the adapter**

```bash
git add src/lib/matrixCrmAdapter.js scripts/matrix-classify-current.js scripts/test-matrix-crm-adapter.js package.json
git commit -m "feat: add current matrix dry run"
```


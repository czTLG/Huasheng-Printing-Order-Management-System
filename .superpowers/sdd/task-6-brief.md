### Task 6: Phase 1 Verification and Dry-Run Report

**Files:**
- Create: `scripts/verify-matrix-phase1.js`
- Create: `docs/operations/matrix-phase1-runbook.md`
- Modify: `package.json`

**Interfaces:**
- Consumes all phase-one services and APIs.
- Produces `npm run verify:matrix-phase1` with a nonzero exit code on any safety regression.

- [ ] **Step 1: Write the verification script assertions**

The script must create a temporary database, run schema initialization, classification, guarded import, current-CRM adapter, and API tests; assert zero delivery adapters and zero writes to formal CRM tables; and verify the six-country/20-per-country/India exclusion limits.

- [ ] **Step 2: Run and observe failure before wiring the script**

Run: `node scripts/verify-matrix-phase1.js`

Expected: FAIL until all checks and package wiring exist.

- [ ] **Step 3: Add the package command and runbook**

Add:

```json
"verify:matrix-phase1": "node scripts/verify-matrix-phase1.js"
```

The runbook must document read-only dry run, evidence import JSON schema, output counters, review sampling, rollback (delete only the run-owned `matrix_*` rows), secret isolation, and confirmation that delivery is unavailable.

- [ ] **Step 4: Run final verification**

Run: `npm run verify:matrix-phase1`

Expected: all matrix phase-one checks pass.

Run: `npm run verify:smoke`

Expected: existing smoke checks pass.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 5: Commit verification**

```bash
git add scripts/verify-matrix-phase1.js docs/operations/matrix-phase1-runbook.md package.json
git commit -m "test: verify matrix stream phase one"
```

## Deferred Separate Plans

The approved design includes independent subsystems that must not be bundled into phase one:

1. `packet-lens`: private-rule product analysis, English/Chinese paired versions, and semantic-difference checks.
2. `stream-card`: Feishu candidate/review/final-confirmation cards and callback security.
3. `packet-gate`: single-use final approval, SMTP delivery, suppression, bounce handling, and receipts.
4. Reply loop: full mailbox history sync, reply matching, Chinese translation, suggested replies, and a second final-confirmation gate.

Each subsystem receives its own design-derived TDD plan after phase-one evidence quality is accepted.

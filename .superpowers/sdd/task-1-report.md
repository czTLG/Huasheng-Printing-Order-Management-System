# Task 1 Report: Deterministic Classification Core

## Status

DONE_WITH_CONCERNS

## Changed Files

- `src/lib/schemaRank.js`
- `scripts/test-schema-rank.js`
- `package.json`

The required report is stored separately at `.superpowers/sdd/task-1-report.md` and was not included in the implementation commit, which intentionally contains only the three files listed by the task brief.

## RED Evidence

Command:

```text
node scripts/test-schema-rank.js
```

Observed exit code: `1`

Observed failure:

```text
Error: Cannot find module '../src/lib/schemaRank'
code: 'MODULE_NOT_FOUND'
```

This was the expected missing-module failure before production implementation existed.

## Implementation Summary

- Added pure deterministic `classifyRecord(record, context)` with fixed precedence `test -> noise -> needs_review -> valid`.
- Added normalized approved/excluded country checks and exported `isApprovedCountry`, `APPROVED_COUNTRIES`, `EXCLUDED_COUNTRIES`, and `RULESET_VERSION`.
- Added deterministic reason codes, confidence values, and A/B/C priority.
- Routed missing identity, ambiguous contacts, unknown WhatsApp sender, malformed source time, and conflicting domains to `needs_review`.
- Added no LLM, network, outbound, or CRM integration.
- Added package script `test:matrix-rank` exactly as specified.

## GREEN Evidence

Primary command:

```text
npm run test:matrix-rank
```

Observed exit code: `0`

Output summary:

```text
> node scripts/test-schema-rank.js
schema-rank tests passed
```

Additional fresh verification:

- `node --check src/lib/schemaRank.js` — exit `0`.
- `git diff --check` — exit `0`.
- Read-only runtime assertions for precedence, country normalization, all five required review conditions, exact result keys, and A priority — exit `0`, output `schema-rank requirement checks passed`.

## Self-review

- Commit scope contains exactly the three implementation files required by the brief.
- Test file matches the prescribed assertions.
- Result object always contains `classification`, `priority`, `reason_codes`, and `confidence`.
- Classification rules are synchronous, side-effect free, and deterministic for the supplied inputs.

## Commit

`67548f9` (`feat: add schema rank classifier`)

## Concerns

- The brief names the exported country lists and A/B/C/confidence behavior but does not provide a complete canonical country roster or exact scoring table. The minimal implementation uses the countries evidenced by the prescribed fixtures (`Indonesia`, `Malaysia`, `Thailand`, `Vietnam`) as approved and `India` as excluded; priority/confidence values are deterministic but should be reconciled if a later authoritative policy supplies different exact values.
- Ambiguous-contact detection minimally covers the fixture domains `example.co.th` and `example.com`; no broader disposable/free-email domain catalog was provided.

---

## Review Remediation

### Status

DONE

### RED Evidence

Command:

```text
npm run test:matrix-rank
```

Observed exit code: `1`

Output summary: the expanded committed regression suite failed because the actual approved roster contained only Indonesia, Malaysia, Thailand, and Vietnam while the expected binding roster additionally contained Kazakhstan and Philippines. The assertion reported the complete actual/expected list difference.

### Remediation

- Expanded the approved roster to exactly Vietnam, Thailand, Malaysia, Indonesia, Philippines, and Kazakhstan; India remains the sole excluded country.
- Replaced permissive date parsing with calendar-component validation plus strict supported timestamp shape validation, so impossible dates such as `2026-02-30` route to `needs_review`.
- Normalized WhatsApp sender name and phone values before deciding whether sender identity is known; absent and whitespace-only identities now route to `needs_review`.
- Replaced two embedded example-domain literals with a named immutable ambiguous-contact domain policy plus the general deterministic `example` first-label rule.
- Committed regression coverage for all six approved countries, normalized India exclusion, classification collisions proving strict precedence, all five required review conditions, absent/blank WhatsApp identity, impossible dates, result shape, exported constants/version, A/B/C priorities, confidence values, and reason codes.

### GREEN Evidence

Command:

```text
npm run test:matrix-rank
```

Observed exit code: `0`

Output summary:

```text
> node scripts/test-schema-rank.js
schema-rank tests passed
```

Additional fresh verification:

- `node --check src/lib/schemaRank.js && node --check scripts/test-schema-rank.js` — exit `0`.
- `git diff --check` — exit `0`.
- Staged scope review showed only `scripts/test-schema-rank.js` and `src/lib/schemaRank.js` in the remediation commit.

### Remediation Commit

`ac8af11` (`fix: harden schema rank boundaries`)

### Remaining Concerns

None within the binding review remediation. The named public-email policy is intentionally finite and deterministic; future additions require an explicit policy update and regression case.

# Matrix Atlas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install a safe, provenance-preserving user-level public-organization discovery capability and make it discoverable across sessions.

**Architecture:** A neutral user-level skill delegates deterministic planning, normalization, deduplication, scoring, and validation to one Node.js command. Raw data remains in protected project storage; the user-level runtime catalog stores only paths and operating boundaries. The upstream Google Maps project is documented and retained as an optional adapter reference, while the initial tested path operates on bounded CSV/JSONL source output.

**Tech Stack:** Node.js 20+, ECMAScript modules, Node test runner, Markdown skill/runtime metadata.

## Global Constraints

- Capability codename is `matrix-atlas`; user-visible and filesystem names remain neutral.
- Preserve upstream repository, MIT license, version, commit, checksums, network behavior, and audit trail.
- Default concurrency is `1`, maximum queries per run is `20`, maximum results per run is `200`, and identical queries cache for 24 hours.
- Disable proxy rotation, email extraction, extra review retrieval, private-profile collection, personal-contact guessing, CAPTCHA/login bypass, and automatic outreach.
- No production database write, deployment, restart, email, WhatsApp message, or publication occurs in this plan.
- The runtime catalog stores paths and operating boundaries only, never business records or credentials.

---

### Task 1: Deterministic command and tests

**Files:**
- Create: `tools/matrix-atlas/matrix-atlas.mjs`
- Create: `tools/matrix-atlas/matrix-atlas.test.mjs`
- Create: `tools/matrix-atlas/fixtures/source.jsonl`

**Interfaces:**
- Consumes: JSONL candidate records and CLI arguments.
- Produces: `planQueries(input)`, `normalizeRecord(input, context)`, `dedupeRecords(records)`, `scoreRecord(record)`, `validateRecord(record)`, and CLI subcommands `plan`, `normalize`, `dedupe`, `score`, `verify`, `help`.

- [x] Write tests that assert query/result limits, local-language query planning, canonical normalization, provenance preservation, deterministic deduplication, evidence-bound scoring, and forbidden-field rejection.
- [x] Run `node --test tools/matrix-atlas/matrix-atlas.test.mjs` and confirm the tests fail because the implementation is absent.
- [x] Implement the smallest command satisfying the tested interfaces.
- [x] Run the focused test and confirm all cases pass.
- [x] Run `node --check tools/matrix-atlas/matrix-atlas.mjs`.
- [x] Commit the command, fixtures, and tests.

### Task 2: User-level skill package

**Files:**
- Stage: `/tmp/matrix-atlas-skill/SKILL.md`
- Stage: `/tmp/matrix-atlas-skill/agents/openai.yaml`
- Stage: `/tmp/matrix-atlas-skill/references/upstream.md`
- Stage: `/tmp/matrix-atlas-skill/references/schema.md`
- Stage: `/tmp/matrix-atlas-skill/scripts/matrix-atlas.mjs`
- Install: `/home/admin/.codex/skills/matrix-atlas/`
- Install: `/home/admin/.local/bin/matrix-atlas`

**Interfaces:**
- Consumes: tested project command from Task 1 and audited upstream metadata.
- Produces: a discoverable skill and a mode `0750` user-level command.

- [x] Create a failing package-validation check requiring valid frontmatter, neutral names, complete provenance, command presence, and no forbidden features.
- [x] Build the staged skill with concise trigger metadata and the approved operating sequence.
- [x] Record upstream repository, MIT license, skill version `1.12.1`, audited commit, file checksums, network behavior, adopted concepts, and excluded functions.
- [x] Generate neutral `agents/openai.yaml` metadata.
- [x] Run the official skill validator and package-validation check.
- [x] Install the verified package and wrapper with least-privilege permissions.
- [x] Run `/home/admin/.local/bin/matrix-atlas help` outside the project directory.

### Task 3: Runtime catalog reconciliation

**Files:**
- Create: `/home/admin/.codex/matrix-runtime/capabilities/matrix-atlas.md`
- Modify: `/home/admin/.codex/matrix-runtime/INDEX.md`

**Interfaces:**
- Consumes: verified skill and command paths from Task 2.
- Produces: exactly one `matrix-atlas` catalog entry with verified evidence and approval boundaries.

- [x] Stage the capability entry and index edit in `/tmp`.
- [x] Verify no existing `matrix-atlas` entry is present.
- [x] Add authoritative paths, status, limits, last-verified date, and approval boundaries without business records or secrets.
- [x] Install the reconciled catalog files.
- [x] Confirm the index contains exactly one entry and its link resolves.

### Task 4: End-to-end verification

**Files:**
- Create: `tools/matrix-atlas/fixtures/expected-normalized.jsonl`
- Modify: `docs/superpowers/plans/2026-07-28-matrix-atlas.md`

**Interfaces:**
- Consumes: installed command, skill, catalog, and public-source bounded query plan.
- Produces: reproducible verification evidence with no production side effects.

- [x] Run the offline fixture through `normalize`, `dedupe`, `score`, and `verify`; compare it byte-for-byte with the expected output.
- [x] Run a bounded public-source planning smoke test with concurrency `1`, at most two queries, and no email/review/proxy flags.
- [x] From `/tmp`, read only the runtime index, resolve `matrix-atlas`, and invoke its command help.
- [x] Scan the installed skill and catalog for credential assignments, tokens, cookies, SMTP Message-IDs, and actual business-record patterns.
- [x] Confirm no send, deployment, restart, or production write was invoked.
- [x] Re-run the complete unit suite and `git diff --check`.
- [x] Mark plan checkboxes complete and commit project-side tests, expected output, plan evidence, and any project documentation.


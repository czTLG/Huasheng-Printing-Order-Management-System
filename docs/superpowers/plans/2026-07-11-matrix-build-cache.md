# Matrix Build Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a personal neutral-codename skill that turns forwarded inquiries into validated inputs, performs deterministic bag-cost calculations, and teaches an apprentice through checked steps.

**Architecture:** Keep language interpretation in SKILL.md and all price arithmetic in a standalone Node.js JSON calculator. Bundle confirmed rules and workflow references inside the skill, block unresolved inputs, and emit separate internal/customer outputs with an audit trail.

**Tech Stack:** Codex skills, Node.js CommonJS, Node built-in test runner, JSON/Markdown references.

---

### Task 1: Initialize the personal skill

**Files:**
- Create: `/home/admin/.codex/skills/matrix-build-cache/SKILL.md`
- Create: `/home/admin/.codex/skills/matrix-build-cache/agents/openai.yaml`
- Create directories: `scripts`, `references`, `tests`

- [ ] Run the official `init_skill.py` with neutral interface labels.
- [ ] Verify the generated name and UI labels contain no protected business terms.

### Task 2: Add deterministic rule and validation tests

**Files:**
- Create: `/home/admin/.codex/skills/matrix-build-cache/tests/engine.test.js`

- [ ] Write tests for missing-field blocking, confirmed defaults, arithmetic, MOQ, plate fees, redaction, and training feedback.
- [ ] Run `node --test` and verify RED failures because the engine does not exist.

### Task 3: Implement the calculator

**Files:**
- Create: `/home/admin/.codex/skills/matrix-build-cache/scripts/engine.js`
- Create: `/home/admin/.codex/skills/matrix-build-cache/scripts/cli.js`
- Create: `/home/admin/.codex/skills/matrix-build-cache/references/rules.json`

- [ ] Implement strict schema validation with explicit blocking questions.
- [ ] Implement confirmed rule suggestions without filling unresolved values.
- [ ] Implement three supported bag formulas and detailed intermediate output.
- [ ] Implement MOQ and plate-fee helpers.
- [ ] Implement internal/customer redaction and deterministic training checks.
- [ ] Run `node --test` and verify all tests pass.

### Task 4: Write orchestration and teaching references

**Files:**
- Modify: `/home/admin/.codex/skills/matrix-build-cache/SKILL.md`
- Create: `/home/admin/.codex/skills/matrix-build-cache/references/intake.md`
- Create: `/home/admin/.codex/skills/matrix-build-cache/references/training.md`
- Create: `/home/admin/.codex/skills/matrix-build-cache/references/private-rules.md`

- [ ] Define direct-forward extraction, evidence, and customer/internal question separation.
- [ ] Define calculator invocation and the prohibition on model-generated numbers.
- [ ] Define apprentice checkpoints and feedback sequence.
- [ ] Copy confirmed rule provenance and explicitly list unresolved blockers.

### Task 5: Validate and smoke-test

**Files:**
- Test: `/home/admin/.codex/skills/matrix-build-cache/tests/engine.test.js`

- [ ] Run the full Node test suite.
- [ ] Run a sample ready case and verify detailed internal arithmetic.
- [ ] Run a missing-price case and verify no final price appears.
- [ ] Run `quick_validate.py` on the skill directory.
- [ ] Inspect skill names, UI labels, and outputs for protected business terms in names.

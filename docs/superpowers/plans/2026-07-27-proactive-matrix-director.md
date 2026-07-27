# Proactive Matrix Director Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every international-business response end with three agent-led, dynamically prioritized actions instead of generic user-led choices.

**Architecture:** Store the same behavioral contract in the admin user-level instructions and this project's instructions. Verify exact rule presence, removal of conflicting generic-choice wording, and project persistence through Git.

**Tech Stack:** Markdown instruction files, shell verification, Git.

## Global Constraints

- The recommended action is ranked by conversion impact, urgency, dependency, evidence readiness, effort, and risk.
- Choices are dynamic and grounded in the current pipeline stage.
- Safe authorized preparation should be completed before presenting choices.
- External communication, publication, production deployment, and irreversible actions retain explicit confirmation gates.

---

### Task 1: Update shared and project behavior

**Files:**
- Modify: `/home/admin/.codex/AGENTS.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: the `Next-Step Choices` instruction section.
- Produces: an identical `Proactive Matrix Direction` contract in both instruction scopes.

- [ ] **Step 1: Replace the existing next-step section in both files**

Add rules requiring stage detection, blocker and opportunity analysis, ranked dynamic choices, agent ownership of planning, safe preparatory execution, and preserved approval boundaries.

- [ ] **Step 2: Verify both instruction scopes**

Run:

```bash
rg -n "Proactive Matrix Direction|conversion impact|current pipeline|exactly three" \
  /home/admin/.codex/AGENTS.md AGENTS.md
```

Expected: both files contain the same behavior and neither contains a `Distillation Progress` heading.

- [ ] **Step 3: Check and commit**

Run:

```bash
git diff --check
git add AGENTS.md
git commit -m "docs: enable proactive matrix direction"
git push
```

Expected: project rule is committed and pushed; the user-level rule remains available to clean sessions.

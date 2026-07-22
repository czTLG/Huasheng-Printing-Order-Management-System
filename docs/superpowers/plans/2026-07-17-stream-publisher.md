# Stream Publisher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install the reviewed GitHub agent skill under the neutral local name `stream-publisher`, deploy the official self-hosted scheduler stack at zero software-license cost, and enforce draft-only agent output until a human approves publication.

**Architecture:** The Codex skill is installed from `gitroomhq/postiz-agent` with its upstream provenance preserved. The official `gitroomhq/postiz-docker-compose` repository is cloned into an isolated runtime directory and combined with a small local Compose override; the initial service binds only to loopback, disables public registration after the owner account is created, and exposes no social-platform credentials in the project repository. A local policy wrapper validates that automated create-post payloads use `type: draft`; promotion to scheduled or immediate publication remains a separate human-approved action.

**Tech Stack:** Codex skills, Postiz Agent CLI, Docker Compose 2.40+, Postiz, PostgreSQL, Redis, Temporal, Node.js validation scripts.

## Global Constraints

- Use the neutral local name `stream-publisher` for every new local folder, workflow, script, and user-visible label.
- Preserve the real upstream project name, URL, license, revision, dependencies, and network behavior in internal provenance records.
- Zero software subscription budget: use the AGPL-3.0 self-hosted stack, not Postiz Cloud.
- Automated agent output must be `draft`; publishing or scheduling requires explicit human approval.
- Do not bypass login, CAPTCHA, platform review, OAuth consent, API permissions, or account eligibility rules.
- Do not request or store social-account passwords; use official OAuth or platform-issued integration tokens.
- LinkedIn Page and Medium integration are deferred until their platform prerequisites exist.
- Do not modify or include unrelated dirty-worktree files.

---

### Task 1: Install and verify the agent skill

**Files:**
- Create outside repository: `/home/admin/.codex/skills/stream-publisher/`
- Verify: `/home/admin/.codex/skills/stream-publisher/SKILL.md`

**Interfaces:**
- Consumes: GitHub repository `gitroomhq/postiz-agent`, path `skills/postiz`
- Produces: Codex-discoverable skill directory named `stream-publisher`

- [ ] **Step 1: Install with the official skill installer**

Run:

```bash
python3 /home/admin/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py \
  --repo gitroomhq/postiz-agent \
  --path skills/postiz \
  --name stream-publisher
```

Expected: `Installed stream-publisher to /home/admin/.codex/skills/stream-publisher`.

- [ ] **Step 2: Verify the installed skill and upstream reference**

Run:

```bash
test -f /home/admin/.codex/skills/stream-publisher/SKILL.md
sed -n '1,40p' /home/admin/.codex/skills/stream-publisher/SKILL.md
```

Expected: the skill file describes the Postiz CLI and draft-capable post creation.

### Task 2: Prepare the isolated self-host runtime

**Files:**
- Create: `.runtime/stream-publisher/upstream/`
- Create: `.runtime/stream-publisher/compose.local.yaml`
- Create: `.runtime/stream-publisher/runtime.env`
- Create: `.runtime/stream-publisher/SOURCE.md`

**Interfaces:**
- Consumes: canonical Compose repository `https://github.com/gitroomhq/postiz-docker-compose`
- Produces: an isolated Compose project reachable initially at `http://127.0.0.1:4407`

- [ ] **Step 1: Clone the canonical Compose repository**

Run:

```bash
git clone https://github.com/gitroomhq/postiz-docker-compose .runtime/stream-publisher/upstream
```

Expected: `upstream/docker-compose.yaml` and `upstream/dynamicconfig/` exist.

- [ ] **Step 2: Record exact provenance**

Write `SOURCE.md` with the upstream URL, checked-out commit SHA, AGPL-3.0 license, retrieval date, image names, and documented outbound provider domains.

- [ ] **Step 3: Add the local security override**

Create `compose.local.yaml` that:

```yaml
services:
  postiz:
    environment:
      MAIN_URL: ${STREAM_PUBLIC_URL:-http://127.0.0.1:4407}
      FRONTEND_URL: ${STREAM_PUBLIC_URL:-http://127.0.0.1:4407}
      NEXT_PUBLIC_BACKEND_URL: ${STREAM_PUBLIC_URL:-http://127.0.0.1:4407}/api
      JWT_SECRET: ${STREAM_JWT_SECRET:?set STREAM_JWT_SECRET}
      DATABASE_URL: postgresql://postiz-user:${STREAM_DB_PASSWORD:?set STREAM_DB_PASSWORD}@postiz-postgres:5432/postiz-db-local
      DISABLE_REGISTRATION: ${STREAM_DISABLE_REGISTRATION:-false}
      OPENAI_API_KEY: ""
    ports: !override
      - "127.0.0.1:4407:5000"
  postiz-postgres:
    environment:
      POSTGRES_PASSWORD: ${STREAM_DB_PASSWORD:?set STREAM_DB_PASSWORD}
    ports: !reset []
  temporal:
    ports: !override
      - "127.0.0.1:7723:7233"
  temporal-ui:
    ports: !override
      - "127.0.0.1:8808:8080"
```

Expected: no service is bound to a public interface during bootstrap.

- [ ] **Step 4: Create restricted runtime secrets**

Create `runtime.env` with random 64-hex-character `STREAM_JWT_SECRET` and `STREAM_DB_PASSWORD`, `STREAM_DISABLE_REGISTRATION=false`, and `STREAM_PUBLIC_URL=http://127.0.0.1:4407`; set mode `0600`.

- [ ] **Step 5: Validate the merged Compose configuration**

Run:

```bash
docker compose --env-file ../runtime.env \
  -f docker-compose.yaml \
  -f ../compose.local.yaml config --quiet
```

Expected: exit code 0 with no unresolved required variables.

### Task 3: Deploy and verify the base service

**Files:**
- Runtime state: Docker volumes owned by the `stream-publisher` Compose project

**Interfaces:**
- Consumes: validated Compose configuration from Task 2
- Produces: healthy local Postiz, PostgreSQL, Redis, Temporal, Elasticsearch, and Temporal UI containers

- [ ] **Step 1: Confirm selected ports are unused**

Run:

```bash
ss -ltnp | grep -E ':(4407|7723|8808)\b'
```

Expected: no output.

- [ ] **Step 2: Pull and start the stack**

Run from `.runtime/stream-publisher/upstream`:

```bash
docker compose --project-name stream-publisher \
  --env-file ../runtime.env \
  -f docker-compose.yaml \
  -f ../compose.local.yaml up -d
```

Expected: all required containers start without exposing public ports.

- [ ] **Step 3: Wait for health and inspect logs**

Run:

```bash
docker compose --project-name stream-publisher \
  --env-file ../runtime.env \
  -f docker-compose.yaml \
  -f ../compose.local.yaml ps
```

Expected: Postiz and dependencies are running or healthy; logs contain no repeated fatal errors.

- [ ] **Step 4: Verify the local HTTP endpoint**

Run:

```bash
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4407
```

Expected: HTTP `200` or an application redirect below `400`.

### Task 4: Enforce draft-only agent operations

**Files:**
- Create: `scripts/stream-publisher-policy.mjs`
- Create: `scripts/stream-publisher-policy.test.mjs`
- Create: `.runtime/stream-publisher/APPROVAL.md`

**Interfaces:**
- Consumes: JSON post payload on stdin or a JSON file path
- Produces: validated JSON only when every create-post operation has top-level `type: "draft"`

- [ ] **Step 1: Write policy tests**

Tests must assert that `draft` passes and that `schedule`, `now`, missing `type`, malformed JSON, and mixed multi-platform payloads fail closed.

- [ ] **Step 2: Run tests and confirm the validator is absent**

Run:

```bash
node --test scripts/stream-publisher-policy.test.mjs
```

Expected: FAIL because the validator does not exist.

- [ ] **Step 3: Implement the minimal fail-closed validator**

Export `assertDraftPayload(payload)` and make the CLI print normalized JSON only after validation. Error messages must not echo tokens, cookies, headers, or complete payload content.

- [ ] **Step 4: Run policy tests**

Run:

```bash
node --test scripts/stream-publisher-policy.test.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Document the approval boundary**

`APPROVAL.md` must state that Codex may prepare drafts and media, but `posts:status ... --status schedule`, `type: now`, and any equivalent publish action require a new explicit user approval naming the draft(s) and destination platform(s).

### Task 5: Bootstrap owner access and platform authorization checklist

**Files:**
- Modify runtime only: `.runtime/stream-publisher/runtime.env`
- Create: `.runtime/stream-publisher/CHANNELS.md`

**Interfaces:**
- Consumes: healthy local service and the human-created owner account
- Produces: closed registration and a reviewed authorization checklist; no public post

- [ ] **Step 1: Hand owner-account creation to the user**

The user opens the local interface through an approved secure access path and creates the sole owner account. Codex does not request or handle the password.

- [ ] **Step 2: Close registration**

Set `STREAM_DISABLE_REGISTRATION=true`, recreate the Postiz container, and verify that new public registration is unavailable while the owner can still sign in.

- [ ] **Step 3: Prepare the platform checklist**

Record only official authorization prerequisites and status for Pinterest, YouTube, and any other currently eligible platform. Mark LinkedIn Page and Medium as deferred; never guess tokens or personal contact details.

- [ ] **Step 4: Create one non-publishing smoke draft**

After the user completes an official OAuth consent flow, create a platform-specific draft containing `https://gdhspack.com` and verify it remains in draft state. Do not schedule or publish it.

## Self-Review

- Spec coverage: neutral naming, zero-budget self-hosting, draft approval, official authorization, and deferred LinkedIn/Medium are each covered.
- Placeholder scan: no implementation placeholder or deferred code step remains; platform deferral is an explicit product constraint.
- Interface consistency: `runtime.env`, `compose.local.yaml`, project name, ports, and `assertDraftPayload(payload)` are consistent across tasks.

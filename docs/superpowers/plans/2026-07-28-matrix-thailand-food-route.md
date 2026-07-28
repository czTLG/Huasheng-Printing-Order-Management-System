# Matrix Thailand Food Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach the existing route gate to recognize the deployed Thai food and snack route without weakening any research or sending control.

**Architecture:** Extend the focused `matrixRouteProfiles` configuration and selector with one country/category profile. Exercise it through the existing route-profile regression suite, then verify the same public routes used by the reviewed Nithi intake.

**Tech Stack:** Node.js, CommonJS, built-in `assert`, existing Matrix route verifier.

## Global Constraints

- Use the exact five Thai URLs recorded in the approved design.
- Preserve liquid-care precedence.
- Do not change scoring, recipient, approval, duplicate, or delivery logic.
- Do not send while implementing or testing the route profile.

---

### Task 1: Add the Thai food route profile

**Files:**
- Modify: `scripts/test-matrix-route-profiles.js`
- Modify: `src/services/matrixRouteProfiles.js`

**Interfaces:**
- Consumes: `profileFor({ countryCode, categories })`
- Produces: a frozen profile with `kind: 'thailand_food'`, `language: 'th'`, and the five approved routes

- [ ] **Step 1: Write the failing selector tests**

Add assertions that Thai seasonings, snacks, and fried vegetables resolve to
`thailand_food`; Thai shampoo remains `liquid_care`; Malaysian seasonings remain
`malaysia_seasoning`; and a non-supported country does not receive the profile.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node scripts/test-matrix-route-profiles.js`

Expected: FAIL because Thai food categories currently return `null`.

- [ ] **Step 3: Add the minimal frozen profile and selector**

Add exact route values:

```js
{
  kind: 'thailand_food',
  language: 'th',
  expectedLanguage: 'th',
  home: '/th',
  about: '/th/about',
  market: '/th/markets/thailand',
  application: '/th/applications/snack-packaging',
  product: '/th/products/food-packaging-roll-film'
}
```

Select it after liquid-care matching and only for Thailand dry-food categories.

- [ ] **Step 4: Run focused and dependent tests**

Run:

```bash
node scripts/test-matrix-route-profiles.js
node scripts/test-matrix-api.js
node scripts/test-matrix-intake-candidate.js
```

Expected: all commands exit `0`.

- [ ] **Step 5: Commit the code and tests**

```bash
git add src/services/matrixRouteProfiles.js scripts/test-matrix-route-profiles.js
git commit -m "feat(matrix): add Thai food route profile"
```

### Task 2: Deploy, verify, and resume the approved draft

**Files:**
- No source files beyond Task 1

**Interfaces:**
- Consumes: the existing authenticated Matrix API and protected relay
- Produces: one immutable Nithi version, exact preview, and at most one delivery job

- [ ] **Step 1: Verify public production routes**

Request the five approved URLs and require HTTP `200`. Confirm the application
page is Thai and canonical.

- [ ] **Step 2: Restart the approved production service**

Run `sudo systemctl restart packaging-system.service`, require active state and
`NRestarts=0`.

- [ ] **Step 3: Create and inspect the immutable draft**

Use the existing reviewed candidate fingerprint and exact approved body. Require
score at least `75`, no blockers, no attachment, and zero prior Nithi delivery.

- [ ] **Step 4: Execute existing two-step approval and delivery**

Approve the exact content hash, fetch final preview, compare recipient, subject,
body, attachments, and content hash, then invoke send once using a new
idempotency key.

- [ ] **Step 5: Verify operational outcome**

Require one accepted relay job, no duplicate job, one reply-check task, active
service, and no restart loop. Report SMTP acceptance as transport acceptance,
not inbox placement or reading.


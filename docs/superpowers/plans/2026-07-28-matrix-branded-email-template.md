# Matrix Branded Email Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send newly approved messages as deterministic UTF-8 multipart email with a compact official-logo signature and an exact plain-text fallback.

**Architecture:** Add one pure renderer that owns canonical signature configuration, escaping, text/HTML generation, and render hashing. Feed that renderer into review hashing, canonical preview, and final delivery so the exact approved render is the exact sent render. Keep SMTP credentials, recipient policy, duplicate prevention, attachments, and explicit send approval unchanged.

**Tech Stack:** Node.js CommonJS, `node:crypto`, Nodemailer, SQLite/`better-sqlite3`, existing script-based Node assertions.

## Global Constraints

- Use only `https://gdhspack.com/media/brand/logo.png` as the remote image.
- Include no tracking pixels, redirects, scripts, forms, background images, web fonts, SVG, or automatic attachments.
- Preserve a complete UTF-8 plain-text fallback.
- Any customer-visible template or link change must change the canonical content hash.
- Preview and delivery must use the same deterministic renderer.
- Do not contact any real recipient during implementation or compatibility verification.
- Production deployment, service restart, and every real send remain explicitly gated.
- Do not modify the unrelated user change in `data/material_options.json`.

---

### Task 1: Deterministic Branded MIME Renderer

**Files:**
- Create: `src/services/matrixMailRender.js`
- Create: `scripts/test-matrix-mail-render.js`

**Interfaces:**
- Produces: `renderMatrixMail({ bodyEn, signature? }) -> { templateVersion, text, html, signature, renderHash }`
- Produces: `MATRIX_MAIL_SIGNATURE`, an immutable canonical signature configuration.
- Depends on: `node:crypto`; no database, network, or SMTP dependency.

- [ ] **Step 1: Write the failing renderer tests**

Cover exact text fallback, HTML escaping, paragraph and newline preservation, one official HTTPS logo, UTF-8 content, clickable official links, no active/tracking markup, and deterministic hash changes:

```js
const rendered = renderMatrixMail({ bodyEn: 'Hello <Buyer> & team.\n\nLine two\nLine three' });
assert.match(rendered.text, /Hello <Buyer> & team\./);
assert.match(rendered.html, /Hello &lt;Buyer&gt; &amp; team\./);
assert.strictEqual((rendered.html.match(/<img\b/g) || []).length, 1);
assert.match(rendered.html, /https:\/\/gdhspack\.com\/media\/brand\/logo\.png/);
assert.doesNotMatch(rendered.html, /<script|<form|tracking|utm_/i);
assert.notStrictEqual(
  rendered.renderHash,
  renderMatrixMail({ bodyEn: 'Changed body' }).renderHash
);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node scripts/test-matrix-mail-render.js`

Expected: FAIL because `src/services/matrixMailRender.js` does not exist.

- [ ] **Step 3: Implement the minimal pure renderer**

Implement:

```js
const MATRIX_MAIL_SIGNATURE = Object.freeze({
  templateVersion: 'matrix-brand-v1',
  name: 'Gavin',
  company: 'Huasheng Printing Co., Ltd.',
  website: 'https://gdhspack.com',
  email: 'sales@gdhspack.com',
  whatsapp: 'https://wa.me/8615850502651',
  logoUrl: 'https://gdhspack.com/media/brand/logo.png',
  logoAlt: 'Huasheng Printing Co., Ltd.'
});

function renderMatrixMail({ bodyEn, signature = MATRIX_MAIL_SIGNATURE } = {}) {
  // Validate the exact HTTPS host/path and all canonical fields.
  // Normalize CRLF, escape &, <, >, ", and ', preserve paragraphs/line breaks,
  // append compact inline-styled signature, and hash canonical visible fields.
}
```

Return frozen objects and reject empty body, non-HTTPS logo URLs, foreign logo hosts, unsafe link protocols, or incomplete signature data.

- [ ] **Step 4: Run the renderer test and verify GREEN**

Run: `node scripts/test-matrix-mail-render.js`

Expected: `matrix mail render tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/services/matrixMailRender.js scripts/test-matrix-mail-render.js
git commit -m "feat(matrix): add branded mail renderer"
```

---

### Task 2: Bind Rendered Output to Review Hash and Final Preview

**Files:**
- Modify: `src/services/matrixStreamReview.js`
- Modify: `src/services/matrixLedgerCommand.js`
- Modify: `scripts/test-matrix-ledger-command.js`
- Create: `scripts/test-matrix-mail-hash.js`

**Interfaces:**
- Consumes: `renderMatrixMail({ bodyEn })`.
- Changes: `contentHash(...)` includes the renderer's `templateVersion`, `text`, `html`, signature fields, and `renderHash`.
- Changes: `finalPreview(...)` adds `mail: { template_version, text, html, logo_url, render_hash }`.
- Preserves: existing `content_hash`, approval-event, and final-preview field meanings.

- [ ] **Step 1: Write failing hash and preview tests**

Assert that:

```js
const first = contentHash({ recipientEmail, recipientSourceUrl, subject, bodyEn, bodyCn });
const changed = contentHash({
  recipientEmail, recipientSourceUrl, subject, bodyEn, bodyCn,
  mailSignature: { ...MATRIX_MAIL_SIGNATURE, logoAlt: 'Changed' }
});
assert.notStrictEqual(first, changed);
assert.strictEqual(preview.mail.text, renderMatrixMail({ bodyEn }).text);
assert.strictEqual(preview.mail.html, renderMatrixMail({ bodyEn }).html);
assert.strictEqual(preview.mail.logo_url, MATRIX_MAIL_SIGNATURE.logoUrl);
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node scripts/test-matrix-mail-hash.js && node scripts/test-matrix-ledger-command.js`

Expected: FAIL because rendered mail is not included in the hash or preview.

- [ ] **Step 3: Implement hash and preview integration**

In `contentHash`, render the normalized English body and include a `mail` object in the hashed canonical JSON. Export no mutable configuration. In `finalPreview`, render once and return the frozen customer-facing mail projection alongside the existing fields.

- [ ] **Step 4: Run focused and existing review tests**

Run:

```bash
node scripts/test-matrix-mail-hash.js
node scripts/test-matrix-ledger-command.js
node scripts/test-matrix-stream-review.js
node scripts/test-matrix-stream-preview.js
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/services/matrixStreamReview.js src/services/matrixLedgerCommand.js scripts/test-matrix-mail-hash.js scripts/test-matrix-ledger-command.js
git commit -m "feat(matrix): bind branded render to approval"
```

---

### Task 3: Deliver the Exact Multipart Render

**Files:**
- Modify: `src/services/matrixStreamDelivery.js`
- Modify: `scripts/test-matrix-stream-delivery.js`
- Modify: `scripts/test-matrix-ledger-command.js`

**Interfaces:**
- Consumes: `renderMatrixMail({ bodyEn })`.
- Sends: Nodemailer options containing both `text` and `html`, with unchanged `from`, `replyTo`, `to`, `subject`, `messageId`, and version header.
- Preserves: delivery lease, idempotency, replay, duplicate, reply-task, and acceptance semantics.

- [ ] **Step 1: Write the failing delivery test**

Capture the fake transport call and assert:

```js
assert.strictEqual(sent.text, renderMatrixMail({ bodyEn: version.body_en }).text);
assert.strictEqual(sent.html, renderMatrixMail({ bodyEn: version.body_en }).html);
assert.match(sent.html, /<img[^>]+gdhspack\.com\/media\/brand\/logo\.png/);
assert.strictEqual(calls.send, 1);
```

Also assert replay still produces one send and a stale pre-template content hash is rejected.

- [ ] **Step 2: Run the test and verify RED**

Run: `node scripts/test-matrix-stream-delivery.js`

Expected: FAIL because delivery has no `html` and sends only the authored body as `text`.

- [ ] **Step 3: Implement exact multipart delivery**

Immediately after the fresh hash gate succeeds:

```js
const rendered = renderMatrixMail({ bodyEn: version.body_en });
response = await transport.sendMail({
  from, replyTo, to: version.recipient_email, subject: version.subject,
  text: rendered.text,
  html: rendered.html,
  messageId: job.message_id,
  headers: { 'X-Matrix-Stream-Version': String(version.id) }
});
```

Do not add attachments, tracking headers, or additional delivery paths.

- [ ] **Step 4: Run delivery and relay regression suites**

Run:

```bash
node scripts/test-matrix-stream-delivery.js
node scripts/test-matrix-relay-factory.js
node scripts/test-matrix-ledger-command.js
npm run test:matrix-ledger
```

Expected: all commands exit 0 and fake transports report exactly one invocation where expected.

- [ ] **Step 5: Commit**

```bash
git add src/services/matrixStreamDelivery.js scripts/test-matrix-stream-delivery.js scripts/test-matrix-ledger-command.js
git commit -m "feat(matrix): send multipart branded email"
```

---

### Task 4: Compatibility, Public Asset, and Catalog Verification

**Files:**
- Create: `scripts/verify-matrix-mail-template.js`
- Modify: `package.json`
- Modify after production verification: `/home/admin/.codex/matrix-runtime/capabilities/message-relay.md`

**Interfaces:**
- Produces: `npm run verify:matrix-mail-template`.
- Reads: generated HTML/MIME fields and the public logo URL.
- Must never invoke a real send.

- [ ] **Step 1: Write the failing compatibility verifier**

The verifier must reject missing UTF-8 text/HTML alternatives, unsafe tags/attributes, unsupported remote assets, missing dimensions/alt text, tracking parameters, body/signature divergence, or a non-image logo response. Its fake Nodemailer transport captures options and never performs network delivery.

- [ ] **Step 2: Run the verifier and verify RED**

Run: `node scripts/verify-matrix-mail-template.js --no-send`

Expected: FAIL until the verifier and package script are complete.

- [ ] **Step 3: Implement the verifier and package command**

Add:

```json
"verify:matrix-mail-template": "node scripts/verify-matrix-mail-template.js --no-send"
```

The verifier must print booleans/counts only, never message bodies, recipient addresses, provider identifiers, or configuration values.

- [ ] **Step 4: Run full local verification**

Run:

```bash
npm run lint
npm run test:matrix-ledger
npm run verify:matrix-mail-template
git diff --check
```

Expected: all exit 0, `send_invoked=false`, exactly one allowed remote image, and no secret/business-record output.

- [ ] **Step 5: Commit implementation**

```bash
git add scripts/verify-matrix-mail-template.js package.json
git commit -m "test(matrix): verify branded email compatibility"
```

- [ ] **Step 6: Request production deployment approval**

Do not deploy or restart without the user's explicit approval. After approval, deploy the committed source, restart `packaging-system.service`, check service health/restart count, run the no-send verifier against the production logo, and confirm the final-preview endpoint returns the branded projection without invoking send.

- [ ] **Step 7: Reconcile the user-level catalog**

After verified deployment, update only paths, status, date, and non-sensitive evidence in `/home/admin/.codex/matrix-runtime/capabilities/message-relay.md`. From `/tmp`, read `INDEX.md` and the entry to verify clean-session discovery. Scan the catalog change for credentials, tokens, cookies, message identifiers, and business records.

- [ ] **Step 8: Final verification**

Run:

```bash
git status --short
git log -5 --oneline
npm run verify:matrix-mail-template
systemctl is-active packaging-system.service
systemctl show packaging-system.service -p NRestarts --value
```

Expected: the only unrelated worktree change remains `data/material_options.json`; template verification exits 0; service is active; no restart loop is present.

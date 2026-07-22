# WhatsApp CRM Inbox Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn synced WhatsApp messages in `crm_messages` into a usable CRM inbox with message details, customer binding, and a confirmed inquiry creation flow through an inquiry draft page.

**Architecture:** Keep WhatsApp inbound messages in `crm_messages` as the single source of truth. Add a small workflow layer on top of that table with `workflow_status` for human handling state, keep `ai_status` for AI processing state, and create formal inquiries only from a draft page that pre-fills from a selected message and writes to `inquiries` only after confirmation. The inbox remains a read-first queue for browsing and opening details. `WHATSAPP_SYNC_TOKEN` is a browser-exposed debug token with strictly read-only CRM access plus the WhatsApp sync write endpoint; all CRM mutations use the normal logged-in JWT session.

**Tech Stack:** Express, better-sqlite3, React, TypeScript, existing CRM mockService, existing `frontend-next` routing, existing systemd service on port `8080`.

---

## File Map

- `src/db.js`
- `src/routes/crm.js`
- `frontend-next/src/lib/mockService.ts`
- `frontend-next/src/App.tsx`
- `frontend-next/src/components/crm/CrmMessages.tsx`
- `frontend-next/src/components/crm/CrmCustomerDetail.tsx`
- `frontend-next/src/components/crm/CrmModule.tsx`
- Create `frontend-next/src/components/crm/CrmMessageDetail.tsx`
- Create `frontend-next/src/components/crm/CrmInquiryDraft.tsx`
- `docs/foreign-trade-crm/whatsapp-crm-migration.sql`

---

### Task 1: Add workflow state to `crm_messages` and expose it through CRM APIs

**Files:**
- Modify: `src/db.js`
- Modify: `src/routes/crm.js`
- Modify: `docs/foreign-trade-crm/whatsapp-crm-migration.sql`

- [ ] **Step 1: Write the failing smoke check**

```bash
curl -s -H "Authorization: Bearer $WHATSAPP_SYNC_TOKEN" \
  "http://127.0.0.1:8080/api/crm/messages?source_type=whatsapp" \
  | jq '.rows[0] | {id, source_type, workflow_status, ai_status, customer_id, inquiry_id}'
```

Expected before code changes: `workflow_status` is missing or undefined in returned rows.

- [ ] **Step 2: Add the schema upgrade**

```js
// src/db.js
CREATE TABLE IF NOT EXISTS crm_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,
  source_message_id TEXT,
  thread_id TEXT,
  customer_id INTEGER,
  inquiry_id INTEGER,
  direction TEXT NOT NULL,
  sender_name TEXT,
  sender_contact TEXT,
  receiver_contact TEXT,
  message_text TEXT NOT NULL,
  attachments_json TEXT,
  raw_payload_json TEXT NOT NULL,
  received_at TEXT NOT NULL,
  ai_status TEXT NOT NULL DEFAULT 'pending',
  workflow_status TEXT NOT NULL DEFAULT 'pending',
  dedupe_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

- [ ] **Step 3: Add a runtime migration for existing databases**

```js
// src/db.js
if (!cols.includes('workflow_status')) db.exec("ALTER TABLE crm_messages ADD COLUMN workflow_status TEXT NOT NULL DEFAULT 'pending'");
```

- [ ] **Step 4: Update CRM endpoints to return and update `workflow_status`**

```js
// src/routes/crm.js
// GET /api/crm/messages and GET /api/crm/messages/:id must include workflow_status
// PATCH /api/crm/messages/:id must require normal CRM login JWT
// PATCH /api/crm/messages/:id will support:
// - customer_id binding
// - workflow_status changes: pending | archived | created_inquiry | no_action
// - inquiry_id backfill only when creating inquiry succeeds
```

- [ ] **Step 5: Verify the schema and API shape**

```bash
node --check src/db.js
node --check src/routes/crm.js
curl -s -H "Authorization: Bearer $WHATSAPP_SYNC_TOKEN" \
  "http://127.0.0.1:8080/api/crm/messages?source_type=whatsapp" \
  | jq '.rows[0] | {id, workflow_status, ai_status, customer_id, inquiry_id}'
```

Expected: JSON includes `workflow_status` and the endpoint remains read-only for GET requests.

---

### Task 2: Build the WhatsApp Messages Inbox and message detail page

**Files:**
- Modify: `frontend-next/src/lib/mockService.ts`
- Modify: `frontend-next/src/App.tsx`
- Modify: `frontend-next/src/components/crm/CrmMessages.tsx`
- Create: `frontend-next/src/components/crm/CrmMessageDetail.tsx`
- Modify: `frontend-next/src/components/crm/CrmModule.tsx`

- [ ] **Step 1: Write the failing UI check**

```tsx
// The inbox must render these fields from /api/crm/messages?source_type=whatsapp:
// customer name / phone, direction, message summary, received_at, ai_status, customer_id, inquiry_id
```

Run:

```bash
cd frontend-next
npm run lint
```

Expected before code changes: inbox/detail/navigation assertions fail because detail page and new columns are incomplete.

- [ ] **Step 2: Expand the inbox list**

```tsx
// frontend-next/src/components/crm/CrmMessages.tsx
// Add columns:
// - customer name / phone
// - direction
// - message summary
// - received_at
// - ai_status
// - customer_id
// - inquiry_id
// Keep source_type filter defaulted to whatsapp.
// Add row click or a dedicated detail action that opens /crm/messages/:id.
```

- [ ] **Step 3: Add a dedicated message detail page**

```tsx
// frontend-next/src/components/crm/CrmMessageDetail.tsx
// Display:
// - full message_text
// - raw_payload_json
// - attachments_json block with "暂无附件" when empty
// - current customer binding
// - workflow_status controls
// - actions: bind customer, create inquiry draft
```

- [ ] **Step 4: Wire CRM routing**

```tsx
// frontend-next/src/App.tsx
// Route /crm/messages and /crm/messages/:id into the CRM module
// Route /crm/inquiries/new to the inquiry draft page
```

- [ ] **Step 5: Verify inbox and detail navigation**

```bash
cd frontend-next
npm run lint
npm run build
```

Expected: the CRM UI compiles, the inbox tab still loads, and opening a message shows the detail page instead of a blank state.

---

### Task 3: Add customer binding and message workflow actions

**Files:**
- Modify: `frontend-next/src/lib/mockService.ts`
- Modify: `src/routes/crm.js`
- Modify: `frontend-next/src/components/crm/CrmMessageDetail.tsx`
- Modify: `frontend-next/src/components/crm/CrmMessages.tsx`

- [ ] **Step 1: Write the failing API smoke test**

```bash
curl -i -X PATCH http://127.0.0.1:8080/api/crm/messages/1 \
  -H "Authorization: Bearer $WHATSAPP_SYNC_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"customer_id":5865,"workflow_status":"pending"}'
```

Expected before code changes: `401` or `403` because the update endpoint must not accept the browser-exposed sync token.

- [ ] **Step 2: Add message update support in the backend**

```js
// src/routes/crm.js
// PATCH /api/crm/messages/:id
// Require normal CRM login JWT.
// Accept:
// - customer_id
// - inquiry_id
// - workflow_status
// Validate workflow_status only as:
// pending | archived | created_inquiry | no_action
// Keep ai_status separate and unchanged unless explicitly set by a future AI action.
```

- [ ] **Step 3: Add client helpers**

```ts
// frontend-next/src/lib/mockService.ts
// add updateCrmWhatsappMessage(id, payload)
// reuse getCrmWhatsappMessage(id)
// keep listCrmWhatsappMessages(params) unchanged except for new workflow_status field in returned rows
```

- [ ] **Step 4: Wire detail actions**

```tsx
// frontend-next/src/components/crm/CrmMessageDetail.tsx
// Add buttons:
// - 绑定客户
// - 待处理
// - 已归档
// - 已创建询盘
// - 无需处理
// Persist each change through PATCH /api/crm/messages/:id
```

- [ ] **Step 5: Verify the write path**

```bash
curl -i -X PATCH http://127.0.0.1:8080/api/crm/messages/1 \
  -H "Authorization: Bearer $WHATSAPP_SYNC_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"workflow_status":"archived"}'
```

Expected: `200 OK`, and the row returned by `GET /api/crm/messages/1` shows `workflow_status=archived`.

---

### Task 4: Build the inquiry draft page and confirmed create flow

**Files:**
- Modify: `frontend-next/src/lib/mockService.ts`
- Modify: `src/routes/crm.js`
- Create: `frontend-next/src/components/crm/CrmInquiryDraft.tsx`
- Modify: `frontend-next/src/App.tsx`
- Modify: `frontend-next/src/components/crm/CrmMessageDetail.tsx`

- [ ] **Step 1: Write the failing draft-page smoke check**

```bash
curl -s -H "Authorization: Bearer $WHATSAPP_SYNC_TOKEN" \
  "http://127.0.0.1:8080/api/crm/messages/1" \
  | jq '.message_text, .raw_payload_json'
```

Expected before code changes: there is no draft page yet to consume these fields.

- [ ] **Step 2: Add the draft-page data contract**

```ts
// frontend-next/src/components/crm/CrmInquiryDraft.tsx
// Prefill fields from message:
// customer_id
// source_message_id / message_id
// inquiry_title
// product_type
// bag_type
// material_structure
// size
// thickness
// quantity
// printing
// destination_country
// destination_port
// trade_term
// notes
// original_message_text
```

- [ ] **Step 3: Add the confirm-create backend contract**

```js
// src/routes/crm.js
// GET /api/crm/inquiries/new?from_message_id=123 opens the draft page through the frontend route.
// POST /api/crm/inquiries must accept the draft payload plus from_message_id and require normal CRM login JWT.
// After inserting into inquiries:
// - update crm_messages.inquiry_id = new inquiry id
// - update crm_messages.workflow_status = 'created_inquiry'
// Return the new inquiry id and the linked message id.
```

- [ ] **Step 4: Wire the navigation**

```tsx
// frontend-next/src/components/crm/CrmMessageDetail.tsx
// "创建询盘" navigates to /crm/inquiries/new?from_message_id=123
```

- [ ] **Step 5: Verify the end-to-end create flow**

```bash
curl -i -X POST http://127.0.0.1:8080/api/crm/inquiries \
  -H "Authorization: Bearer <CRM_LOGIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"from_message_id":1,"customer_id":5865,"inquiry_title":"WhatsApp test inquiry","product_type":"pouch","notes":"created from draft"}'
```

Expected: `200 OK`, the new inquiry exists, and `crm_messages.inquiry_id` plus `workflow_status='created_inquiry'` are updated.

---

### Task 5: Reuse customer timeline and close the first-stage verification loop

**Files:**
- Modify: `frontend-next/src/components/crm/CrmCustomerDetail.tsx`
- Modify: `frontend-next/src/lib/mockService.ts`
- Modify: `src/routes/crm.js`

- [ ] **Step 1: Extend the customer payload with WhatsApp items**

```js
// src/routes/crm.js
// Ensure customer detail responses include WhatsApp messages in timeline data.
// Prefer reusing the existing customer-centric query helpers and keep the timeline sorted by latest activity.
```

- [ ] **Step 2: Render WhatsApp messages in the timeline**

```tsx
// frontend-next/src/components/crm/CrmCustomerDetail.tsx
// Add a WhatsApp section or timeline item type for crm_messages rows.
// Display received_at, direction, summary, workflow_status, and linked inquiry_id.
```

- [ ] **Step 3: Verify no regression in existing CRM modules**

```bash
cd frontend-next
npm run lint
npm run build

curl -s -H "Authorization: Bearer $WHATSAPP_SYNC_TOKEN" \
  "http://127.0.0.1:8080/api/crm/messages?source_type=whatsapp" \
  | jq '.rows | length'
```

Expected: build passes, inbox still loads, customer detail still renders, and message rows remain accessible.

- [ ] **Step 4: Commit in small increments**

```bash
git add src/db.js src/routes/crm.js frontend-next/src/lib/mockService.ts frontend-next/src/components/crm/CrmMessages.tsx frontend-next/src/components/crm/CrmMessageDetail.tsx frontend-next/src/components/crm/CrmInquiryDraft.tsx frontend-next/src/components/crm/CrmCustomerDetail.tsx frontend-next/src/App.tsx docs/foreign-trade-crm/whatsapp-crm-migration.sql
git commit -m "feat: add WhatsApp CRM inbox workflow"
```

---

## Verification Checklist

- `GET /api/crm/messages?source_type=whatsapp` returns message JSON for the inbox.
- `GET /crm/messages/:id` opens a detail page with `message_text`, `raw_payload_json`, and an attachments placeholder.
- `PATCH /api/crm/messages/:id` updates `customer_id` and `workflow_status` using the logged-in CRM JWT.
- `GET /crm/inquiries/new?from_message_id=...` opens a draft page with prefilled fields.
- `POST /api/crm/inquiries` creates a formal inquiry only after user confirmation and only with the logged-in CRM JWT.
- The created inquiry updates `crm_messages.inquiry_id` and `crm_messages.workflow_status='created_inquiry'`.
- Existing CRM login and non-WhatsApp CRM modules continue to work.
- Customer timeline aggregation remains a follow-up task and is not required for the first-stage inbox workflow to ship.

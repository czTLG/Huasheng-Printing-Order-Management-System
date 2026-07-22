# WhatsApp CRM Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a token-protected WhatsApp Web sync endpoint that stores incoming browser-pushed messages into CRM, deduplicates them, auto-matches or creates customers, and exposes the messages in the CRM UI and customer timeline.

**Architecture:** Extend the existing Express + better-sqlite3 CRM stack with a dedicated `crm_messages` table and a single ingest endpoint. Keep WhatsApp ingestion separate from `communication_logs`, then surface the data through a new CRM messages view and a customer timeline aggregation so the UI remains readable while the storage model stays source-specific.

**Tech Stack:** Node.js, Express, better-sqlite3, React, TypeScript, Vite, SQLite.

---

### Task 1: Add WhatsApp CRM schema and upgrade path

**Files:**
- Modify: `src/db.js`
- Create: `docs/foreign-trade-crm/whatsapp-crm-migration.sql`

- [ ] **Step 1: Add the `crm_messages` table, unique dedupe index, and supporting customer indexes**

```sql
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
  dedupe_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_messages_dedupe_hash ON crm_messages(dedupe_hash);
CREATE INDEX IF NOT EXISTS idx_crm_messages_customer ON crm_messages(customer_id, received_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_crm_messages_inquiry ON crm_messages(inquiry_id, received_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_crm_messages_source ON crm_messages(source_type, direction, ai_status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_whatsapp_phone ON customers(whatsapp, phone);
```

- [ ] **Step 2: Verify `src/db.js` applies the same upgrade logic on startup**

```bash
node --check src/db.js
```

- [ ] **Step 3: Confirm the migration file matches the runtime schema**

```bash
sed -n '1,220p' docs/foreign-trade-crm/whatsapp-crm-migration.sql
```

### Task 2: Implement WhatsApp sync ingest API

**Files:**
- Modify: `src/routes/crm.js`

- [ ] **Step 1: Add token auth, payload validation, customer matching, dedupe, and insert logic**

```js
router.post('/whatsapp/sync', (req, res) => {
  // verify Bearer token against WHATSAPP_SYNC_TOKEN
  // validate customer/message/direction
  // normalize received_at and compute dedupe hash
  // match customer by phone, then fuzzy name, else create new customer
  // insert crm_messages only, never communication_logs
});
```

- [ ] **Step 2: Add a list endpoint for the message center**

```js
router.get('/messages', (req, res) => {
  // filters: source_type, customer, direction, ai_status, date range
});
```

- [ ] **Step 3: Extend customer detail payload with WhatsApp messages and timeline data**

```js
router.get('/customers/:id', (req, res) => {
  // include whatsappMessages and timeline items built from WhatsApp, Gmail, quotes, follow-up, freight
});
```

- [ ] **Step 4: Smoke-check the new API contract locally**

```bash
node --check src/routes/crm.js
```

### Task 3: Surface the message center in CRM UI

**Files:**
- Modify: `frontend-next/src/components/crm/CrmModule.tsx`
- Create: `frontend-next/src/components/crm/CrmMessages.tsx`
- Modify: `frontend-next/src/lib/mockService.ts`

- [ ] **Step 1: Add `messages` as a CRM tab and sync the browser path to `/crm/messages`**

```tsx
// CrmModule.tsx tab list includes "消息中心"
```

- [ ] **Step 2: Build the WhatsApp message list page with filters and customer drill-down**

```tsx
// CrmMessages.tsx shows the list, highlights fresh pending messages, and opens customer detail
```

- [ ] **Step 3: Add mockService wrappers for list and detail calls**

```ts
async listCrmWhatsappMessages(params) { ... }
async getCrmWhatsappMessage(id) { ... }
```

- [ ] **Step 4: Type-check the frontend**

```bash
cd frontend-next && npm run lint
```

### Task 4: Add WhatsApp messages to customer timeline

**Files:**
- Modify: `frontend-next/src/components/crm/CrmCustomerDetail.tsx`
- Modify: `frontend-next/src/lib/mockService.ts`

- [ ] **Step 1: Render a timeline section that merges WhatsApp, Gmail, quote, follow-up, and freight records**

```tsx
// Sort timeline items by timestamp descending and label each source clearly
```

- [ ] **Step 2: Keep the existing communication_logs section untouched**

```tsx
// No writes to communication_logs from WhatsApp sync
```

- [ ] **Step 3: Verify the customer detail view still loads and the timeline renders**

```bash
cd frontend-next && npm run lint
```

### Task 5: Enable direct browser access to the CRM message path

**Files:**
- Modify: `src/server.js`
- Modify: `frontend-next/src/App.tsx`
- Modify: `frontend-next/src/components/crm/CrmModule.tsx`

- [ ] **Step 1: Serve the SPA shell for `/crm` and `/crm/*` so `/crm/messages` opens in the browser**

```js
app.get(['/crm', '/crm/*'], (_, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
```

- [ ] **Step 2: Initialize the CRM tab from `window.location.pathname`**

```tsx
// If pathname starts with /crm/messages, start on the messages tab
```

- [ ] **Step 3: Update browser history when switching CRM tabs**

```tsx
// Keep the URL in sync without adding a full router dependency
```

### Task 6: Verify end-to-end behavior

**Files:**
- None

- [ ] **Step 1: Start the app and confirm the new API route exists**

```bash
curl -i http://127.0.0.1:3333/api/crm/messages
```

- [ ] **Step 2: POST a WhatsApp message with the correct token and confirm insert + duplicate suppression**

```bash
curl -s -X POST http://127.0.0.1:3333/api/crm/whatsapp/sync ...
```

- [ ] **Step 3: Open the CRM UI and confirm the message center and customer timeline render**

```text
Manual browser verification in the local app
```


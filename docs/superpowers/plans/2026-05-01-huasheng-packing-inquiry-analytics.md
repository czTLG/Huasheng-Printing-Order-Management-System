# Huasheng Packing Inquiry And Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add self-contained inquiry submission, visit analytics, and weekly reporting to the independent `3333` site in `/home/admin/work/huasheng-packing` using its own SQLite database and SMTP mail sending.

**Architecture:** Extend the existing `server.js` Express process in the independent site project to serve both static frontend assets and JSON APIs. Store inquiry and visit records in a project-local SQLite file, send inquiry and weekly report emails through `nodemailer`, and add frontend event/reporting hooks in the React app so all inquiry entry points and visit events are captured without using the `8080` backend.

**Tech Stack:** React 19, Vite, Express, SQLite via `better-sqlite3`, `nodemailer`, cron scheduling, TypeScript on frontend, ESM Node server

---

## File Structure

- Modify: `/home/admin/work/huasheng-packing/package.json`
- Modify: `/home/admin/work/huasheng-packing/server.js`
- Modify: `/home/admin/work/huasheng-packing/src/App.tsx`
- Modify: `/home/admin/work/huasheng-packing/src/constants.ts`
- Create: `/home/admin/work/huasheng-packing/lib/db.js`
- Create: `/home/admin/work/huasheng-packing/lib/mailer.js`
- Create: `/home/admin/work/huasheng-packing/lib/analytics.js`
- Create: `/home/admin/work/huasheng-packing/lib/reports.js`
- Create: `/home/admin/work/huasheng-packing/data/.gitkeep`
- Create: `/home/admin/work/huasheng-packing/uploads/.gitkeep`
- Create: `/home/admin/work/huasheng-packing/.env.example` additions if required

### Task 1: Add Backend Dependencies And Runtime Folders

**Files:**
- Modify: `/home/admin/work/huasheng-packing/package.json`
- Create: `/home/admin/work/huasheng-packing/data/.gitkeep`
- Create: `/home/admin/work/huasheng-packing/uploads/.gitkeep`

- [ ] **Step 1: Add the missing runtime dependencies**

Update `/home/admin/work/huasheng-packing/package.json` dependencies to include:

```json
{
  "dependencies": {
    "better-sqlite3": "^11.8.1",
    "dotenv": "^17.2.3",
    "express": "^4.21.2",
    "lucide-react": "^0.546.0",
    "motion": "^12.23.24",
    "node-cron": "^3.0.3",
    "nodemailer": "^6.10.1",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "vite": "^6.2.0"
  }
}
```

- [ ] **Step 2: Add runtime storage directories**

Create these placeholder files so the directories exist in the project:

```text
/home/admin/work/huasheng-packing/data/.gitkeep
/home/admin/work/huasheng-packing/uploads/.gitkeep
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: install completes and `node_modules` contains `better-sqlite3`, `node-cron`, and `nodemailer`

- [ ] **Step 4: Verify dependency declarations**

Run: `rg -n "better-sqlite3|node-cron|nodemailer" /home/admin/work/huasheng-packing/package.json`
Expected: all three package names are present

- [ ] **Step 5: Commit**

```bash
git add /home/admin/work/huasheng-packing/package.json /home/admin/work/huasheng-packing/package-lock.json /home/admin/work/huasheng-packing/data/.gitkeep /home/admin/work/huasheng-packing/uploads/.gitkeep
git commit -m "feat: add independent-site mail and analytics dependencies"
```

### Task 2: Create SQLite Bootstrap And Schema

**Files:**
- Create: `/home/admin/work/huasheng-packing/lib/db.js`

- [ ] **Step 1: Create the database bootstrap module**

Create `/home/admin/work/huasheng-packing/lib/db.js`:

```js
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const dataDir = path.join(projectRoot, 'data');
const dbPath = process.env.SITE_DB_PATH || path.join(dataDir, 'site.db');

fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(dbPath);

export function nowIso() {
  return new Date().toISOString();
}

export function initDb() {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS site_inquiries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      source_path TEXT,
      entry_point TEXT,
      name TEXT NOT NULL,
      company TEXT,
      country_region TEXT,
      email TEXT,
      phone_whatsapp TEXT,
      product_type TEXT,
      bag_size TEXT,
      material_structure TEXT,
      quantity TEXT,
      message TEXT,
      artwork_name TEXT,
      artwork_size INTEGER,
      client_ip TEXT,
      user_agent TEXT,
      referer TEXT,
      device_type TEXT,
      mail_to TEXT,
      mail_cc TEXT,
      mail_status TEXT,
      mail_error TEXT
    );

    CREATE TABLE IF NOT EXISTS site_visit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      visitor_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      path TEXT NOT NULL,
      title TEXT,
      referer TEXT,
      source_channel TEXT,
      client_ip TEXT,
      country TEXT,
      region TEXT,
      city TEXT,
      user_agent TEXT,
      device_type TEXT,
      is_unique_session INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS site_weekly_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      sent_at TEXT,
      mail_to TEXT,
      mail_cc TEXT,
      status TEXT,
      error TEXT,
      summary_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_site_inquiries_created_at ON site_inquiries(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_site_visit_events_created_at ON site_visit_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_site_visit_events_visitor_id ON site_visit_events(visitor_id, created_at DESC);
  `);
}
```

- [ ] **Step 2: Add a tiny schema smoke script inline via node**

Run:

```bash
node --input-type=module -e "import { initDb, db } from './lib/db.js'; initDb(); console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\").all())"
```

Expected: includes `site_inquiries`, `site_visit_events`, and `site_weekly_reports`

- [ ] **Step 3: Verify database file creation**

Run: `test -f /home/admin/work/huasheng-packing/data/site.db && echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add /home/admin/work/huasheng-packing/lib/db.js /home/admin/work/huasheng-packing/data/site.db
git commit -m "feat: add independent-site sqlite schema"
```

### Task 3: Add Mail Sending Utilities For Inquiry And Weekly Reports

**Files:**
- Create: `/home/admin/work/huasheng-packing/lib/mailer.js`
- Modify: `/home/admin/work/huasheng-packing/.env.example`

- [ ] **Step 1: Create the mailer module**

Create `/home/admin/work/huasheng-packing/lib/mailer.js`:

```js
import nodemailer from 'nodemailer';

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE = String(process.env.SMTP_SECURE || 'true').toLowerCase() !== 'false';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || '';

export function requireMailConfig() {
  if (!(SMTP_HOST && SMTP_USER && SMTP_PASS && SMTP_FROM)) {
    throw new Error('SMTP is not fully configured');
  }
}

export function createTransporter() {
  requireMailConfig();
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

export async function sendInquiryMail({ inquiry, html, text }) {
  const transporter = createTransporter();
  return transporter.sendMail({
    from: SMTP_FROM,
    to: 'sales@gdhspack.com',
    cc: '383651879@qq.com',
    replyTo: inquiry.email || undefined,
    subject: `New Website Inquiry - ${inquiry.name || 'Unknown'}`,
    html,
    text
  });
}

export async function sendWeeklyReportMail({ html, text }) {
  const transporter = createTransporter();
  return transporter.sendMail({
    from: SMTP_FROM,
    to: 'sales@gdhspack.com',
    cc: '3836518879@qq.com',
    subject: 'Huasheng Packing Weekly Website Report',
    html,
    text
  });
}
```

- [ ] **Step 2: Add SMTP env documentation**

Ensure `/home/admin/work/huasheng-packing/.env.example` contains:

```env
SMTP_HOST=
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
SITE_DB_PATH=
```

- [ ] **Step 3: Verify env keys are documented**

Run: `rg -n "SMTP_HOST|SMTP_PORT|SMTP_USER|SMTP_PASS|SMTP_FROM|SITE_DB_PATH" /home/admin/work/huasheng-packing/.env.example`
Expected: all keys are present

- [ ] **Step 4: Commit**

```bash
git add /home/admin/work/huasheng-packing/lib/mailer.js /home/admin/work/huasheng-packing/.env.example
git commit -m "feat: add independent-site smtp mailer utilities"
```

### Task 4: Add Analytics Helpers And Weekly Report Aggregation

**Files:**
- Create: `/home/admin/work/huasheng-packing/lib/analytics.js`
- Create: `/home/admin/work/huasheng-packing/lib/reports.js`

- [ ] **Step 1: Create analytics classification helpers**

Create `/home/admin/work/huasheng-packing/lib/analytics.js`:

```js
export function detectDeviceType(userAgent = '') {
  const ua = String(userAgent).toLowerCase();
  if (/ipad|tablet/.test(ua)) return 'tablet';
  if (/mobile|android|iphone/.test(ua)) return 'mobile';
  if (!ua) return 'unknown';
  return 'desktop';
}

export function detectSourceChannel({ referer = '', path = '' } = {}) {
  const ref = String(referer).toLowerCase();
  const route = String(path).toLowerCase();
  if (route.includes('utm_')) return 'campaign';
  if (!ref) return 'direct';
  if (ref.includes('google.') || ref.includes('bing.') || ref.includes('baidu.')) return 'search';
  if (ref.includes('facebook.') || ref.includes('instagram.') || ref.includes('linkedin.') || ref.includes('t.me')) return 'social';
  return 'referral';
}

export function extractClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || '';
}
```

- [ ] **Step 2: Create weekly report aggregation helpers**

Create `/home/admin/work/huasheng-packing/lib/reports.js`:

```js
import { db, nowIso } from './db.js';

export function getLastWeekWindow(referenceDate = new Date()) {
  const end = new Date(referenceDate);
  end.setHours(0, 0, 0, 0);
  const day = end.getDay();
  const diffToMonday = (day + 6) % 7;
  end.setDate(end.getDate() - diffToMonday);
  const start = new Date(end);
  start.setDate(start.getDate() - 7);
  return { start, end };
}

export function buildWeeklySummary(startIso, endIso) {
  const totalVisits = db.prepare('SELECT COUNT(*) c FROM site_visit_events WHERE created_at >= ? AND created_at < ?').get(startIso, endIso).c;
  const uniqueVisitors = db.prepare('SELECT COUNT(DISTINCT visitor_id) c FROM site_visit_events WHERE created_at >= ? AND created_at < ?').get(startIso, endIso).c;
  const inquiryCount = db.prepare('SELECT COUNT(*) c FROM site_inquiries WHERE created_at >= ? AND created_at < ?').get(startIso, endIso).c;
  const topPages = db.prepare('SELECT path, COUNT(*) c FROM site_visit_events WHERE created_at >= ? AND created_at < ? GROUP BY path ORDER BY c DESC LIMIT 10').all(startIso, endIso);
  const sourceChannels = db.prepare('SELECT source_channel, COUNT(*) c FROM site_visit_events WHERE created_at >= ? AND created_at < ? GROUP BY source_channel ORDER BY c DESC').all(startIso, endIso);
  const countries = db.prepare('SELECT country, region, COUNT(*) c FROM site_visit_events WHERE created_at >= ? AND created_at < ? GROUP BY country, region ORDER BY c DESC LIMIT 20').all(startIso, endIso);
  const devices = db.prepare('SELECT device_type, COUNT(*) c FROM site_visit_events WHERE created_at >= ? AND created_at < ? GROUP BY device_type ORDER BY c DESC').all(startIso, endIso);
  const ips = db.prepare('SELECT client_ip, COUNT(*) c FROM site_visit_events WHERE created_at >= ? AND created_at < ? GROUP BY client_ip ORDER BY c DESC LIMIT 50').all(startIso, endIso);
  const inquiries = db.prepare('SELECT created_at, name, company, email, country_region, product_type, quantity, message FROM site_inquiries WHERE created_at >= ? AND created_at < ? ORDER BY created_at DESC LIMIT 50').all(startIso, endIso);
  const dailyTrend = db.prepare("SELECT substr(created_at, 1, 10) day, COUNT(*) c FROM site_visit_events WHERE created_at >= ? AND created_at < ? GROUP BY substr(created_at, 1, 10) ORDER BY day").all(startIso, endIso);

  return {
    generatedAt: nowIso(),
    periodStart: startIso,
    periodEnd: endIso,
    totalVisits,
    uniqueVisitors,
    inquiryCount,
    sourceChannels,
    topPages,
    countries,
    devices,
    ips,
    inquiries,
    dailyTrend
  };
}
```

- [ ] **Step 3: Verify helper modules import cleanly**

Run:

```bash
node --input-type=module -e "import './lib/analytics.js'; import './lib/reports.js'; console.log('OK')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add /home/admin/work/huasheng-packing/lib/analytics.js /home/admin/work/huasheng-packing/lib/reports.js
git commit -m "feat: add independent-site analytics and weekly report helpers"
```

### Task 5: Extend The 3333 Express Server With APIs, Cron, And DB Init

**Files:**
- Modify: `/home/admin/work/huasheng-packing/server.js`

- [ ] **Step 1: Add imports and middleware foundations**

Update the top of `server.js` to include:

```js
import express from 'express';
import { createServer } from 'http';
import path from 'path';
import fs from 'fs';
import cron from 'node-cron';
import { fileURLToPath } from 'url';
import { initDb, db, nowIso } from './lib/db.js';
import { detectDeviceType, detectSourceChannel, extractClientIp } from './lib/analytics.js';
import { buildWeeklySummary, getLastWeekWindow } from './lib/reports.js';
import { sendInquiryMail, sendWeeklyReportMail } from './lib/mailer.js';
```

Then add:

```js
initDb();
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true }));
```

- [ ] **Step 2: Add the inquiry endpoint**

Insert a `POST /api/inquiries` handler with the essential behavior:

```js
app.post('/api/inquiries', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.name || !body.email || !body.message) {
      return res.status(400).json({ ok: false, error: 'name, email, and message are required' });
    }

    const inquiry = {
      created_at: nowIso(),
      source_path: String(body.sourcePath || ''),
      entry_point: String(body.entryPoint || ''),
      name: String(body.name || '').trim(),
      company: String(body.company || '').trim(),
      country_region: String(body.countryRegion || '').trim(),
      email: String(body.email || '').trim(),
      phone_whatsapp: String(body.phoneWhatsapp || '').trim(),
      product_type: String(body.productType || '').trim(),
      bag_size: String(body.bagSize || '').trim(),
      material_structure: String(body.materialStructure || '').trim(),
      quantity: String(body.quantity || '').trim(),
      message: String(body.message || '').trim(),
      artwork_name: String(body.artworkName || '').trim(),
      artwork_size: Number(body.artworkSize || 0),
      client_ip: extractClientIp(req),
      user_agent: String(req.headers['user-agent'] || ''),
      referer: String(req.headers['referer'] || ''),
      device_type: detectDeviceType(req.headers['user-agent'] || ''),
      mail_to: 'sales@gdhspack.com',
      mail_cc: '383651879@qq.com',
      mail_status: 'pending',
      mail_error: ''
    };

    const result = db.prepare(`
      INSERT INTO site_inquiries (
        created_at, source_path, entry_point, name, company, country_region, email,
        phone_whatsapp, product_type, bag_size, material_structure, quantity, message,
        artwork_name, artwork_size, client_ip, user_agent, referer, device_type,
        mail_to, mail_cc, mail_status, mail_error
      ) VALUES (
        @created_at, @source_path, @entry_point, @name, @company, @country_region, @email,
        @phone_whatsapp, @product_type, @bag_size, @material_structure, @quantity, @message,
        @artwork_name, @artwork_size, @client_ip, @user_agent, @referer, @device_type,
        @mail_to, @mail_cc, @mail_status, @mail_error
      )
    `).run(inquiry);

    const html = `<h1>New Inquiry</h1><p><b>Name:</b> ${inquiry.name}</p><p><b>Email:</b> ${inquiry.email}</p><p><b>Message:</b> ${inquiry.message}</p>`;
    const text = `New Inquiry\nName: ${inquiry.name}\nEmail: ${inquiry.email}\nMessage: ${inquiry.message}`;

    try {
      await sendInquiryMail({ inquiry, html, text });
      db.prepare('UPDATE site_inquiries SET mail_status = ?, mail_error = ? WHERE id = ?').run('sent', '', result.lastInsertRowid);
    } catch (mailErr) {
      db.prepare('UPDATE site_inquiries SET mail_status = ?, mail_error = ? WHERE id = ?').run('failed', String(mailErr?.message || mailErr), result.lastInsertRowid);
      throw mailErr;
    }

    res.json({ ok: true, inquiryId: result.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err?.message || err) });
  }
});
```

- [ ] **Step 3: Add the visit tracking and weekly report endpoints**

Add:

```js
app.post('/api/track/visit', (req, res) => {
  const body = req.body || {};
  const row = {
    created_at: nowIso(),
    visitor_id: String(body.visitorId || '').trim(),
    session_id: String(body.sessionId || '').trim(),
    path: String(body.path || '').trim(),
    title: String(body.title || '').trim(),
    referer: String(body.referer || req.headers['referer'] || '').trim(),
    source_channel: detectSourceChannel({ referer: body.referer || req.headers['referer'] || '', path: body.path || '' }),
    client_ip: extractClientIp(req),
    country: '',
    region: '',
    city: '',
    user_agent: String(req.headers['user-agent'] || ''),
    device_type: detectDeviceType(req.headers['user-agent'] || ''),
    is_unique_session: body.isUniqueSession ? 1 : 0
  };

  if (!row.visitor_id || !row.session_id || !row.path) {
    return res.status(400).json({ ok: false, error: 'visitorId, sessionId, and path are required' });
  }

  db.prepare(`
    INSERT INTO site_visit_events (
      created_at, visitor_id, session_id, path, title, referer, source_channel, client_ip,
      country, region, city, user_agent, device_type, is_unique_session
    ) VALUES (
      @created_at, @visitor_id, @session_id, @path, @title, @referer, @source_channel, @client_ip,
      @country, @region, @city, @user_agent, @device_type, @is_unique_session
    )
  `).run(row);

  res.json({ ok: true });
});

app.get('/api/admin/report/weekly-preview', (req, res) => {
  const { start, end } = getLastWeekWindow(new Date());
  res.json({ ok: true, report: buildWeeklySummary(start.toISOString(), end.toISOString()) });
});

app.post('/api/admin/report/send-weekly', async (req, res) => {
  try {
    const { start, end } = getLastWeekWindow(new Date());
    const report = buildWeeklySummary(start.toISOString(), end.toISOString());
    const html = `<h1>Weekly Website Report</h1><p>Total visits: ${report.totalVisits}</p><p>Unique visitors: ${report.uniqueVisitors}</p><p>Inquiry count: ${report.inquiryCount}</p>`;
    const text = `Weekly Website Report\nTotal visits: ${report.totalVisits}\nUnique visitors: ${report.uniqueVisitors}\nInquiry count: ${report.inquiryCount}`;
    await sendWeeklyReportMail({ html, text });
    db.prepare('INSERT INTO site_weekly_reports (period_start, period_end, sent_at, mail_to, mail_cc, status, error, summary_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      start.toISOString(),
      end.toISOString(),
      nowIso(),
      'sales@gdhspack.com',
      '3836518879@qq.com',
      'sent',
      '',
      JSON.stringify(report)
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err?.message || err) });
  }
});
```

- [ ] **Step 4: Add the weekly cron job and health endpoint**

Add:

```js
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'huasheng-packing-site' });
});

cron.schedule('0 9 * * 1', async () => {
  try {
    const { start, end } = getLastWeekWindow(new Date());
    const report = buildWeeklySummary(start.toISOString(), end.toISOString());
    const html = `<h1>Weekly Website Report</h1><p>Total visits: ${report.totalVisits}</p>`;
    const text = `Weekly Website Report\nTotal visits: ${report.totalVisits}`;
    await sendWeeklyReportMail({ html, text });
    db.prepare('INSERT INTO site_weekly_reports (period_start, period_end, sent_at, mail_to, mail_cc, status, error, summary_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      start.toISOString(),
      end.toISOString(),
      nowIso(),
      'sales@gdhspack.com',
      '3836518879@qq.com',
      'sent',
      '',
      JSON.stringify(report)
    );
  } catch (err) {
    console.warn('[weekly-report] failed', err?.message || err);
  }
}, { timezone: 'Asia/Shanghai' });
```

- [ ] **Step 5: Verify server syntax**

Run: `node --check /home/admin/work/huasheng-packing/server.js`
Expected: no syntax errors

- [ ] **Step 6: Commit**

```bash
git add /home/admin/work/huasheng-packing/server.js
git commit -m "feat: add independent-site inquiry and analytics apis"
```

### Task 6: Wire The React Frontend To Track Visits And Submit Inquiries

**Files:**
- Modify: `/home/admin/work/huasheng-packing/src/App.tsx`

- [ ] **Step 1: Add visit tracking helpers near the top-level app**

Add helper functions in `src/App.tsx`:

```tsx
const VISITOR_KEY = 'huasheng_visitor_id';
const SESSION_KEY = 'huasheng_session_id';

function getOrCreateId(key: string) {
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const next = `${key}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem(key, next);
  return next;
}

async function trackVisit(payload: Record<string, unknown>) {
  await fetch('/api/track/visit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}
```

- [ ] **Step 2: Track page load and route changes**

Inside the main `App` component, add:

```tsx
useEffect(() => {
  const visitorId = getOrCreateId(VISITOR_KEY);
  const sessionId = getOrCreateId(SESSION_KEY);
  trackVisit({
    visitorId,
    sessionId,
    path: currentRoute,
    title: document.title,
    referer: document.referrer,
    isUniqueSession: currentRoute === 'home'
  }).catch((err) => console.warn('[trackVisit]', err));
}, [currentRoute]);
```

- [ ] **Step 3: Add a reusable inquiry submit helper**

Add:

```tsx
async function submitInquiry(payload: Record<string, unknown>) {
  const response = await fetch('/api/inquiries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || 'Inquiry submit failed');
  }
  return data;
}
```

- [ ] **Step 4: Replace all formal inquiry entry points with real submit calls**

For each existing quote or contact submission path in `src/App.tsx`, route submission through:

```tsx
await submitInquiry({
  sourcePath: currentRoute,
  entryPoint: 'contact-form',
  name: form.name,
  company: form.company,
  countryRegion: form.countryRegion,
  email: form.email,
  phoneWhatsapp: form.phoneWhatsapp,
  productType: form.productType,
  bagSize: form.bagSize,
  materialStructure: form.materialStructure,
  quantity: form.quantity,
  message: form.message,
  artworkName: form.artworkName || '',
  artworkSize: form.artworkSize || 0
});
```

Any existing fake success alert must be replaced with a real success state only after the API call resolves.

- [ ] **Step 5: Verify frontend typecheck**

Run: `npm run lint`
Expected: TypeScript no-emit check passes

- [ ] **Step 6: Commit**

```bash
git add /home/admin/work/huasheng-packing/src/App.tsx
git commit -m "feat: wire independent-site inquiry and visit tracking"
```

### Task 7: Add Report Formatting And Improve Inquiry Email Content

**Files:**
- Modify: `/home/admin/work/huasheng-packing/lib/mailer.js`
- Modify: `/home/admin/work/huasheng-packing/lib/reports.js`
- Modify: `/home/admin/work/huasheng-packing/server.js`

- [ ] **Step 1: Replace placeholder inquiry email templates with structured content**

Update the inquiry mail creation logic so the HTML includes:

```html
<h1>New Website Inquiry</h1>
<table>
  <tr><td>Name</td><td>{{name}}</td></tr>
  <tr><td>Company</td><td>{{company}}</td></tr>
  <tr><td>Email</td><td>{{email}}</td></tr>
  <tr><td>Phone / WhatsApp</td><td>{{phone_whatsapp}}</td></tr>
  <tr><td>Country / Region</td><td>{{country_region}}</td></tr>
  <tr><td>Product Type</td><td>{{product_type}}</td></tr>
  <tr><td>Bag Size</td><td>{{bag_size}}</td></tr>
  <tr><td>Material / Structure</td><td>{{material_structure}}</td></tr>
  <tr><td>Quantity</td><td>{{quantity}}</td></tr>
  <tr><td>Source Page</td><td>{{source_path}}</td></tr>
  <tr><td>Entry Point</td><td>{{entry_point}}</td></tr>
  <tr><td>IP</td><td>{{client_ip}}</td></tr>
  <tr><td>Referer</td><td>{{referer}}</td></tr>
</table>
<p><b>Message</b></p>
<p>{{message}}</p>
```

- [ ] **Step 2: Add richer weekly report formatting**

Update weekly report rendering to summarize:

```js
const html = `
  <h1>Huasheng Packing Weekly Website Report</h1>
  <p><b>Total Visits:</b> ${report.totalVisits}</p>
  <p><b>Unique Visitors:</b> ${report.uniqueVisitors}</p>
  <p><b>Inquiry Count:</b> ${report.inquiryCount}</p>
  <h2>Top Pages</h2>
  <ul>${report.topPages.map((x) => `<li>${x.path}: ${x.c}</li>`).join('')}</ul>
  <h2>Source Channels</h2>
  <ul>${report.sourceChannels.map((x) => `<li>${x.source_channel}: ${x.c}</li>`).join('')}</ul>
  <h2>Device Types</h2>
  <ul>${report.devices.map((x) => `<li>${x.device_type}: ${x.c}</li>`).join('')}</ul>
  <h2>Inquiry Summary</h2>
  <ul>${report.inquiries.slice(0, 10).map((x) => `<li>${x.created_at} - ${x.name} - ${x.email} - ${x.product_type || '-'}</li>`).join('')}</ul>
`;
```

- [ ] **Step 3: Add summary persistence for manual weekly sends**

Ensure both cron and manual send paths write `summary_json` to `site_weekly_reports`.

- [ ] **Step 4: Verify report preview endpoint**

Run:

```bash
node --input-type=module -e "import { initDb } from './lib/db.js'; import { getLastWeekWindow, buildWeeklySummary } from './lib/reports.js'; initDb(); const { start, end } = getLastWeekWindow(new Date()); console.log(buildWeeklySummary(start.toISOString(), end.toISOString()))"
```

Expected: outputs a valid report object shape

- [ ] **Step 5: Commit**

```bash
git add /home/admin/work/huasheng-packing/lib/mailer.js /home/admin/work/huasheng-packing/lib/reports.js /home/admin/work/huasheng-packing/server.js
git commit -m "feat: format inquiry emails and weekly reports"
```

### Task 8: End-To-End Runtime Verification On The 3333 Site

**Files:**
- Modify only if fixes are required by verification

- [ ] **Step 1: Build the independent site**

Run: `npm run build`
Expected: Vite build succeeds

- [ ] **Step 2: Restart the 3333 site process**

Run:

```bash
pkill -f "^node server.js$" || true
nohup node server.js >/tmp/huasheng-packing-3333.log 2>&1 &
```

Expected: process restarts and port `3333` listens again

- [ ] **Step 3: Verify health endpoint**

Run: `curl -s http://127.0.0.1:3333/api/health`
Expected:

```json
{"ok":true,"service":"huasheng-packing-site"}
```

- [ ] **Step 4: Submit a real inquiry test request**

Run:

```bash
curl -s http://127.0.0.1:3333/api/inquiries \
  -H 'Content-Type: application/json' \
  -d '{
    "sourcePath":"contact",
    "entryPoint":"manual-test",
    "name":"Test Buyer",
    "company":"Test Company",
    "countryRegion":"Malaysia",
    "email":"buyer@example.com",
    "phoneWhatsapp":"+60 1234567",
    "productType":"Stand Up Pouches",
    "bagSize":"200mm x 300mm",
    "materialStructure":"PET/VMPET/PE",
    "quantity":"30000",
    "message":"Manual inquiry test"
  }'
```

Expected: JSON response with `ok: true`

- [ ] **Step 5: Verify inquiry row exists in SQLite**

Run:

```bash
node --input-type=module -e "import { db } from './lib/db.js'; console.log(db.prepare('SELECT id, name, email, mail_status FROM site_inquiries ORDER BY id DESC LIMIT 3').all())"
```

Expected: includes `Test Buyer`

- [ ] **Step 6: Verify visit tracking**

Run:

```bash
curl -s http://127.0.0.1:3333/api/track/visit \
  -H 'Content-Type: application/json' \
  -d '{
    "visitorId":"manual_visitor",
    "sessionId":"manual_session",
    "path":"home",
    "title":"Manual Tracking Test",
    "referer":"https://google.com",
    "isUniqueSession":true
  }'
```

Expected: JSON response with `ok: true`

- [ ] **Step 7: Verify visit row exists**

Run:

```bash
node --input-type=module -e "import { db } from './lib/db.js'; console.log(db.prepare('SELECT path, source_channel, device_type FROM site_visit_events ORDER BY id DESC LIMIT 3').all())"
```

Expected: includes `home`

- [ ] **Step 8: Verify manual weekly preview and send**

Run:

```bash
curl -s http://127.0.0.1:3333/api/admin/report/weekly-preview
curl -s -X POST http://127.0.0.1:3333/api/admin/report/send-weekly
```

Expected: preview returns a report object and send returns `ok: true`

- [ ] **Step 9: Verify main independent site still serves**

Run: `curl -I http://127.0.0.1:3333/`
Expected: `HTTP/1.1 200 OK`

- [ ] **Step 10: Commit final fixes if verification required code changes**

```bash
git add /home/admin/work/huasheng-packing
git commit -m "fix: finalize independent-site inquiry and analytics integration"
```

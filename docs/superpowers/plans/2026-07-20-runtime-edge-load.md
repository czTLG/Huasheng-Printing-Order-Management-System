# Runtime Edge Load Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `cahs.top` post-login loading latency by negotiating HTTP/2 and avoiding create-form metadata on the initial work-order list view.

**Architecture:** Preserve the existing Node/Nginx topology. Change only the WorkOrders component's request trigger and the two TLS listener directives, with source/config regression checks and one retained rollback copy for each deployed artifact.

**Tech Stack:** React 18, TypeScript, Vite 5, Node.js 22, Nginx 1.18, Playwright 1.61.

## Global Constraints

- Do not mutate business records or database schema.
- Do not change API response shapes, permissions, navigation, or form behavior.
- Validate Nginx configuration before reload and restore the previous file if production verification fails.
- Preserve one previous frontend output and one previous Nginx configuration until verification passes.
- Verify both desktop and mobile public UI surfaces.
- Do not perform unrelated redesign, dependency upgrades, CDN, or DNS changes.

---

### Task 1: Defer work-order form metadata

**Files:**
- Create: `scripts/test-work-order-meta-loading.js`
- Modify: `frontend-next/src/components/WorkOrders.tsx`

**Interfaces:**
- Consumes: existing `mockService.getWorkOrderMeta(): Promise<any>` and the `handleCreate` UI action.
- Produces: `loadMeta(): Promise<void>` guarded by `metaLoaded` and `metaRequestRef`, with create intent as the first automatic trigger.

- [ ] **Step 1: Write the failing source regression test**

```js
'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'frontend-next/src/components/WorkOrders.tsx'), 'utf8');

assert.doesNotMatch(source, /useEffect\(\(\) => \{\s*loadMeta\(\);\s*\}, \[\]\);/s,
  'list mount must not request create-form metadata');
assert.match(source, /const metaRequestRef = useRef<Promise<void> \| null>\(null\)/,
  'metadata loading must coalesce concurrent requests');
assert.match(source, /const handleCreate = \(\) => \{[\s\S]*?void loadMeta\(\);[\s\S]*?setView\('create'\)/,
  'create intent must trigger metadata loading without blocking the screen');
console.log('work-order metadata loading regression passed');
```

- [ ] **Step 2: Run the regression test and verify RED**

Run: `node scripts/test-work-order-meta-loading.js`

Expected: FAIL because the component still calls `loadMeta()` during initial mount and has no `metaRequestRef`.

- [ ] **Step 3: Implement the smallest deferred loader**

In `WorkOrders.tsx`, import `useRef`, remove the mount-time `loadMeta()` effect, add the request ref, and make `loadMeta` coalesce requests:

```tsx
import React, { useState, useEffect, useRef } from 'react';

const metaRequestRef = useRef<Promise<void> | null>(null);

const loadMeta = async (): Promise<void> => {
  if (metaLoaded) return;
  if (metaRequestRef.current) return metaRequestRef.current;
  const request = (async () => {
    try {
      const meta = await mockService.getWorkOrderMeta();
      const nextSalespersons = Array.isArray(meta?.salespersons) && meta.salespersons.length
        ? meta.salespersons
        : [{ id: 0, name: currentUser.username || '' }];
      setSalespersons(nextSalespersons);
      const nextMaterials = Array.isArray(meta?.materialOptions?.names) && meta.materialOptions.names.length
        ? meta.materialOptions.names
        : INITIAL_MATERIALS;
      setMaterials(nextMaterials);
      if (meta?.lastEmailTo && !formData.mail_to_list[0]) {
        setFormData(prev => ({ ...prev, mail_to_list: [String(meta.lastEmailTo || '')] }));
      }
      setMetaLoaded(true);
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent('app-notification', { detail: { type: 'error', message: `加载开单元数据失败：${err?.message || '未知错误'}` } }));
    } finally {
      metaRequestRef.current = null;
    }
  })();
  metaRequestRef.current = request;
  return request;
};

const handleCreate = () => {
  setFormData(DEFAULT_FORM);
  setErrors([]);
  setSearchResults([]);
  setShowSearchCards(false);
  setShowNewPanel(false);
  void loadMeta();
  setView('create');
};
```

- [ ] **Step 4: Verify GREEN and compile the frontend**

Run:

```bash
node scripts/test-work-order-meta-loading.js
npm --prefix frontend-next run lint
npm --prefix frontend-next run build
```

Expected: regression PASS, TypeScript PASS, Vite production build PASS.

- [ ] **Step 5: Commit the source change**

```bash
git add scripts/test-work-order-meta-loading.js frontend-next/src/components/WorkOrders.tsx public/new
git commit -m "perf: defer work order form metadata"
```

---

### Task 2: Enable and verify HTTP/2 transport

**Files:**
- Create: `scripts/check-runtime-edge-config.js`
- Runtime modify: `/etc/nginx/sites-available/packaging-system`
- Runtime backup: `/etc/nginx/sites-available/packaging-system.pre-runtime-edge`

**Interfaces:**
- Consumes: a readable Nginx site-file path as `process.argv[2]`.
- Produces: exit code 0 only when both IPv4 and IPv6 TLS listeners include `ssl http2`.

- [ ] **Step 1: Write the failing configuration verifier**

```js
'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const file = process.argv[2];
if (!file) throw new Error('nginx site path required');
const source = fs.readFileSync(file, 'utf8');
assert.match(source, /^\s*listen 443 ssl http2;/m, 'IPv4 TLS listener must enable HTTP/2');
assert.match(source, /^\s*listen \[::\]:443 ssl http2(?: ipv6only=on)?;/m, 'IPv6 TLS listener must enable HTTP/2');
console.log('runtime edge config verified');
```

- [ ] **Step 2: Run the verifier against production and verify RED**

Run: `node scripts/check-runtime-edge-config.js /etc/nginx/sites-enabled/packaging-system`

Expected: FAIL because the current TLS listeners contain `ssl` without `http2`.

- [ ] **Step 3: Prepare a patched candidate without editing production in place**

Copy the active file to `/tmp/packaging-system.nginx.candidate`, then use `apply_patch` on the temporary file to change only:

```nginx
listen [::]:443 ssl http2 ipv6only=on;
listen 443 ssl http2;
```

Run the verifier against the candidate and expect PASS.

- [ ] **Step 4: Install with rollback and validate before reload**

```bash
sudo cp -a /etc/nginx/sites-available/packaging-system /etc/nginx/sites-available/packaging-system.pre-runtime-edge
sudo install -o nobody -g nogroup -m 0644 /tmp/packaging-system.nginx.candidate /etc/nginx/sites-available/packaging-system
sudo nginx -t
```

Expected: syntax and configuration tests are successful. If validation fails, restore the backup before any reload.

- [ ] **Step 5: Reload and verify ALPN**

```bash
sudo systemctl reload nginx
node scripts/check-runtime-edge-config.js /etc/nginx/sites-enabled/packaging-system
openssl s_client -alpn h2 -connect cahs.top:443 -servername cahs.top </dev/null 2>/dev/null | grep 'ALPN protocol: h2'
```

Expected: Nginx active and TLS reports `ALPN protocol: h2`.

- [ ] **Step 6: Commit the reusable verifier**

```bash
git add scripts/check-runtime-edge-config.js
git commit -m "test: verify runtime edge transport"
```

---

### Task 3: Deploy and verify public behavior

**Files:**
- Deploy: `public/new/`
- Preserve: the current service release and Nginx backup from Tasks 1-2.

**Interfaces:**
- Consumes: built Vite assets and the existing `packaging-system.service` deployment path.
- Produces: a healthy public desktop/mobile new UI over HTTP/2 with unchanged authenticated read results.

- [ ] **Step 1: Run pre-deployment checks**

```bash
git diff --check
node scripts/test-work-order-meta-loading.js
node scripts/check-runtime-edge-config.js /etc/nginx/sites-enabled/packaging-system
npm --prefix frontend-next run lint
```

Expected: all checks PASS.

- [ ] **Step 2: Restart the approved management service**

```bash
sudo systemctl restart packaging-system.service
systemctl is-active packaging-system.service
curl -fsS http://127.0.0.1:8080/health
```

Expected: service `active` and health JSON has `ok: true`.

- [ ] **Step 3: Run desktop and mobile production smoke**

```bash
PRODUCTION_BASE_URL=https://cahs.top/new/ npm run test:production-smoke
```

Expected: public shell checks pass for desktop and mobile; authenticated tests run only when the protected smoke credentials are available.

- [ ] **Step 4: Verify read-only production timing and consistency**

Use the existing production read-only account to request the order dashboard, work-order list, preview drafts, and metadata three times. Output only HTTP status, milliseconds, and byte counts. Expect 200 responses and stable byte counts per endpoint.

- [ ] **Step 5: Verify no initial metadata request in a cold browser session**

Use Playwright request tracing with a cached authorized user and record URLs until the work-order list is visible. Expect `/api/work-orders` and `/api/work-orders/preview-drafts`, but no `/api/work-orders/meta` until the create button is clicked.

- [ ] **Step 6: Push and reconcile the runtime catalog**

```bash
git push origin main
```

Update `site-runtime` evidence and verification date without copying credentials or business records. Scan the catalog for password, token, cookie, SMTP Message-ID, and business-record values.

- [ ] **Step 7: Roll back on any failed production condition**

Restore `/etc/nginx/sites-available/packaging-system.pre-runtime-edge`, run `sudo nginx -t`, reload Nginx, restore the preserved frontend output, restart `packaging-system.service`, and repeat health checks. Do not leave a partially deployed configuration.

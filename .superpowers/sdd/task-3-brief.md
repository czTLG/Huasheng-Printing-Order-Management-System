### Task 3: Guarded Public Evidence Import

**Files:**
- Create: `src/lib/matrixStream.js`
- Create: `scripts/test-matrix-stream.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `validatePublicUrl(url, dnsLookup) -> Promise<{ ok, normalized_url, reason }>`
- Produces: `normalizeDiscoveryRecord(input) -> normalized record`
- Produces: `importDiscoveryBatch(db, runId, records, options) -> summary`
- Consumes: `upsertEntity`, `appendEvidence`, and `saveClassification`

- [ ] **Step 1: Write failing URL and import tests**

Cover exact rejection of `http://127.0.0.1`, `http://169.254.169.254`, `http://10.0.0.1`, URLs with credentials, non-HTTP schemes, redirects to private IPs, India, missing source URLs, and more than 20 records for one country. Cover acceptance of an HTTPS official website resolving to a public documentation-range test address through an injected DNS stub.

- [ ] **Step 2: Run and observe missing implementation**

Run: `node scripts/test-matrix-stream.js`

Expected: FAIL because `matrixStream` is missing.

- [ ] **Step 3: Implement URL and record guards**

Use `URL`, `dns.promises.lookup`, and `net.isIP`. Reject loopback, private IPv4, link-local, carrier-grade NAT, IPv6 loopback, IPv6 unique-local, IPv4-mapped private addresses, credentials, ports outside 80/443, and hostnames resolving to any blocked address. Revalidate every redirect destination.

- [ ] **Step 4: Implement bounded import**

Reject the entire batch if it exceeds 120 input records; reject individual countries after 20; exclude India before persistence; require official URL and at least one evidence item; classify every accepted record; and return counters for input, excluded, test, noise, needs-review, valid, and errors. Do not touch `customers` or `crm_messages`.

- [ ] **Step 5: Verify focused tests**

Run: `npm run test:matrix-stream`

Expected: `matrix-stream tests passed` with no network calls because DNS and fetch are injected.

- [ ] **Step 6: Commit guarded import**

```bash
git add src/lib/matrixStream.js scripts/test-matrix-stream.js package.json
git commit -m "feat: add guarded matrix stream import"
```


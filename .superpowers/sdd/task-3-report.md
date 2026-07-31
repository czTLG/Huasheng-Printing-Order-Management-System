# Task 3 RED/GREEN Report

## Status

- Implementation commit: `f2f4eee` (`feat: add guarded matrix stream import`)
- Deliverable files committed: `src/lib/matrixStream.js`, `scripts/test-matrix-stream.js`, `package.json`
- Report intentionally remains outside the feature commit for parent-agent collection.

## Baseline

Before Task 3 changes:

- `npm run test:matrix-rank` — exit 0, `schema-rank tests passed`
- `npm run test:signal-cache` — exit 0, `signal-cache tests passed`
- Worktree confirmed isolated at `/home/admin/work/packaging-system/.worktrees/matrix-stream-phase1` on `feature/matrix-stream-phase1`.

## RED 1 — missing implementation

Test written first: `scripts/test-matrix-stream.js` imported the three required interfaces and covered URL rejection/acceptance, redirect guarding, exclusion, missing evidence source, per-country limit, batch limit, persistence counters, and forbidden-table invariants.

Command:

```text
node scripts/test-matrix-stream.js
```

Observed result: exit 1 with the expected missing-feature failure:

```text
Error: Cannot find module '../src/lib/matrixStream'
Require stack:
- .../scripts/test-matrix-stream.js
```

This was the expected RED because `src/lib/matrixStream.js` did not yet exist.

## GREEN 1 — guarded import implemented

Minimal implementation added:

- `validatePublicUrl` based on `URL`, `net.isIP`, and injected/default `dns.promises.lookup`.
- Blocking for IPv4 loopback/private/link-local/carrier-grade-NAT, IPv6 loopback/unique-local/link-local, and IPv4-mapped blocked IPv4.
- Credentials, unsupported schemes, and ports outside 80/443 rejected.
- DNS `all: true` results rejected when any resolved address is blocked.
- Redirects followed manually with every destination URL/DNS checked before the injected fetch receives that hop.
- Record normalization and bounded import with India excluded before persistence, 20 records per country, 120 per batch, evidence requirements, classification, and counters.
- Production code imports only `upsertEntity`, `appendEvidence`, and `saveClassification`; it contains no `customers` or `crm_messages` reference.

Command:

```text
npm run test:matrix-stream
```

Observed result: exit 0, `matrix-stream tests passed`.

All focused DNS and fetch operations used injected stubs. The DNS stub only accepted `.example` hostnames and returned documentation-range `203.0.113.10`; unexpected host lookups threw. The fetch stub returned synthetic manual-redirect responses. No focused test used real network access.

## RED 2 — persistence atomicity regression

During review, a storage failure after `upsertEntity` was identified as capable of leaving an evidence-less entity. A regression record with rejected HTML-like evidence content was added before changing production code.

Command:

```text
npm run test:matrix-stream
```

Observed result: exit 1 at the entity-count invariant:

```text
AssertionError [ERR_ASSERTION]: 2 == 1
```

This proved a rejected record had partially persisted its entity.

## GREEN 2 — record-level atomic persistence

The `upsertEntity` / all `appendEvidence` calls / `saveClassification` sequence was wrapped in one outer database transaction. A rejected evidence item now rolls the entire record back.

Command:

```text
npm run test:matrix-stream
```

Observed result: exit 0, `matrix-stream tests passed`.

## Final verification before commit

All commands were run fresh and returned exit 0:

```text
npm run test:matrix-stream  -> matrix-stream tests passed
npm run test:matrix-rank    -> schema-rank tests passed
npm run test:signal-cache   -> signal-cache tests passed
npm run verify:smoke        -> SMOKE PASS
node --check src/lib/matrixStream.js
node --check scripts/test-matrix-stream.js
git diff --check
rg -n "customers|crm_messages" src/lib/matrixStream.js  -> no matches
```

The feature commit contains exactly the three brief-listed deliverable files.

## Requirement coverage

- URL guards: IPv4, IPv6, IPv4-mapped IPv6, credentials, protocol, port, and multi-answer DNS blocking.
- Redirect guard: manual redirect processing and pre-fetch validation on every destination.
- Geographic/batch bounds: India excluded; first 20 records per normalized country eligible; later records counted as errors; batches over 120 rejected before persistence.
- Evidence bounds: official URL and at least one evidence item required; every evidence source URL guarded.
- Persistence: accepted records receive entity, evidence, and classification atomically.
- Counters: `input`, `excluded`, `test`, `noise`, `needs_review`, `valid`, `errors` always returned for accepted-size batches.
- Isolation: production import does not read or write `customers` or `crm_messages`; tests assert both remain empty.

## Attention points

- Redirect validation uses injected/default fetch with `HEAD` and `redirect: 'manual'`; downstream providers must preserve manual redirect behavior.
- Documentation-range IPv4 (`203.0.113.0/24`) is intentionally accepted to support deterministic offline tests, as required by the brief.
- Record failures are summarized in `errors` without returning raw source content or detailed per-record payloads.

## 蒸馏进度

- 已确认模块：公共 URL 防护、逐跳重定向复验、发现记录规范化、国家/批次限额、证据绑定与原子持久化、分类计数。
- 未解决模块：真实搜索提供器接入、候选只读 API、现有记录只读适配器不属于本任务，尚未确认。
- 下一优先知识缺口：Task 4 的只读适配映射与隐私预览授权边界。

---

# Task 3 Review Remediation — DNS Binding

## Review result and root cause

- Review file read completely: `.superpowers/sdd/task-3-review.md`.
- Critical finding reproduced: URL validation resolved a public address, but the subsequent generic fetch received the hostname and could independently resolve it to a blocked address.
- Root cause: the checked DNS answer was discarded at the validation/connection boundary, creating a time-of-check/time-of-use gap at every hop.

## RED — deterministic DNS rebinding

An offline regression used a stateful injected resolver for `rebind.example`:

1. Validation lookup returned public documentation address `203.0.113.10`.
2. A simulated connection-time lookup returned `127.0.0.1` when no pinned address was supplied.
3. The injected probe recorded the address it would reach.

Command:

```text
npm run test:matrix-stream
```

Observed target RED after fixture calibration:

```text
AssertionError: connection must not resolve the original hostname again
actual: 2
expected: 1
```

This confirmed the hostname was resolved once for validation and again for connection.

The same test update also added explicit offline regressions for:

- missing official URL;
- empty evidence array;
- two-hop official URL redirects;
- an evidence source URL redirect;
- blocked redirect destinations never reaching the injected probe.

## GREEN — resolved address bound to connection

Implementation commit: `882a509` (`fix: pin matrix stream network probes`).

The network path now:

1. Parses and resolves each hop exactly once.
2. Rejects the hop if any answer is blocked.
3. Selects an address from that exact validated set.
4. Passes `connectAddress` and `connectFamily` to the probe.
5. Uses a production default probe built on `http.request` / `https.request` with `hostname` set to the validated IP.
6. Preserves the original authority in the HTTP `Host` header.
7. Preserves the original DNS hostname as HTTPS `servername` and keeps `rejectUnauthorized: true`; IP literals omit SNI while retaining certificate verification.
8. Returns each 3xx response to the explicit redirect loop; no automatic redirect following is used.
9. Repeats resolution, validation, and IP binding independently for every redirect hop, including evidence URLs.

Focused GREEN:

```text
npm run test:matrix-stream
matrix-stream tests passed
```

The rebinding resolver was called once for the attacker-controlled hostname, and every recorded simulated connection remained pinned to `203.0.113.10`; none reached `127.0.0.1`.

## RED/GREEN — HTTPS IP-literal SNI boundary

A separate offline public-IPv6 import regression initially fell into `errors` because the probe received an invalid bracketed IP as TLS SNI. The minimal correction strips URL brackets and omits SNI for IP literals while continuing to require certificate verification. The focused test then returned to GREEN with the record classified `needs_review` as expected.

## Final verification

Fresh pre-commit verification, all exit 0:

```text
npm run test:matrix-stream  -> matrix-stream tests passed
npm run test:matrix-rank    -> schema-rank tests passed
npm run test:signal-cache   -> signal-cache tests passed
npm run verify:smoke        -> SMOKE PASS
node --check src/lib/matrixStream.js
node --check scripts/test-matrix-stream.js
git diff --check
```

Static boundary checks confirmed:

- no `globalThis.fetch` production fallback;
- production connections use `hostname: options.connectAddress`;
- original `Host`, TLS `servername`, `rejectUnauthorized: true`, and `redirect: 'manual'` are explicit;
- no `customers` or `crm_messages` references in `src/lib/matrixStream.js`.

## Attention points

- `options.fetch` is now a pinned-probe injection contract, not a generic global-fetch contract; injected test/providers must honor `connectAddress` and `connectFamily`.
- Production probing uses `HEAD`, does not fetch page bodies, and opens a fresh non-pooled connection per hop (`agent: false`).
- All focused tests remain fully offline through injected DNS and probe functions.

## 蒸馏进度（审查修复）

- 已确认模块：DNS 答案与实际连接 IP 绑定、Host/SNI/证书校验、多跳与证据跳转逐跳重绑、必填 URL/证据回归。
- 未解决模块：真实提供器若自定义注入探测器，仍需遵守固定地址契约；尚无跨提供器契约测试。
- 下一最高优先级知识缺口：为后续搜索提供器定义并验证统一的安全探测适配契约。

---

# Task 3 Re-review Remediation — Verifiable Transport

## Root cause

The previous fix secured the default network path but still exposed `options.fetch`. That override could ignore `connectAddress`, perform its own DNS lookup or automatic redirects, and return a response without proving the actual connected peer. Argument propagation was therefore mistaken for enforcement.

## RED 1 — response without peer proof

An ordinary fetch-shaped injected function returned a normal 200 response without `connectedAddress` or `connectedFamily`.

Command:

```text
npm run test:matrix-stream
```

Observed RED:

```text
AssertionError: 1 == 0
```

The record was incorrectly counted `valid: 1` instead of being rejected, proving the module accepted an unverifiable connection.

Minimal GREEN added strict runtime comparison between the response peer fields and the exact current-hop validated target. Missing or mismatched proof returns `connection_address_mismatch`. The focused suite then passed.

## RED 2 — production adapter not directly testable

The test contract was then changed from `fetch` to `transport`, and the production pinned adapter was required as a directly testable export.

Observed RED:

```text
AssertionError: production pinned request adapter must be directly testable
actual: undefined
expected: function
```

## GREEN 2 — pinnedRequest and transport contract

Implementation commit: `ef87174` (`fix: verify matrix stream transport peers`).

Changes:

- Removed support for `options.fetch`; supplying it throws `fetch option is not supported; use the pinned transport contract` before persistence.
- Added `options.transport` as the high-level injected contract.
- Every transport response must provide numeric `connectedAddress` and `connectedFamily` matching the selected validated DNS answer exactly.
- Exported production `pinnedRequest` for deterministic adapter testing.
- `pinnedRequest` accepts only narrow `http` / `https` request factories for offline tests.
- Production security decisions remain inside `pinnedRequest`: original hostname, original Host header, TLS servername, certificate verification, no pooling, and a closed-over lookup callback that returns only the validated IP/family.
- `pinnedRequest` reads `response.socket.remoteAddress` and `remoteFamily` and returns them as peer proof.
- A default-adapter import using a fake HTTPS request factory succeeds only when the fake socket reports the validated public peer.
- A fake socket reporting `127.0.0.1` is rejected and creates no entity.
- A generic transport returning an ordinary fetch response without peer proof is rejected.

Direct offline adapter assertions verify:

```text
hostname             = original DNS hostname
Host                 = original URL authority
servername           = original DNS hostname
rejectUnauthorized   = true
agent                = false
lookup(...)           -> validated connectAddress/connectFamily only
connectedAddress      = response.socket.remoteAddress
connectedFamily       = normalized response.socket.remoteFamily
```

## Final verification

Fresh pre-commit results, all exit 0:

```text
npm run test:matrix-stream  -> matrix-stream tests passed
npm run test:matrix-rank    -> schema-rank tests passed
npm run test:signal-cache   -> signal-cache tests passed
npm run verify:smoke        -> SMOKE PASS
node --check src/lib/matrixStream.js
node --check scripts/test-matrix-stream.js
git diff --check
```

Static checks confirm no global-fetch fallback and no forbidden-table reference in production code.

## Attention points

- This section supersedes the prior note describing `options.fetch` as a pinned-probe contract: `options.fetch` is now explicitly prohibited.
- Custom `transport` implementations must return actual peer proof; missing or mismatched proof is rejected before persistence.
- Request-factory injection is intentionally below the security decision layer and is used only to test the production adapter offline.

## 蒸馏进度（复审修复）

- 已确认模块：普通 fetch 禁用、transport 对端证明强校验、默认 pinnedRequest 直测、固定 lookup、Host/SNI/证书校验、remoteAddress 不一致拒绝。
- 未解决模块：自定义 transport 的对端证明来源仍属于适配器可信计算基；后续提供器需单独做契约认证测试。
- 下一最高优先级知识缺口：建立 transport 适配器合规测试套件，验证真实 socket 对端证明不可伪造。

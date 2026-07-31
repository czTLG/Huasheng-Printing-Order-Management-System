# Matrix Stream Phase 1 — Final Review R4

## Verdict

**GO**

Reviewed commit: `5c25c86 fix: close matrix phase one r3 review`

The two R3 Important findings are closed. No Critical or Important findings remain in the reviewed Phase-1 scope. The complete unified gate is green, the deadline/abort race canary remained green across repeated executions, and independent production-format address counterexamples passed.

## Severity summary

- Critical: **0**
- Important: **0**

## R3 closure verification

### 1. Production email participants — closed

`parsedAddressList()` now accepts JSON arrays and production CSV/RFC address syntax, recursively handles RFC groups, normalizes extracted addresses, and marks invalid entries as malformed (`src/lib/matrixCrmAdapter.js:110-145`). Internal-only detection evaluates normalized `from/to/cc/bcc` participants and refuses the internal-only classification when any list is malformed (`src/lib/matrixCrmAdapter.js:160-168`). Address-list malformation also participates in the safe-review signal (`src/lib/matrixCrmAdapter.js:254-267`).

Committed coverage verifies:

- outbound internal → external CSV/RFC participants remain eligible;
- inbound external → internal CSV participants remain eligible;
- all-internal CSV participants are noise regardless of direction;
- malformed address syntax downgrades to `needs_review` with `malformed_json_payload` (`scripts/test-matrix-crm-adapter.js:268-272`, `scripts/test-matrix-crm-adapter.js:344-351`).

Independent temporary canaries additionally made each format decisive rather than incidental:

- a JSON-array recipient as the sole external participant classified `valid`;
- an RFC display-name address as the sole external participant classified `valid`;
- a mixed valid/malformed recipient list classified `needs_review` with the malformed reason.

All three passed. The temporary canary edits were then removed.

### 2. Exact redirect-hop authorization — closed

Non-wildcard host patterns now match only the normalized exact host; subdomain matching requires an explicit `*.` pattern (`src/lib/matrixStream.js:370-376`). The record's official redirect chain receives only `[record.official_domain]`, so every `Location` is exact-host checked before DNS resolution and before a second transport request (`src/lib/matrixStream.js:319-345`, `src/lib/matrixStream.js:530-534`). Evidence chains use the same per-hop authorization boundary (`src/lib/matrixStream.js:557-570`).

The committed regressions cover both unrelated hosts and child subdomains. For `origin.example → child.origin.example`, transport recorded only `https://origin.example/`; the child was rejected before contact even though the broader campaign allowlist was `*.example` (`scripts/test-matrix-stream.js:513-539`).

### 3. Deadline/abort race — closed

`withinDeadline()` now invokes the supplied abort callback synchronously in the deadline timer before rejecting (`src/lib/matrixStream.js:405-415`). Both official and evidence waits pass the shared controller abort callback (`src/lib/matrixStream.js:530-534`, `src/lib/matrixStream.js:563-570`). The redirect loop checks the signal before host/DNS work and immediately after DNS completion, before probe consumption or transport (`src/lib/matrixStream.js:319-335`).

The slow-DNS regression confirms that late DNS completion starts no detached transport and that every DNS lookup receives an aborted signal (`scripts/test-matrix-stream.js:558-574`). I reran the complete stream suite 20 times; the deadline/abort canary passed **20/20**.

## Fresh verification evidence

`npm run verify:matrix-phase1` completed with exit code 0:

- `test:matrix-rank` — PASS
- `test:signal-cache` — PASS
- `test:matrix-stream` — PASS
- `test:matrix-crm` — PASS
- `test:matrix-api` — PASS
- integration verifier — PASS
- `verify:smoke` — SMOKE PASS
- `git diff --check` — PASS

After removing the temporary address canaries, the restored CRM suite passed again. Review inspection also confirmed that commit `5c25c86` changes only the two R3 boundaries, their regressions, deadline cancellation ordering, and the fixes report; the previously accepted campaign, evidence, API, rollback, network, and no-formal-CRM-write contracts remain covered by the unified gate.

## Release decision

The code is approved for the Phase-1 controlled workflow. A real public-evidence run still requires an authenticated authorized actor, an explicitly approved small campaign, terms-reviewed third-party sources, an isolated database, and manual inspection of the first sample. Those are documented operational prerequisites, not remaining Critical/Important code findings.

## 蒸馏进度

- 已确认模块：生产 CSV/JSON/RFC 邮件参与者解析、internal-only 判定、畸形地址安全降级、官方与证据重定向逐跳精确主机拒绝、deadline/DNS abort 竞态、此前全部分类/证据/预算/API/回滚/只读合同及统一门禁。
- 未解决模块：真实第三方来源逐域 terms 审批与首批真实样本人工抽检尚未执行；属于运行输入和人工审批。
- 下一最高优先知识缺口：为首个批准来源固化 host、source type、terms URL、审批时间，并在隔离数据库执行极小样本后人工核对全部 `valid/A`。

# Task 3 Independent Re-review — Round 3

## Conclusions

- **Specification compliance: Pass.** The complete Task 3 brief is satisfied. The original DNS-rebinding defect and the later generic-fetch injection bypass are both closed. URL/address guards, per-hop resolution and binding, Host/SNI/certificate handling, evidence/import bounds, transactional persistence, counters, and forbidden-table isolation are all present with direct focused coverage.
- **Code quality: Approved.** The security boundary is now explicit and testable: ordinary `options.fetch` is prohibited, the default adapter pins DNS through a closed-over lookup, every transport result must prove the connected peer address and family, and mismatches are rejected before persistence. No Critical, Important, or Minor defects remain from this review scope.

## Findings

### Critical

None.

### Important

None.

### Minor

None.

## Round 3 Verification

| Review target | Result | Evidence |
| --- | --- | --- |
| `options.fetch` disabled before persistence | Pass | `src/lib/matrixStream.js:345-347`; rejection regression at `scripts/test-matrix-stream.js:302-312` |
| Ordinary fetch-shaped response without peer proof rejected | Pass | Strict proof check at `src/lib/matrixStream.js:308-312`; regression at `scripts/test-matrix-stream.js:313-321` |
| `connectedAddress` must equal the selected validated address | Pass | `src/lib/matrixStream.js:291`, `src/lib/matrixStream.js:298-310`; mismatched socket regression at `scripts/test-matrix-stream.js:395-412` |
| `connectedFamily` must equal the selected validated family | Pass | `src/lib/matrixStream.js:299-310`; default adapter normalizes socket family at `src/lib/matrixStream.js:232-266` |
| Default adapter pins DNS without a second uncontrolled lookup | Pass | Closed-over lookup returns only `connectAddress/connectFamily` at `src/lib/matrixStream.js:248-260`; direct assertion at `scripts/test-matrix-stream.js:343-369` |
| Original Host, TLS SNI, and certificate verification preserved | Pass | Hop options at `src/lib/matrixStream.js:295-303`; adapter forwarding at `src/lib/matrixStream.js:248-257`; direct assertions at `scripts/test-matrix-stream.js:356-362` |
| Default adapter returns actual socket peer proof | Pass | `response.socket.remoteAddress/remoteFamily` read at `src/lib/matrixStream.js:261-266`; direct and import-level tests at `scripts/test-matrix-stream.js:343-412` |
| Default pinned adapter directly tested offline | Pass | `fakeRequestFactory` and direct `pinnedRequest` test at `scripts/test-matrix-stream.js:67-91`, `scripts/test-matrix-stream.js:343-369`; default import path at `scripts/test-matrix-stream.js:371-393` |
| Every redirect hop independently resolves, validates, binds, and proves peer | Pass | Resolution and target selection remain inside the loop at `src/lib/matrixStream.js:283-312`; multi-hop/evidence regressions at `scripts/test-matrix-stream.js:246-260` |
| DNS rebinding regression remains offline and pinned | Pass | `scripts/test-matrix-stream.js:262-300` |
| Original Task 3 import requirements | Pass | No regression found across address guards, India exclusion, 20/120 limits, required official/evidence URLs, record-level transaction, classifications/counters, or forbidden-table isolation |

## Residual Trust Boundary

Custom `transport` and `requestFactories` are executable in-process dependencies and can fabricate peer proof or perform unrelated side effects. That is an inherent trusted-code boundary rather than a bypass available to untrusted discovery input. Future adapters should receive their own conformance tests and code review; the current default production adapter derives proof from the actual socket and satisfies this task.

The implementation agent's reported passing suite was not repeated. This review read the complete updated report and R3 diff, checked the current implementation and focused tests against the brief and both prior reviews, and confirmed `git diff --check` for the deliverable changes.

## 蒸馏进度

- 已确认模块：普通 fetch 禁用、transport 对端地址/协议族强校验、缺失或不匹配证明拒绝、默认 pinnedRequest 离线直测、DNS 固定、Host/SNI/证书校验、逐跳重绑定与原子持久化。
- 未解决模块：本任务范围内无；后续新增自定义 transport 时需独立认证其 socket 证明来源。
- 下一最高优先级知识缺口：建立可复用的 transport 适配器合规测试套件，供后续提供器接入时复用。

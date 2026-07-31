# Task 4 Final Independent Re-review

## Verdicts

- **Specification compliance: READY.** The implementation satisfies the six baseline classifications, domestic legacy exclusion, conservative anomaly handling, per-record error retention, private-data-minimal default output, database-current administrator preview authorization, workspace-confined output, and read-only database requirements. All three findings from the first independent review are resolved.
- **Implementation quality: READY.** No remaining Critical, Important, or Minor findings were identified in the remediation diff. The new regression cases directly cover the previously reproduced false-positive and output-escape paths.

## Remediation verification

### Empty company shells now downgrade safely

`businessEvidence()` no longer treats `company_name` alone as evidence; it accepts explicit product/industry/background data or substantive conversation signals ([src/lib/matrixCrmAdapter.js:216](../../src/lib/matrixCrmAdapter.js#L216)). The classifier's existing valid-only safety gate consequently adds `missing_business_evidence` and returns `needs_review` ([src/lib/matrixCrmAdapter.js:358](../../src/lib/matrixCrmAdapter.js#L358)).

The new customer-only fixture has an approved country and matching contact/domain but no product or conversation evidence, and asserts `needs_review / missing_business_evidence` ([scripts/test-matrix-crm-adapter.js:140](../../scripts/test-matrix-crm-adapter.js#L140), [scripts/test-matrix-crm-adapter.js:283](../../scripts/test-matrix-crm-adapter.js#L283)). A fresh focused in-memory replay of the original review reproducer returned the same safe result.

### Every populated source `*_at` field receives strict validation

`strictSourceTime()` enforces the accepted format, verifies the actual UTC calendar date, and rejects timestamps that still fail parsing ([src/lib/matrixCrmAdapter.js:64](../../src/lib/matrixCrmAdapter.js#L64)). `hasMalformedTime()` dynamically scans every non-empty key ending in `_at` across the customer and all grouped CRM/email rows, rather than checking only a fixed subset ([src/lib/matrixCrmAdapter.js:167](../../src/lib/matrixCrmAdapter.js#L167)). Any failure contributes `malformed_source_time` and safely downgrades candidate classifications.

Regressions cover impossible day, impossible month, permissive slash format, plus invalid customer, CRM-message, and email-message `updated_at` fields ([scripts/test-matrix-crm-adapter.js:194](../../scripts/test-matrix-crm-adapter.js#L194), [scripts/test-matrix-crm-adapter.js:286](../../scripts/test-matrix-crm-adapter.js#L286)). A fresh focused replay of the original `2026-02-30` reproducer returned `needs_review / malformed_source_time`.

### Output uses guarded staging and atomic replacement

Existing destinations must be single-link regular files, so symlinks, hard links, directories, FIFOs, sockets, and devices are rejected before staging ([scripts/matrix-classify-current.js:53](../../scripts/matrix-classify-current.js#L53)). Output is written to a random same-directory temporary created with `O_CREAT | O_EXCL | O_NOFOLLOW`, verified by `fstat`, written, file-`fsync`ed, and closed ([scripts/matrix-classify-current.js:70](../../scripts/matrix-classify-current.js#L70)).

Immediately before publication, the real parent, destination type/link count, and staged file are revalidated; publication uses same-directory atomic `rename`, followed by directory `fsync`, with temporary cleanup in `finally` ([scripts/matrix-classify-current.js:85](../../scripts/matrix-classify-current.js#L85)). This avoids direct truncation of a destination inode and closes the prior hard-link escape. Tests assert final symlink, ancestor symlink, hard-link sentinel preservation, non-regular rejection, safe-write success, and mode `0600` ([scripts/test-matrix-crm-adapter.js:364](../../scripts/test-matrix-crm-adapter.js#L364)).

## Other confirmed requirements

- All six brief baselines remain explicitly asserted: excluded domestic, token artifact `test`, system email `noise`, unknown WhatsApp `needs_review`, valid overseas email, and valid overseas WhatsApp.
- Duplicate content, malformed JSON, uncertain direction, missing business evidence, and classifier exceptions retain internal source IDs and cannot be promoted into the valid candidate set.
- Default records contain internal identity/source IDs and classification metadata only. Contact preview requires both the CLI flag and a verified non-fallback JWT whose `sub` resolves to an active allowed administrator in the same database; message bodies are never previewed.
- The CLI opens the selected database with `readonly: true` and `fileMustExist: true`. The updated implementation report records production exit 0 and an identical SHA-256 before/after.
- Review package `ef87174..965b4ae` changes only the four briefed implementation paths: `package.json`, `scripts/matrix-classify-current.js`, `scripts/test-matrix-crm-adapter.js`, and `src/lib/matrixCrmAdapter.js`.

## Review evidence and remaining issues

- Read the original brief, prior independent review, updated implementation report, and all 1,043 lines of `review-task-4-r2.diff`.
- Inspected the final source and regression assertions with line numbers.
- Ran only the two focused in-memory regressions from the first review; both now produce the required safe downgrade. Per instruction, did not repeat the reported focused suite, predecessor suites, smoke suite, or production database dry run.
- **Remaining review findings: none.** The production snapshot still has zero `valid` records; this is an intentionally conservative observed result and a later data-quality calibration task, not a Task 4 correctness defect.

## 蒸馏进度

- 已确认模块：六类基准、国内旧记录隔离、空壳公司安全降级、所有来源 `*_at` 严格校验、异常保留、默认脱敏、当前管理员授权、只读与哈希不变、安全原子输出、四路径提交范围。
- 未解决模块：无 Task 4 审查阻断项；真实数据候选精确率仍待后续人工抽样。
- 下一最高优先知识缺口：按 `needs_review` 原因码分层抽样，校准国家与业务证据门槛的精确率。

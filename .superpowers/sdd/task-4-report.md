# Task 4 Implementation Report

## Scope

- Added the read-only current-record normalizer and deterministic dry-run report.
- Added the production CLI with read-only database access, internal-ID-only default output, authenticated private preview, and guarded explicit output.
- Added fixture and security regression coverage.
- Modified only the four implementation paths named by the brief; this report is the requested handoff artifact.

## RED / GREEN evidence

1. Initial RED: `node scripts/test-matrix-crm-adapter.js` failed with `Cannot find module '../src/lib/matrixCrmAdapter'`.
2. Initial GREEN: the six baseline fixtures passed: excluded domestic legacy, known token artifact as `test`, system mail as `noise`, unknown WhatsApp as `needs_review`, and valid overseas email/WhatsApp as `valid`.
3. Security RED/GREEN cycles covered:
   - default report contact-key leakage;
   - blank-country domestic legacy exclusion;
   - repeated segments and cross-message substantial overlap;
   - any malformed source time in a group;
   - malformed CRM and email JSON fields, including address arrays;
   - missing business evidence;
   - outbound receiver identity and unknown direction;
   - per-record classification error retention;
   - fallback JWT, missing/inactive/non-admin database users, and database-current role enforcement;
   - final-path and ancestor symlink output escape.
4. Final focused GREEN: `npm run test:matrix-crm` printed `matrix CRM adapter tests passed`.

## Verification

- `node --check src/lib/matrixCrmAdapter.js` — exit 0.
- `node --check scripts/matrix-classify-current.js` — exit 0.
- `npm run test:matrix-crm` — pass.
- `npm run test:matrix-rank` — pass.
- `npm run test:signal-cache` — pass.
- `npm run test:matrix-stream` — pass.
- `npm run verify:smoke` — `SMOKE PASS`.
- Final independent review — Ready; no remaining Critical, Important, or Minor findings.

## Production read-only dry run

- Database opened with `readonly: true` and `fileMustExist: true`.
- CLI exit code: 0.
- Aggregate counts: input 72; excluded domestic 254; test 1; noise 3; needs-review 68; valid 0; errors 0.
- Known token baseline: counted as `test`.
- Default record keys: `classification`, `confidence`, `identity_id`, `priority`, `reason_codes`, `source_ids`.
- Default identities: internal IDs only; no private preview field.
- Database SHA-256 before: `f46c1195e59539f282802ab164fd3415299e2f65d180c2b7a776c6ab385e47b3`.
- Database SHA-256 after: `f46c1195e59539f282802ab164fd3415299e2f65d180c2b7a776c6ab385e47b3`.

## Attention points

- The current production snapshot yields zero `valid` records because the approved-country and business-evidence gates are intentionally conservative. This is an observed result, not a completed candidate set.
- Private preview requires both `--include-private-preview` and a token signed by an explicitly configured safe JWT secret whose `sub` resolves to an active `super_admin` or `foreign_trade_crm_admin` in the same read-only database.
- Explicit output is restricted to a regular file directly under the real workspace root and uses `O_NOFOLLOW`; nested output paths are rejected.
- No source row is updated, inserted, deleted, or overwritten by the adapter or CLI.

## 蒸馏进度

- 已确认模块：只读归一、国内旧记录隔离、四类安全分类、默认脱敏、私密预览双门槛、显著重复/畸形数据降级、安全输出、异常保留。
- 未解决模块：生产快照尚无通过严格门槛的 `valid` 记录，需后续人工抽样确认国家和业务证据缺口。
- 下一最高优先知识缺口：对 `needs_review` 按原因码分层抽样，确认哪些记录可通过补齐国家与明确业务证据转为有效候选。

## Final review remediation

An additional independent review identified three Important findings. Each was reproduced RED before implementation and verified GREEN afterward:

1. A customer shell with only a company name, approved country, and matching contact/domain was incorrectly `valid`. Bare company identity no longer counts as business evidence; the regression now yields `needs_review / missing_business_evidence`.
2. Calendar-invalid and permissively parsed timestamps could be normalized by JavaScript. The adapter now applies strict format and calendar validation to every populated `*_at` field on customer, CRM-message, and email-message rows. Invalid day, invalid month, slash-format, and three independent invalid `updated_at` regressions all downgrade with `malformed_source_time`.
3. Direct destination truncation could mutate an external inode through a hard link. Output now rejects hard links and non-regular destinations, stages a unique same-directory regular file with `O_CREAT | O_EXCL | O_NOFOLLOW`, verifies with `fstat`, writes and `fsync`s, closes, revalidates destination/root/staged file, atomically renames, `fsync`s the directory, and removes the temporary path on failure. Hard-link, symlink, ancestor-symlink, non-regular, and safe-write regressions pass.

Final re-review verdict: Ready; Critical 0, Important 0, Minor 0.

Fresh post-remediation verification:

- `npm run test:matrix-crm` — pass.
- `npm run test:matrix-rank` — pass.
- `npm run test:signal-cache` — pass.
- `npm run test:matrix-stream` — pass.
- `npm run verify:smoke` — `SMOKE PASS`.
- Production CLI exit 0; aggregate counts unchanged at input 72, excluded domestic 254, test 1, noise 3, needs-review 68, valid 0, errors 0.
- Production database SHA-256 before and after: `fca4254c764c2216594226fedf68ae4f609b8476879d3efb660a01371caa246b`.

### 蒸馏进度（最终复审修复）

- 已确认模块：严格业务证据门槛、所有来源时间字段的严格日历验证、硬链接/非普通文件拒绝与原子安全输出。
- 未解决模块：无 Task 4 审查阻断项。
- 下一最高优先知识缺口：对真实 `needs_review` 原因码进行人工抽样，评估安全门槛的精确率。

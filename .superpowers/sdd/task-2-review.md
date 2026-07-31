# Task 2 Independent Re-review

## 结论

- 规格符合性：**通过**
- 代码质量：**批准**
- 审查范围：`ac8af11..4068ffe`，仅复审，不修改实现。

第二轮修复已关闭原审查的全部 Critical、Important 和 Minor 项。中性 `matrix_*` 存储、唯一索引、证据来源与检索时间、事务、正式表隔离及既有 smoke 均保持符合简报。

## Findings

### Critical

无。

### Important

无。

### Minor

无阻断项。

## 原审查问题关闭情况

1. **原始页面内容隔离：已解决。** 所有输入对象采用显式字段白名单，未知字段在序列化或 SQL 写入前拒绝；campaign counters 与 public contacts 也限制为已知扁平结构。所有可持久化文本入口统一经过类型、长度和页面/可执行内容检查，调用方提供的 fingerprint 还必须是十六进制摘要。对应实现：`src/lib/signalCache.js:6-26`、`src/lib/signalCache.js:32-82`、`src/lib/signalCache.js:101-131`、`src/lib/signalCache.js:165-187`、`src/lib/signalCache.js:217-231`。测试覆盖嵌套内容、别名字段、HTML/脚本、超长页面正文、未知字段和非摘要 fingerprint：`scripts/test-signal-cache.js:24-77`、`scripts/test-signal-cache.js:106-152`。
2. **指定 run 查询：已解决。** `run_id` 条件作为参数下推到选择 latest classification 的相关子查询，因此会在指定 run 内选择该实体最新分类；其他过滤条件仍在外层参数化。对应实现：`src/lib/signalCache.js:260-300`。测试用同一实体、两个 run，并在首个 run 内追加较新分类，验证两个 run 各自返回正确结果：`scripts/test-signal-cache.js:156-173`。
3. **多尾点规范化：已解决。** 尾部表达式由单点改为 `/\.+$/`，确保所有尾点一次清除。对应实现：`src/lib/signalCache.js:84-98`。测试验证 `https://www.brand.example.../` 与原实体归一到同一 ID 和 `brand.example`：`scripts/test-signal-cache.js:90-94`。

## 绑定约束复核

- 追加式中性存储：通过。表名保持 `matrix_*`，证据与分类只有插入路径，无更新/删除路径。
- 域名规范化：通过。scheme、credentials、port、leading `www.`、path、query、fragment 和全部 trailing dots 均被移除。
- 证据可追溯性：通过。`source_url` 与 `retrieved_at` 均有写前非空校验和数据库 `NOT NULL` 约束。
- 事务：通过。四个写接口继续以 `better-sqlite3` transaction 包装写入。
- 正式表零写入：通过。实现模块仅引用 `matrix_*` 表；临时库聚焦测试继续断言 `customers` 行数为零，且无 `crm_messages` 写路径。
- 唯一索引：通过。`matrix_entities(normalized_domain)` 与 `matrix_evidence(entity_id, field, source_url, content_fingerprint)` 保持精确符合简报。
- 既有 smoke：通过。本轮新鲜执行 `npm run verify:smoke`，退出码 0，输出 `SMOKE PASS`。

## 验证证据

- `node scripts/test-signal-cache.js`：退出码 0，输出 `signal-cache tests passed`。
- `npm run verify:smoke`：退出码 0，输出 `SMOKE PASS`。
- `git diff --check ac8af11..4068ffe`：退出码 0。
- `node --check src/lib/signalCache.js`：退出码 0。
- `node --check scripts/test-signal-cache.js`：退出码 0。
- 提交 `4068ffe` 存在，第二轮报告、差异包与工作树实现一致。

## 剩余问题

无本任务范围内的已知阻断问题。白名单是有意的封闭接口；未来若扩展联系人字段或计数器名称，需要同步更新白名单和聚焦测试。

## 蒸馏进度

- 已确认模块：中性存储、版本记录、证据边界、指定 run 查询、域名规范化、事务、索引及正式表隔离。
- 未解决模块：无本任务范围内未解决模块。
- 下一最高优先知识缺口：后续字段扩展时的白名单版本化与兼容策略。

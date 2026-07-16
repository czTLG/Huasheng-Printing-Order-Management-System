# Matrix Phase 1 运行手册

本阶段只做确定性分类、公开证据导入和只读候选查看。它不发送邮件、WhatsApp 或表单消息，也不创建、更新或删除正式 CRM 记录。

## 安全验证

每次运行前，在仓库根目录执行：

```bash
npm run verify:matrix-phase1
```

验证器使用系统临时目录中的独立 SQLite 数据库，初始化完整 schema，并覆盖分类、证据存储、受限导入、当前 CRM 只读适配器和候选 API。它同时确认：

- 允许国家严格为 Vietnam、Thailand、Malaysia、Indonesia、Philippines、Kazakhstan；India 被排除；
- 每个国家最多接受 20 条，每个 run 最多输入 120 条；
- 导入和只读操作不会改写 `customers`、`crm_messages`、`email_messages`、`communication_logs`；
- Matrix 路由没有写接口，相关模块没有交付适配器。

验证器会在结束时删除临时数据库。出现任一断言失败时退出码非零，不得继续导入。

## 当前 CRM 只读干跑

默认命令只输出聚合计数、内部 identity 和源记录 ID：

```bash
node scripts/matrix-classify-current.js
```

它读取 `customers`、`crm_messages`、`email_messages`，不写数据库，也不输出消息正文。若确需本机人工核对联系方式，必须同时满足本地已认证 operator 上下文，并显式使用 `--include-private-preview`；不要把该输出写入工单、聊天或共享日志。

只有需要保留不含私密预览的审计结果时才指定工作区内路径：

```bash
node scripts/matrix-classify-current.js --output ./matrix-current-summary.json
```

`--output` 当前只接受工作区根目录中的普通文件；不能使用 `./tmp/...` 等子目录路径。目标存在时必须仍是单硬链接普通文件。核对完成后按内部留存规则处理该报告，不要把它加入 Git。

输出前后应记录数据库文件校验和；校验和变化即停止操作并调查。

## 公开证据导入 schema

输入文件是 `{ campaign, records }` envelope。campaign 必须显式包含六国非空子集、类别、语言、每国公司上限、每公司页面上限、总 probe 上限、run deadline、允许来源类型、official host allowlist、第三方来源 allowlist、排除词和 existing-domain suppression。每条记录仅允许公开页面可验证的公司字段：

```json
{
  "campaign": {
    "name": "approved-small-run",
    "countries": ["Vietnam"],
    "categories": ["dry_food"],
    "languages": ["en"],
    "max_companies_per_country": 20,
    "max_pages_per_company": 4,
    "max_probes": 80,
    "run_deadline_ms": 60000,
    "allowed_source_types": ["official_website"],
    "official_hosts": ["example.com"],
    "third_party_sources": [],
    "exclusion_terms": ["India"],
    "existing_domain_suppression": true
  },
  "records": [{
    "country": "Vietnam",
    "display_name": "Example Foods",
    "official_url": "https://example.com/",
    "business_email": "sales@example.com",
    "public_contacts": {
      "email": "sales@example.com",
      "phone": "+84 000 000 000",
      "whatsapp": "+84 000 000 000",
      "linkedin_url": "https://www.linkedin.com/company/example",
      "contact_page_url": "https://example.com/contact"
    },
    "product_evidence": ["coffee"],
    "evidence": [
      {
        "source_type": "official_website",
        "field": "product",
        "value": "coffee",
        "source_url": "https://example.com/products",
        "page_title": "Products",
        "retrieved_at": "2026-07-16T00:00:00Z",
        "content_fingerprint": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "confidence": 0.9,
        "extraction_method": "public-page-review"
      }
    ]
  }]
}
```

`display_name`、`official_domain`、`country`、每个持久联系方式和每个 product/application 值都必须有同字段、同值的 evidence；每个 evidence 必须有有限事实字段、HTTP(S) URL、带时区 ISO 检索时间及 `[0,1]` confidence。`content_fingerprint` 如提供，必须是 32–128 位十六进制摘要。含 token、signature、key、auth 等敏感查询键的 URL 会被拒绝。

导入必须使用受控 runner，并提供有效的本地管理员 JWT 上下文：

```bash
MATRIX_LOCAL_OPERATOR_TOKEN=... JWT_SECRET=... npm run matrix:run -- --input ./matrix-run-input.json
```

runner 会从已认证数据库用户派生 actor，创建 run、调用受限 importer、原子写入完成/失败状态、counters、resume cursor 和 aggregate audit events，并打印 `{ run_id, summary }`。生产 transport 保留地址固定、每跳重定向复验、页面/probe/deadline 上限；不得用普通 `fetch` 替代，也不得临时拼接脚本绕过守卫。

## 计数与抽检

`importDiscoveryBatch(...)` 返回内存中的 `summary`，包含以下计数：

- `input`：输入总数，包含随后排除或报错的记录；
- `excluded`：India 等明确排除记录；
- `test`：已知测试或验证伪记录；
- `noise`：系统通知等噪声；
- `needs_review`：证据或身份不足，必须人工复核；
- `valid`：通过当前规则的候选；
- `errors`：URL、证据、国家上限或存储校验失败。

受控 runner 把 run ID 与完整 summary 打印到标准输出，并把同一 summary 与 `resume_cursor` 写入 `matrix_runs.counters_json`；两者必须完全一致。

summary 必须满足 `input = excluded + test + noise + needs_review + valid + errors`。若不相等、任一国家超过 20、总输入超过 120、出现 India 实体，立即停止。

人工抽检至少覆盖每个国家和每个非零分类；每组抽取 10%，不足 10 条时至少 1 条。逐项核对 official domain、证据 URL、检索时间、confidence、分类 reason code，并确认 API 只展示掩码联系方式。`needs_review` 和 `errors` 不得按 valid 使用。

可用只读 SQL 复核：

```sql
SELECT id, status, ruleset_version, created_at
FROM matrix_runs
WHERE id = :run_id;

SELECT s.country, c.classification, COUNT(*) AS count
FROM matrix_classifications c
JOIN matrix_entity_snapshots s ON s.id = c.snapshot_id
WHERE c.run_id = :run_id
GROUP BY s.country, c.classification
ORDER BY s.country, c.classification;

SELECT s.entity_id, s.normalized_domain, s.country, c.classification,
       c.priority, c.reason_json
FROM matrix_classifications c
JOIN matrix_entity_snapshots s ON s.id = c.snapshot_id
WHERE c.run_id = :run_id
ORDER BY s.country, s.entity_id;
```

## 回滚

优先在临时数据库执行整次演练。持久数据库中的 evidence、snapshot、classification 均有 run 归属；应用层 `deleteRun(db, runId)` 在单事务内删除关联行和孤立 identity，不触碰正式 CRM 表。

先备份数据库并确认 `:run_id`，然后在单个事务中仅删除该 run 明确拥有的 Matrix 行：

```sql
BEGIN IMMEDIATE;

SELECT COUNT(*) AS classifications_to_delete
FROM matrix_classifications
WHERE run_id = :run_id;

DELETE FROM matrix_classifications
WHERE run_id = :run_id;

DELETE FROM matrix_evidence WHERE run_id = :run_id;
DELETE FROM matrix_entity_snapshots WHERE run_id = :run_id;

DELETE FROM matrix_runs
WHERE id = :run_id;

COMMIT;
```

不要删除或更新任何非 `matrix_*` 表。只可删除不再被任何 snapshot 引用的孤立 identity；不得按时间或 domain 猜测归属。

## 秘密隔离与交付状态

DNS/HTTP provider 凭据、数据库凭据、JWT、SMTP、邮箱和消息平台秘密只能来自进程环境或受管秘密存储，不能进入导入 JSON、`campaign_json`、evidence、日志、报告或仓库。公开证据数据与正式 CRM 数据使用独立表；私密预览不得持久化到 Matrix 表。

Phase 1 的 delivery 明确不可用：没有邮件或 WhatsApp 发送适配器，没有自动表单提交，没有 Matrix POST/PATCH/DELETE API，也没有最终发送按钮或后台交付任务。任何交付需求都属于后续独立阶段；不得通过现有通用邮件模块旁路实现。

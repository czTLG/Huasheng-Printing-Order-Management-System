# 运行环境快速重建实施计划

> **供自动化执行者使用：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按复选框逐项实施和复核。

**目标：** 建立只读数据审计、安全一致性备份、备份验证和 Ubuntu 新服务器完整重建流程，使私有 Git 仓库配合私密数据包即可恢复系统。

**架构：** 代码与私密业务数据分离。Node.js 工具通过 `better-sqlite3` 只读盘点正式库并使用在线 Backup API 生成一致性快照；清单、校验和与验证结果随数据包保存。部署继续使用 Node.js 22、systemd、Nginx 和 SQLite，不改变旧接口及数据库结构。

**技术栈：** Node.js 22、CommonJS、better-sqlite3、Bash、systemd、Nginx、SHA-256、Markdown。

---

## 文件结构

- 新建 `scripts/runtime-audit.js`：只读盘点数据库、附件、重复文件和缺失引用。
- 新建 `scripts/runtime-backup.js`：生成 SQLite 一致性快照、文件清单和私密数据目录。
- 新建 `scripts/runtime-verify.js`：验证目录或压缩包的校验和、数据库及必要配置。
- 新建 `scripts/test-runtime-rebuild.js`：在临时目录构造数据并验证审计、备份和损坏拒绝行为。
- 新建 `deploy/systemd/runtime-backup.service`：一次性备份服务模板。
- 新建 `deploy/systemd/runtime-backup.timer`：周期执行模板。
- 修改 `package.json`：增加审计、备份、验证和测试命令。
- 修改 `.gitignore`：禁止私密数据包、审计输出和临时恢复目录进入 Git。
- 修改 `.env.example`：补充不含密钥值的备份配置项。
- 修改 `deploy/scripts/bootstrap.sh`：使用锁文件安装、构建前端并提供显式数据恢复门禁。
- 修改 `docs/DEPLOYMENT_FULL_REPRO.md`：改为完整中文重建手册。
- 修改 `README.md`：修正 SQLite 在线备份说明并指向标准手册。

### 任务 1：建立迁移工具测试框架

**文件：**
- 新建：`scripts/test-runtime-rebuild.js`
- 修改：`package.json`

- [ ] **步骤 1：编写失败测试**

测试在 `os.tmpdir()` 下创建隔离项目，生成包含 `users`、`orders`、`work_orders`、`cost_snapshots` 和附件元数据的 SQLite 测试库，并断言：审计不修改源库；备份后核心表数量一致；重复文件被报告；缺失附件被报告；篡改快照后验证失败。

- [ ] **步骤 2：确认测试先失败**

运行：`node scripts/test-runtime-rebuild.js`

预期：因 `runtime-audit.js`、`runtime-backup.js` 和 `runtime-verify.js` 尚不存在而失败，且不访问 `data/app.db`。

- [ ] **步骤 3：增加测试命令**

在 `package.json` 的 `scripts` 中增加：

```json
"test:runtime-rebuild": "node scripts/test-runtime-rebuild.js"
```

- [ ] **步骤 4：提交测试骨架**

```bash
git add scripts/test-runtime-rebuild.js package.json
git commit -m "test: define runtime rebuild safety checks"
```

### 任务 2：实现只读盘点工具

**文件：**
- 新建：`scripts/runtime-audit.js`
- 测试：`scripts/test-runtime-rebuild.js`

- [ ] **步骤 1：实现参数和只读数据库连接**

支持：

```bash
node scripts/runtime-audit.js --db /绝对路径/app.db --root /项目路径 --out /输出目录
```

数据库必须使用：

```js
new Database(dbPath, { readonly: true, fileMustExist: true })
```

禁止执行 `CREATE`、`ALTER`、`UPDATE`、`DELETE`、`VACUUM` 或任何初始化函数。

- [ ] **步骤 2：实现数据库健康和核心统计**

输出 `integrity_check`、`foreign_key_check`、表名、表记录数、关键表最大更新时间、数据库大小及页信息。不得输出表内敏感字段值。

- [ ] **步骤 3：实现文件盘点**

扫描设计文档规定的数据根目录，按流式读取计算 SHA-256。输出完全重复组、数据库引用缺失和未引用候选；默认忽略 `.git`、`node_modules`、前端依赖目录和生成目录。

- [ ] **步骤 4：生成双格式报告**

生成：

```text
runtime-audit.json
runtime-audit.md
```

Markdown 使用中文，明确写出“本次仅审计，未删除任何数据”。

- [ ] **步骤 5：运行隔离测试**

运行：`npm run test:runtime-rebuild`

预期：审计相关断言通过，备份相关断言仍因尚未实现而按测试阶段设计失败。

- [ ] **步骤 6：提交**

```bash
git add scripts/runtime-audit.js scripts/test-runtime-rebuild.js
git commit -m "feat: add read-only runtime data audit"
```

### 任务 3：实现一致性备份工具

**文件：**
- 新建：`scripts/runtime-backup.js`
- 测试：`scripts/test-runtime-rebuild.js`

- [ ] **步骤 1：实现严格参数与安全目录**

支持 `--db`、`--root`、`--out`。输出目录必须位于明确指定位置，临时目录使用 `fs.mkdtemp`，进程启动时设置 `umask 077`。拒绝把输出写进 Git 跟踪路径或源数据目录内部。

- [ ] **步骤 2：使用 SQLite 在线 Backup API**

通过 `better-sqlite3` 的 `backup()` 生成 `database/app.db`。备份失败时退出非零，不允许回退为 `cp`。

- [ ] **步骤 3：复制明确允许的数据文件**

仅复制设计中允许的配置、上传目录和数据库实际引用的附件。路径必须标准化并校验仍处于项目允许根目录内，拒绝 `..` 路径逃逸和符号链接越界。

- [ ] **步骤 4：生成清单和校验和**

生成 `manifest.json`、`checksums.sha256` 和初始 `verification.json`。清单包含 Git 提交号、格式版本、文件数量、总容量、核心表统计和缺失文件列表，不包含密钥值或敏感记录正文。

- [ ] **步骤 5：原子完成**

先在临时目录生成；验证成功后，将目录原子重命名为 `runtime-data-YYYYMMDD_HHMMSS`。任何失败都清理临时目录且不影响既有健康备份。

- [ ] **步骤 6：运行测试并提交**

运行：`npm run test:runtime-rebuild`

预期：正常备份及数据数量断言通过，验证工具相关断言仍待下一任务完成。

```bash
git add scripts/runtime-backup.js scripts/test-runtime-rebuild.js
git commit -m "feat: create consistent private data bundles"
```

### 任务 4：实现独立验证工具

**文件：**
- 新建：`scripts/runtime-verify.js`
- 测试：`scripts/test-runtime-rebuild.js`

- [ ] **步骤 1：验证数据包结构和校验和**

拒绝缺少 `manifest.json`、`checksums.sha256`、`database/app.db` 或必要配置的数据包。重新计算每个文件 SHA-256，并拒绝额外的未登记文件和路径逃逸。

- [ ] **步骤 2：验证数据库**

只读打开快照，要求 `integrity_check=ok`、必要表存在、核心表记录数与清单一致，并输出外键异常数量。

- [ ] **步骤 3：写入验证结果**

成功时把状态、时间和各检查结果写入 `verification.json`；失败时退出非零并写明失败项目，不把损坏数据包标记为健康。

- [ ] **步骤 4：运行全部测试**

运行：`npm run test:runtime-rebuild`

预期：全部通过，包括篡改文件、缺失文件和损坏数据库必须被拒绝。

- [ ] **步骤 5：提交**

```bash
git add scripts/runtime-verify.js scripts/test-runtime-rebuild.js
git commit -m "feat: verify runtime recovery artifacts"
```

### 任务 5：增加命令入口和 Git 防泄漏规则

**文件：**
- 修改：`package.json`
- 修改：`.gitignore`
- 修改：`.env.example`

- [ ] **步骤 1：增加操作命令**

在 `package.json` 增加：

```json
"runtime:audit": "node scripts/runtime-audit.js",
"runtime:backup": "node scripts/runtime-backup.js",
"runtime:verify": "node scripts/runtime-verify.js"
```

- [ ] **步骤 2：阻止私密产物进入 Git**

忽略 `archives/runtime-*`、`runtime-data-*`、`runtime-audit.*`、恢复临时目录、数据库快照和本地密钥文件，同时不得忽略安全脚本、模板及文档。

- [ ] **步骤 3：补充安全配置模板**

在 `.env.example` 中只增加变量名与无敏感默认值，例如备份输出目录、保留周期和异地同步开关；不得写入实际邮箱密码或令牌。

- [ ] **步骤 4：验证并提交**

运行：

```bash
npm run test:runtime-rebuild
git check-ignore -v archives/runtime-private/test.db
git diff --check
```

```bash
git add package.json package-lock.json .gitignore .env.example
git commit -m "chore: add safe runtime recovery commands"
```

### 任务 6：增加 systemd 自动备份模板

**文件：**
- 新建：`deploy/systemd/runtime-backup.service`
- 新建：`deploy/systemd/runtime-backup.timer`

- [ ] **步骤 1：创建一次性服务模板**

服务使用应用用户运行，设置严格 `UMask=0077`，调用仓库中的 `runtime-backup.js`。禁止在单元文件中写入密钥。

- [ ] **步骤 2：创建定时器模板**

使用 `OnCalendar=hourly`、`Persistent=true` 和随机延迟，确保服务器关机期间错过的任务在启动后补跑。

- [ ] **步骤 3：验证单元文件**

运行：

```bash
systemd-analyze verify deploy/systemd/runtime-backup.service deploy/systemd/runtime-backup.timer
```

预期：没有语法错误；模板占位路径在安装前由部署流程替换。

- [ ] **步骤 4：提交**

```bash
git add deploy/systemd/runtime-backup.service deploy/systemd/runtime-backup.timer
git commit -m "ops: add scheduled runtime backup units"
```

### 任务 7：完善新服务器初始化脚本

**文件：**
- 修改：`deploy/scripts/bootstrap.sh`
- 测试：`scripts/test-runtime-rebuild.js`

- [ ] **步骤 1：增加预检与幂等性**

检查支持的 Ubuntu 版本、非 root 应用用户、仓库路径、Node 22、锁文件、部署模板和数据恢复状态。重复运行不得删除现有数据或重置密钥。

- [ ] **步骤 2：使用锁定依赖和前端构建**

后端和 `frontend-next` 使用 `npm ci`，然后执行前端构建。构建失败不得重启当前服务。

- [ ] **步骤 3：加入显式恢复门禁**

没有健康私密数据包时，默认只安装应用，不自动创建一套看似可用的空生产库。恢复必须先运行 `runtime-verify.js`，再由操作者明确确认。

- [ ] **步骤 4：安全安装服务和 Nginx**

渲染应用用户、项目路径和 Node 路径；先执行配置检查，再重载服务。Node 仅监听反向代理需要的地址，防火墙说明只开放 SSH、80、443。

- [ ] **步骤 5：验证并提交**

运行：

```bash
bash -n deploy/scripts/bootstrap.sh
npm run test:runtime-rebuild
```

```bash
git add deploy/scripts/bootstrap.sh scripts/test-runtime-rebuild.js
git commit -m "ops: harden reproducible server bootstrap"
```

### 任务 8：编写完整中文重建手册

**文件：**
- 修改：`docs/DEPLOYMENT_FULL_REPRO.md`
- 修改：`README.md`

- [ ] **步骤 1：重写标准手册**

按设计文档第 13 节完整覆盖：迁移变量、只读审计、原始快照、私密数据包、安全传输、Ubuntu 初始化、依赖安装、前端构建、配置恢复、systemd、Nginx、防火墙、DNS、HTTPS、最终停写、切换、验收、回滚、自动备份、恢复演练和故障排查。

- [ ] **步骤 2：加入一页式快速重建清单**

快速清单中的每个命令必须引用手册前面已经解释的变量。危险步骤必须标注停机条件和回滚点，不能提供直接覆盖运行中数据库的命令。

- [ ] **步骤 3：修正 README**

明确：停机数据库可以复制；运行中数据库必须使用 SQLite 在线备份机制。README 只保留摘要，并链接到标准手册。

- [ ] **步骤 4：文档自检并提交**

运行：

```bash
rg -n 'YOUR_|TBD|TODO|直接复制.*运行|cp .*app.db' docs/DEPLOYMENT_FULL_REPRO.md README.md
git diff --check
```

所有示例变量必须在手册开头定义；不得出现真实密码、令牌或私钥。

```bash
git add docs/DEPLOYMENT_FULL_REPRO.md README.md
git commit -m "docs: add Chinese full reconstruction runbook"
```

### 任务 9：在生产库上执行只读审计

**文件：**
- 生成但不提交：`archives/runtime-audit-时间戳/`

- [ ] **步骤 1：确认没有写入动作**

记录执行前数据库大小、修改时间和 SHA-256。审计输出放入被 Git 忽略的目录。

- [ ] **步骤 2：运行审计**

```bash
npm run runtime:audit -- --db "$PWD/data/app.db" --root "$PWD" --out "$PWD/archives/runtime-audit-$(date +%Y%m%d_%H%M%S)"
```

- [ ] **步骤 3：验证生产库未改变**

重新记录数据库大小、修改时间和 SHA-256；三者应与执行前一致。检查报告仅包含统计、路径和哈希，不包含敏感业务正文。

- [ ] **步骤 4：人工评审候选项**

把候选分为“明确可清理”“需要业务确认”“禁止清理”。本实施计划不执行删除；如需清理，另行设计带白名单和恢复点的独立计划。

### 任务 10：最终综合验证

**文件：**
- 检查全部新增和修改文件

- [ ] **步骤 1：运行专项测试**

```bash
npm run test:runtime-rebuild
```

预期：全部通过。

- [ ] **步骤 2：运行项目既有验证**

```bash
npm run lint
npm run build
npm run verify:smoke
```

预期：全部通过；若项目不存在某命令，应使用 `package.json` 中对应的现有命令，并在验证记录中说明。

- [ ] **步骤 3：做一次临时目录恢复演练**

对测试数据包执行“备份—校验—恢复到新目录—只读打开—核心表计数检查”，不得覆盖 `data/app.db`。

- [ ] **步骤 4：检查敏感文件和工作区**

```bash
git status --short
git ls-files | rg 'app\.db|runtime-data|\.env$|private|secret'
git diff --check
```

预期：Git 未跟踪数据库、私密数据包、真实 `.env` 或审计输出。

- [ ] **步骤 5：提交最终验证修正**

仅在确有修正时提交相关文件，不提交生产审计结果或私密备份。


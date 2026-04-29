# AI Studio Frontend Rebuild Package

用途：导入 AI Studio，用于包装工厂管理系统前端重构。

## 包内文件

- `README.md`：导入顺序与拆分原则。
- `frontend/README.md`：建议的前端目录、页面、组件、状态拆分。
- `backend/README.md`：后端边界、权限边界、禁止改动项。
- `docs/API_SPEC.md`：完整接口规范、权限说明、关键对象结构。
- `mocks/mock-data.json`：覆盖页面、表单、订单、按钮状态、流程节点的 Mock JSON。
- `legacy/public/index.html`：旧版主前端页面，仅作为 UI/交互/字段参考。
- `legacy/public/mobile.html`：旧版移动端页面，仅作为参考。

## 不包含

- 不包含 `data/app.db` 或任何线上数据库。
- 不包含 `node_modules`。
- 不包含 `.git`、部署密钥、环境变量。
- 不包含真实业务导入数据。

## AI Studio 重构要求

- 前端只依赖 `docs/API_SPEC.md` 和 `mocks/mock-data.json`。
- 先实现页面结构、权限菜单、订单流程、搜索/筛选面板、紧凑模式。
- 不新增旧版后端接口筛选能力。
- 不修改接口返回数据内容。
- 权限展示以前端控制为体验优化，后端仍是最终安全边界。

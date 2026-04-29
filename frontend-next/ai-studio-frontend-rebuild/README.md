# AI Studio 前端重构导入骨架

该目录用于后续 AI Studio 重构，不替换现有运行目录，避免影响旧版系统。

## 目录职责

```text
ai-studio-export/
  frontend/    # 前端页面、组件、样式、状态管理、Mock 接入说明
  backend/     # 后端接口契约、权限、数据库边界说明
mocks/
  mock-data.json
docs/
  API_SPEC.md
```

## 拆分原则

- 前端只依赖 REST API 与 Mock JSON，不直接读取数据库、不复用后端业务函数。
- 后端继续保留 `src/routes`、`src/services`、`src/db.js` 的运行结构，不迁移真实业务数据。
- 权限以 `/api/auth/me` 返回的用户角色和 `permissions` 为准，前端只做展示控制，后端继续做最终拦截。
- 订单流程节点固定为 `印刷 -> 复膜 -> 制袋 -> 发货 -> 完成`，回退仅走已有 API。

## 导入顺序

1. 将 `docs/API_SPEC.md` 作为接口契约导入。
2. 将 `mocks/mock-data.json` 作为 Mock 数据源导入。
3. 按 `frontend/README.md` 生成页面与组件。
4. 联调时用真实 API 替换 Mock，不能新增旧版接口依赖。

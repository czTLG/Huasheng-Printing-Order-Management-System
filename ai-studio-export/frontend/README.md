# Frontend Skeleton

建议前端拆分：

```text
src/
  app/
    routes/                 # 页面路由
    permissions/            # 菜单与按钮权限映射
  pages/
    orders/                 # 订单管理、筛选面板、紧凑模式
    work-orders/            # 开单管理
    board/                  # 生产看板
    cost/                   # 成本核算
    quotes/                 # 报价与报价单
    admin/                  # 权限管理
  components/
    layout/
    table/
    forms/
    workflow/
  services/
    apiClient.ts            # token、错误处理、请求封装
    ordersApi.ts
    workOrdersApi.ts
    costApi.ts
    authApi.ts
  mocks/
    mock-data.json
  styles/
    tokens.css
    density.css
```

## UI 状态

- `filterPanel.visible` 控制搜索/筛选面板显示隐藏。
- `compactMode` 控制页面密度，只影响 UI 间距与非关键信息展示，不修改接口参数。
- `buttonState` 由角色、订单状态、本人负责工序共同计算。
- 搜索先保留 `q/status/roller/urgent/stay/day/data/sort` 这些现有字段，不新增后端筛选能力。

## 必保留页面

- 订单管理：列表、详情、流程按钮、订阅、图片、筛选面板、紧凑模式。
- 开单管理：客户/商品搜索、表单、预览、导出、邮件。
- 生产看板：工序筛选、密度切换、统计区、全屏。
- 成本核算：材料价格、成本计算、快照、导出/邮件。
- 权限管理：用户审批、权限模块、活动日志。

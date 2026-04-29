# Backend Boundary

现有后端保持运行兼容：

```text
src/
  server.js                 # Express 入口、静态文件、路由挂载
  db.js                     # SQLite 初始化与兼容补列，禁止迁移真实业务数据
  middleware/auth.js        # JWT 鉴权、角色拦截
  routes/                   # REST API
  services/                 # 报价等业务服务
```

## 不允许变更

- 不迁移线上数据库。
- 不删除旧字段、旧表、旧导入数据。
- 不改变 `src/server.js` 的生产启动方式。
- 不把前端 Mock 写入真实数据库。

## 后续可拆分方向

- `routes` 只保留 HTTP 参数解析和响应。
- `services` 承载业务流程、按钮状态、流程节点判断。
- `repositories` 承载数据库查询，但第一阶段只新增封装，不改 SQL 语义。
- `schemas` 承载入参校验，保持兼容旧字段别名。

## 权限要求

后端必须继续做最终权限校验。前端隐藏菜单或按钮只能改善体验，不能作为安全边界。

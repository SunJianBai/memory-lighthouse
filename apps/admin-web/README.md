# 守忆灯塔管理中心

独立 Vue 3 管理端，部署基路径为 `/openBMB/admin/`，API 默认使用同源的 `/openBMB/api/v1`。

## 运行

```powershell
npm install
npm run dev --workspace @memory-lighthouse/admin-web
npm run build --workspace @memory-lighthouse/admin-web
```

默认构建不会包含可访问的原文检查入口。开发期需要同时显式启用前后端：

```powershell
npm run dev:inspection --workspace @memory-lighthouse/admin-web
```

服务端仍必须处于 `NODE_ENV=development` 且设置 `ENABLE_DEVELOPMENT_CONTENT_INSPECTION=true`；前端开关不能绕过服务端授权、同意、双人审批与审计策略。`build:inspection` 仅适合隔离的开发验证环境，禁止作为生产制品。

访问令牌只保存在页面内存中，刷新令牌由 server-api 通过 HttpOnly Cookie 管理。原文不会写入 localStorage/sessionStorage，显示后 60 秒自动清屏。

## 模板来源

信息架构与管理壳层参考本机 `art-design-clean` 模板（MIT），但本应用没有运行时依赖该目录，也不会修改模板源文件。为避免把模板的演示依赖带入项目，只保留了 Vue Router 和自有 CSS 设计令牌。许可证说明见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

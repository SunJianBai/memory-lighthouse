# 实施状态

最后更新：2026-08-01

## 目标环境

```text
SSH: TX4H4G (ubuntu@124.220.81.104)
用户 Web:  https://sun227454.online/openBMB/
管理员:    https://sun227454.online/openBMB/admin/
REST/WSS:  https://sun227454.online/openBMB/api/v1/
LiveKit:   wss://rtc.sun227454.online/（媒体端口不属于 HTTP path 路由）
```

服务器初始审计：Ubuntu 24.04、4 vCPU、约 4GB RAM、约 14GB 可用磁盘，Docker/Compose 已安装。部署必须设置内存、日志和对象保留限制，并保留现有 80 端口服务。

## 已确认产品决策

- 一个用户 Web、一个原生 Android App，按权限和设备模式显示页面。
- 家属使用邮箱/用户名密码；创建家庭和激活设备前验证邮箱。
- 一台陪伴设备只绑定一位陪伴对象。
- 设备通过二维码或动态码认领，再由家属批准。
- 远程陪伴默认现场接听，不提供静默接入。
- 远程家属通话默认永不录音、录像或转写。
- 用户与 MiniCPM-o 的语音原文通过单独授权的 ASR Adapter 获取。
- 家庭角色采用 OWNER / CAREGIVER / VIEWER，并增加陪伴对象级高风险权限。
- 允许部署 Redis、MinIO 和自托管 LiveKit。
- 开发环境允许经 Inspection Grant 查看记忆与 AI 对话原文；生产默认硬关闭。

## 里程碑

| 里程碑 | 状态 | 验证证据 |
| --- | --- | --- |
| M0 文档、领域模型、ER、接口与路线 | 完成 | Prisma 7.9.1 validate；6 张 Mermaid 图渲染；29 项旧测试通过 |
| M1 工作区与服务器/基础设施骨架 | 完成 | npm workspace；Nest live/ready；Prisma 62 表迁移；MySQL/Redis/MinIO/LiveKit 本地健康检查通过 |
| M2 Auth、Household、权限、设备激活、Consent | 完成 | 邮箱/用户名认证、Refresh Rotation、家庭/对象级权限、双阶段设备激活、独立 Consent 均已实现并纳入回归 |
| M3 Memory、Routine、Event、Task、模型控制面 | 完成 | 可信记忆、对象存储、日程实例、事件/待办、MiniCPM 会话与到期原文清除已接入真实 API |
| M4 用户 Web 与管理员 Web | 进行中 | 两个独立 Web 已实现；待统一锁文件和完整生产路径构建 |
| M5 原生 Android | 进行中 | Kotlin/Compose 统一客户端正在迁移 MiniCPM-o、设备激活与 LiveKit 现场接听能力 |
| M6 LiveKit、ASR 与全链路安全测试 | 进行中 | 现场接听、最小 LiveKit Grant、AI/家属媒体原子切换、开发期双人检查授权已完成；待双端公网联调 |
| M7 TX4H4G 部署与公网验证 | 未开始 | 待补 |

## 当前策略

原 React Demo 已保留 `demo-baseline-20260801` 标签并迁入 `apps/client-web`。当前按 `server-api`、`admin-web`、`client-web`、`client-android` 四个独立产物进行构建和部署。

## 已完成的实施证据

- 创建 `demo-baseline-20260801` 标签保留单机演示回退点。
- NestJS 使用 `/openBMB/api/v1` 全局前缀、环境校验、Helmet、CORS、输入白名单、优雅关停及数据库 readiness。
- Prisma 7.9.1 实施 schema 包含 62 个模型、camelCase 应用字段与 snake_case 映射；初始迁移与内置角色迁移已在独立 MySQL 8.4 实际应用。
- 本地 Compose 的 MySQL、Redis ACL、MinIO 私有版本化 Bucket 与最小权限账号、LiveKit/Redis 均达到 healthy；`infra/scripts/verify-local-stack.ps1` 回归通过。
- 修复并锁定两个真实基础设施问题：Redis Alpine 镜像改用自带 `setpriv` 降权；数据服务增加仅用于回环端口发布的 `host_access` bridge，同时继续通过 `openbmb_private` 隔离服务数据流。
- 服务端完整质量门通过：50 个测试套件、178 个单元/集成测试、5 个真实 HTTP E2E、ESLint、Nest 生产构建和生产依赖审计（0 漏洞）。
- 家属来电在 AI 陪伴时保持响铃；只有设备现场接受后，Redis 媒体租约才从 `AI_COMPANION` 原子切换为 `REMOTE_ASSISTANCE`，并在数据库事务中结束模型会话。
- 对话原文到期后清除密文、Nonce、密钥标识和内容哈希，仅保留时序/字数等非敏感元数据；开发期检查接口拒绝读取已到期或已清除内容。

## 已知环境缺口

- 当前工作站没有已连接的 Android 真机；先完成单元、instrumented 构建和 APK，硬件验收在设备接入后执行。
- TX4H4G 内存和磁盘余量有限，LiveKit 仅承诺单家庭开发验收容量。
- `rtc.sun227454.online` 的 DNS 与腾讯云安全组端口仍需在 RTC 公网联调前配置；HTTP 页面和 API 不受此项阻塞。
- SMTP、Android Push 等第三方凭据尚未提供；先实现 Adapter 和本地可验证替代。

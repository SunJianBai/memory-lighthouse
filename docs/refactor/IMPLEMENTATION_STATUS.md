# 实施状态

最后更新：2026-08-01

## 目标环境

```text
SSH: TX4H4G (ubuntu@124.220.81.104)
用户 Web:  https://sun227454.online/openBMB/
管理员:    https://sun227454.online/openBMB/admin/
REST/WSS:  https://sun227454.online/openBMB/api/
LiveKit:   https://sun227454.online/openBMB/rtc/
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
| M1 工作区与服务器/基础设施骨架 | 进行中 | 待补 |
| M2 Auth、Household、权限、设备激活、Consent | 未开始 | 待补 |
| M3 Memory、Routine、Event、Task、模型控制面 | 未开始 | 待补 |
| M4 用户 Web 与管理员 Web | 未开始 | 待补 |
| M5 原生 Android | 未开始 | 待补 |
| M6 LiveKit、ASR 与全链路安全测试 | 未开始 | 待补 |
| M7 TX4H4G 部署与公网验证 | 未开始 | 待补 |

## 当前策略

根目录 React Demo 暂时保留为可演示基线。先新增 `apps/server-api`、`apps/admin-web`、`apps/client-android`、`infra` 和 `packages/contracts`；Auth/Household/Activation Interface 稳定后，再把根 React 工程迁入 `apps/client-web`。

## 已知环境缺口

- 当前工作站没有已连接的 Android 真机；先完成单元、instrumented 构建和 APK，硬件验收在设备接入后执行。
- TX4H4G 内存和磁盘余量有限，LiveKit 仅承诺单家庭开发验收容量。
- SMTP、Android Push 等第三方凭据尚未提供；先实现 Adapter 和本地可验证替代。


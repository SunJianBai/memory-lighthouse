# 实施状态

最后更新：2026-08-02

## 目标环境

```text
SSH: TX4H4G (ubuntu@124.220.81.104)
用户 Web:  https://sun227454.online/openBMB/
管理员:    https://sun227454.online/openBMB/admin/
REST:      https://sun227454.online/openBMB/api/v1/
LiveKit:   wss://sun227454.online（SDK 使用标准 /rtc/v1；媒体端口不经过 HTTP 路由）
```

服务器初始审计为 Ubuntu 24.04、4 vCPU、3.6 GiB RAM、约 1.9 GiB swap、约 15 GiB 可用磁盘，Docker 29.1.3 与 Compose 2.40.3 已安装；镜像暂存会占用部分余量，最终数值以每次部署前预检为准。CampusHub 仍占用公网 80 端口并保持运行。

## 已确认产品决策

- 一个用户 Web、一个原生 Android App，按权限和设备模式显示页面。
- 家属使用邮箱/用户名密码；创建家庭和激活设备前验证邮箱。
- 一台陪伴设备只绑定一位陪伴对象。
- 设备通过二维码或动态码认领，再由家属批准。
- 远程陪伴默认现场接听，不提供静默接入。
- 远程家属通话默认永不录音、录像或转写。
- 仅在独立转写授权开启且 Provider/ASR 实际返回最终用户文本时保存语音原文；不从模型回复反推或伪造。
- 家庭角色采用 OWNER / CAREGIVER / VIEWER，并增加陪伴对象级高风险权限。
- 允许部署 Redis、MinIO 和自托管 LiveKit。
- 开发环境允许经 Inspection Grant 查看记忆与 AI 对话原文；生产默认硬关闭。

## 里程碑

| 里程碑 | 状态 | 验证证据 |
| --- | --- | --- |
| M0 文档、领域模型、ER、接口与路线 | 完成 | Prisma 7.9.1 validate；6 张 Mermaid 图渲染；`demo-baseline-20260801` 回退标签及完整领域/接口文档 |
| M1 工作区与服务器/基础设施骨架 | 完成 | npm workspace；Nest live/ready；Prisma 64 个模型、17 个迁移；MySQL 8.4.8 空库 17/17 migrate deploy、Redis/MinIO/LiveKit 本地健康检查通过 |
| M2 Auth、Household、权限、设备激活、Consent | 完成 | 邮箱/用户名认证、Refresh Rotation、家庭/对象级权限、双阶段设备激活、独立 Consent 均已实现并纳入回归 |
| M3 Memory、Routine、Event、Task、模型控制面 | 完成 | 可信记忆、对象存储、日程实例、事件/待办、MiniCPM 会话与到期原文清除已接入真实 API |
| M4 用户 Web 与管理员 Web | 完成 | React 统一角色 Web 与 Vue 3 管理端均已完成类型检查、生产构建、权限/能力门控和真实 API 接入；隐私中心向当前家庭 OWNER 展示管理员访问类别、原因、时间及独立已读状态 |
| M5 原生 Android | 源码与构建完成 | Kotlin/Compose 单 APK 已实现角色切换、认证、家庭/记忆/日程/Consent、不可导出设备密钥激活、MiniCPM-o 与 LiveKit；强制重跑 53 个 Gradle 任务全部成功，11 suites/40 tests、Lint 0 errors、Debug APK 均通过，运行时与媒体能力仍待真机验收 |
| M6 LiveKit、ASR 与全链路安全测试 | 自动化完成，外部验收待办 | 最小 LiveKit Grant、唯一 session-wide 建房 owner、一次性票据 saga、AI/远程媒体原子切换、现场接听、终态删房屏障、远程通话不录制/不转写和开发检查授权均已实现；独立并发复核未发现剩余 P1/P2。Android 真机及双公网设备 RTC 尚未验收。ModelBest 当前协议不提供用户转写，系统不会伪造 USER/ASR 原文 |
| M7 TX4H4G 部署与公网验证 | 进行中 | 生产 Compose/Caddy、服务器 secrets、不可变发布和自动 CD 已配置，CampusHub 未受影响；改用私有 GHCR 摘要固定与服务器本地镜像清单双重校验，stage-only 运行状态以 [Production delivery](https://github.com/SunJianBai/memory-lighthouse/actions/workflows/production-delivery.yml) 为准。真实 SMTP 未配置，尚未激活或切换公网 |

## 当前策略

原 React Demo 已保留 `demo-baseline-20260801` 标签并迁入 `apps/client-web`。当前按 `server-api`、`admin-web`、`client-web`、`client-android` 四个独立产物进行构建和部署。

## 已完成的实施证据

- 创建 `demo-baseline-20260801` 标签保留单机演示回退点。
- NestJS 使用 `/openBMB/api/v1` 全局前缀、环境校验、Helmet、CORS、输入白名单、优雅关停及数据库 readiness。
- Prisma 7.9.1 实施 schema 包含 64 个模型、camelCase 应用字段与 snake_case 映射；17 个迁移已在干净 MySQL 8.4.8 全量应用并与实现 schema 做严格零差异校验，文档物理模型也由 CI 做等价 diff；尚未对 TX4H4G 执行生产迁移。
- 本地 Compose 的 MySQL、Redis ACL、MinIO 私有版本化 Bucket 与最小权限账号、LiveKit/Redis 均达到 healthy；`infra/scripts/verify-local-stack.ps1` 回归通过。
- 修复并锁定两个真实基础设施问题：Redis Alpine 镜像改用自带 `setpriv` 降权；数据服务增加仅用于回环端口发布的 `host_access` bridge，同时继续通过 `openbmb_private` 隔离服务数据流。
- 服务端完整质量门通过：70 个测试套件、379 个单元/集成测试、2 个 E2E 套件/6 个真实 HTTP E2E、ESLint 与 Nest 生产构建。Client Web 为 12 文件/75 测试，Admin Web 为 3 文件/8 测试，两端 typecheck/build、检查版管理端构建及两套契约 check/build 均通过。
- 管理员每次成功读取开发期原文时，`ContentInspection`、哈希链审计、站内通知和所有当时 ACTIVE OWNER 的独立回执在同一事务中写入；通知失败会阻断原文返回，家庭接口不暴露管理员、资源、授权、请求或工单标识。
- 生产交付按 GHCR registry digest 拉取并在 TX4H4G 写入独立的 transport/local-ID 清单；`current` 栈指针先于基础设施持久化，`current-app` 只在应用健康后切换。备份采用 partial 目录、根清单摘要完成标记和信号/systemd 双重 API 恢复，6 类隔离故障注入通过。
- 家属来电在 AI 陪伴时保持响铃；只有设备现场接受后，Redis 媒体租约才从 `AI_COMPANION` 原子切换为 `REMOTE_ASSISTANCE`，并在数据库事务中结束模型会话。
- 首张远程 Join Ticket 采用显式 `FOR UPDATE` 选择唯一 `PROVISIONING` owner；LiveKit RPC 位于两个短事务之间，只有 `room_provisioned_at + ROOM_READY` 提交后才签 JWT。并发签票、迟到 CreateRoom、终止、撤权、清理、连接超时和 P2034 死锁重试均有确定性回归。
- 设备刷新凭据与不可导出安装密钥做 PoP 绑定；即使攻击者取得已轮换的旧凭据字符串，没有安装私钥也不能触发整族撤销。
- 对话原文到期后清除密文、Nonce、密钥标识和内容哈希，仅保留时序/字数等非敏感元数据；开发期检查接口拒绝读取已到期或已清除内容。

## 已知环境缺口

- Android 单元测试、Lint、Debug APK 构建和 CI 产物已经完成；当前没有已连接真机，摄像头、麦克风、后台释放及真实 RTC 仍需硬件验收。
- 当前 Debug APK 为 `121,410,199` bytes，SHA-256 `DA3562B710E8558BF1E22BF0ADD43E2FDAF4E55923639B4041820E8FA88D6CBA`；体积优化与 41 条非阻断 Android Lint warning 不影响本轮功能验收。
- TX4H4G 内存和磁盘余量有限，LiveKit 仅承诺单家庭开发验收容量。
- LiveKit 信令复用根域 `sun227454.online/rtc/v1`，无需新增 RTC DNS；腾讯云安全组是否已开放 `7881/TCP`、`7882/UDP`、`3478/UDP` 仍待确认。
- 真实 SMTP 凭据尚未提供，是生产注册、验证和密码重置流程及公网切流的明确阻塞项。当前来电通知采用已认证轮询，Android Push 仅是可选后续增强。
- 生产私网 ClamAV 节点尚未提供；资产扫描 Adapter 与失败隔离已实现，但公网生产激活必须继续保持 `PRODUCTION_DEPLOY_ENABLED=false`，直至 SMTP、ClamAV、RTC 安全组与真机双端验收完成。

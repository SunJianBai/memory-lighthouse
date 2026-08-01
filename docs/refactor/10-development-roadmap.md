# 开发计划与验收

## 1. 现实工期

四个部署物加认证、设备身份、远程音视频和隐私审计，即使已有 Demo，也不是简单页面拆分。单人完成可维护版本建议 8～10 周；3～4 人并行可压缩到约 4～6 周。赛事官网目前显示 2026-08-17 提交截止，因此比赛版必须以闭环、稳定和复现优先。[赛事官网](https://ascend.openbmb.cn/)

最终排期取决于[待确认事项 Q6](./11-open-questions.md)。

## 2. 工作流依赖

```text
架构/契约/基础设施
        ↓
身份与 Household ──────────────┐
        ↓                       │
设备激活与 Consent              │
        ↓                       │
Memory/Routine/Event 闭环        │
        ↓                       │
MiniCPM-o Companion             │
        ↓                       │
Remote Assistance + LiveKit     │
        ↓                       │
管理员检查/运维/全链路验收  ◀────┘
```

Web、Android 和 Admin 可以在 OpenAPI 固定后并行，但不能在服务器授权模型未定时各自发明数据结构。

## 3. 完整产品路线（8 个 Sprint）

每个 Sprint 按一周估算；小团队可按两周 Sprint 合并。

### Sprint 0：工程和契约

- 建立四个 App、CI、Compose、本地证书和环境配置。
- Prisma 初始 migration、Seed、OpenAPI、错误码和事件 Schema。
- 请求上下文、审计、结构化日志、Feature Flag、测试容器。
- 迁移当前规则行为测试。

出口：空环境一键启动；CI 可迁移空库并完成健康检查。

### Sprint 1：身份、家庭和权限

- 注册、邮箱验证、用户名、登录、刷新轮换、登出和密码重置。
- Household、Member、角色、Recipient Member、Care Authority。
- 用户 Web/Android 登录和家庭切换。
- 管理员独立认证壳。

出口：跨家庭资源 ID 枚举全部被拒；旧 Refresh Token 重放撤销令牌族。

### Sprint 2：设备激活与 Consent

- Device Installation 和设备密钥。
- 二维码、动态码、Claim、家属批准、Device Credential 和撤销。
- Android Keystore、WebCrypto、设备心跳和陪伴模式锁定。
- Consent 当前投影、事件历史和撤回传播。

出口：激活只使用一次；解绑或撤权使设备和会话立即失效。

### Sprint 3：可信资料和日程闭环

- Care Recipient、Contact、Memory Revision、Tag、Medication。
- MinIO 上传意图、扫描、预签名访问和两阶段删除。
- Routine、Schedule、Occurrence Worker、Confirmation、Care Event、Family Task。
- 家属 Web/Android 核心管理页面。

出口：完成“录入 → 到点 → 提醒 → 本人确认/超时 → 家属处理”闭环。

### Sprint 4：MiniCPM-o 陪伴

- Care Snapshot、Prompt Version、Agent Action 和 Provider Adapter。
- Web Realtime Runtime 迁移。
- Android CameraX/Audio/ModelBest 迁移。
- Model Session、Utterance、Memory Usage 和可用转写。
- Replay、ModelBest、Ascend 三种 Adapter 的一致行为。

出口：真实模型和 Replay 都不绕过确定性业务状态机；媒体完全释放。

### Sprint 5：远程陪伴

- LiveKit 自托管、Token、Webhook 和房间清理。
- Remote Access Policy、会话状态机、Redis 媒体租约。
- Web/Android 家属呼叫和陪伴接听页面。
- Android Core-Telecom、CallStyle、Foreground Service。
- MediaSessionCoordinator 与模型互斥。

出口：四种端组合和强制 TURN 通过；默认不录制；授权撤回立即结束。

### Sprint 6：管理员和通知

- Art Design Dashboard、用户、家庭、设备、模型/远程会话和审计页面。
- Development Content Auditor、Inspection Grant、水印和逐条原文查看。
- 站内、邮件和 Android Push Endpoint；Outbox/BullMQ 重试。
- 家庭隐私中心显示授权、设备和管理员访问历史（待确认）。

出口：原文访问全部审计；生产环境检查 Interface 不存在。

### Sprint 7：稳定、部署和材料

- 性能、安全、弱网、恢复、数据保留和兼容性测试。
- MySQL/MinIO 备份恢复演练。
- Ascend Provider 复现、固定版本和启动脚本。
- 一镜到底 Demo、PPT、视频、README 和故障降级。
- Android Release 签名、Web 构建和部署 Runbook。

出口：全新机器可按说明运行，主流程有自动化冒烟和录屏保底。

## 4. 比赛压缩版建议

若硬截止仍是 2026-08-17，建议只承诺以下垂直切片：

1. NestJS + MySQL + Redis + MinIO 可一键启动。
2. 邮箱/用户名登录、一个家庭、一个陪伴对象。
3. 动态码和二维码两阶段激活。
4. 家属 Web 完成 Memory/Routine/Event/Task 管理。
5. Android 同一个包内完成陪伴模式和基础家属查看。
6. MiniCPM-o Android 真机全双工主演示，Web 作为备用。
7. LiveKit 完成家属 Web → 陪伴 Android 主组合；其他组合列为产品版验收。
8. 管理员查看用户、设备、模型会话及经审计的文字原文。
9. Replay 保底、Ascend 复现说明、视频和答辩材料。

不得为了“页面齐全”牺牲模型主流程、设备解绑和摄像头/麦克风释放。

## 5. 工作分解

| 编号 | 工作 | 依赖 | 主要产物 |
| --- | --- | --- | --- |
| BE-01 | NestJS/Prisma 基础与 migration | 无 | server-api |
| BE-02 | Auth/Session/邮箱验证 | BE-01 | Identity Module |
| BE-03 | Household/Authority | BE-02 | Household Module |
| BE-04 | Device Activation/Credential | BE-03 | Device Module |
| BE-05 | Consent/Memory/Asset | BE-03 | 资料 Modules |
| BE-06 | Routine/Occurrence/Event/Task | BE-05 | 闭环 Modules |
| BE-07 | Companion/Model Session | BE-04,05,06 | 模型控制面 |
| BE-08 | Remote Assistance/LiveKit | BE-04,05 | 远程控制面 |
| BE-09 | Admin Inspection/Audit | BE-02,03,05,07 | 检查能力 |
| BE-10 | Notification/Outbox/Worker | BE-01 | 异步任务 |
| WEB-01 | 用户认证与路由树 | BE-02 | client-web |
| WEB-02 | 家属工作区 | BE-03,05,06 | client-web |
| WEB-03 | 陪伴模式/模型迁移 | BE-04,07 | client-web |
| WEB-04 | LiveKit 家属/陪伴 UI | BE-08 | client-web |
| AND-01 | Android 分层/认证/Keystore | BE-02 | client-android |
| AND-02 | 激活与陪伴锁定模式 | BE-04 | client-android |
| AND-03 | MiniCPM-o 媒体迁移 | BE-07 | client-android |
| AND-04 | LiveKit/Core-Telecom/媒体协调 | BE-08 | client-android |
| AND-05 | 家属资料/事件页面 | BE-05,06 | client-android |
| ADM-01 | Art Design 认证与权限 | BE-02,09 | admin-web |
| ADM-02 | 运营面板 | BE-03,04,07,08 | admin-web |
| ADM-03 | 原文检查与审计页面 | BE-09 | admin-web |
| INF-01 | Compose/TLS/域名/Secret | 无 | infra |
| INF-02 | MySQL/Redis/MinIO 监控备份 | INF-01 | Runbook |
| INF-03 | LiveKit/TURN/网络验证 | INF-01 | RTC 环境 |
| QA-01 | Interface/数据库集成测试 | BE-* | 自动化测试 |
| QA-02 | Web/Android E2E | WEB/AND | 端到端测试 |
| QA-03 | 安全/弱网/撤权竞态 | BE-08, AND-04 | 风险测试 |
| DOC-01 | 部署、复现、PPT、视频 | 全部 | 提交材料 |

## 6. 测试金字塔

### 6.1 Module Interface 测试

- Auth 轮换、重放、锁定和恢复。
- Household/Recipient 跨租户拒绝。
- 激活状态机、过期、重复和并发批准。
- Consent 撤回传播。
- Schedule 时区、DST、重复物化。
- Confirmation 与 Family Task 原子闭环。
- Remote Session 迟到事件和终态幂等。
- Inspection Grant 范围、过期和审计。

### 6.2 Adapter 契约测试

- ModelBest、Ascend、Replay 的会话生命周期。
- MinIO 上传/完成/删除和扫描失败。
- LiveKit Token grants、Webhook 验签、参与者移除。
- 邮件、Push Recording Adapter 与重试。

### 6.3 数据库集成测试

- migration 从空库和上一版本都能执行。
- 唯一约束、家庭范围关系和删除策略。
- 乐观锁冲突、死锁重试、Outbox 幂等。
- 原文清除后元数据和审计仍有效。

### 6.4 端到端测试

- 注册 → 邮箱验证 → 创建家庭 → 激活设备。
- 录入资料 → 到点 → 陪伴 → 确认/超时 → 家属处理。
- MiniCPM-o 会话 → Memory Usage → 管理员授权检查。
- 家属发起 → 接听/倒计时 → 通话 → 挂断 → 媒体释放。
- 解绑、撤权、成员移除在活跃会话中的效果。

## 7. 发布门禁

- Prisma validate、format 和 migration 测试通过。
- TypeScript lint/typecheck/unit/integration 通过。
- Android unit、instrumented、lint、assembleRelease 通过。
- Web E2E 主流程通过。
- 无明文 Secret、Token、动态码、家庭原文进入日志或仓库。
- 生产环境内容检查为硬关闭。
- 远程会话默认不录制，摄像头/麦克风状态持续可见。
- 全新环境和 Ascend 环境的运行说明已实际复现。
- Demo 主流程和降级流程均有录屏。

## 8. 主要风险

| 风险 | 概率/影响 | 缓解 |
| --- | --- | --- |
| 截止前功能过多 | 高/高 | 比赛版只做垂直切片，完整功能进入后续 Sprint |
| Android 后台无法自动开媒体 | 高/高 | 默认现场接听；预授权仅限前台/专用设备 |
| ModelBest 无用户转写 | 高/中 | 不伪造；确认是否增加授权 ASR |
| LiveKit 公网 UDP/TURN 配置失败 | 中/高 | 尽早部署并做强制 TURN 测试 |
| 敏感原文误入日志 | 中/高 | 加密字段类型、日志脱敏测试、内容检查独立 Interface |
| 日程时区或重复触发 | 中/高 | UTC+IANA、唯一约束、Fake Clock 测试 |
| 同时模型/家属占用媒体 | 高/高 | MediaSessionCoordinator + Redis 租约 |
| 两个家属并发处理 | 中/中 | version 乐观锁和幂等命令 |


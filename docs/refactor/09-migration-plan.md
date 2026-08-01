# 旧 Demo 迁移方案

## 1. 迁移原则

- 当前 Demo 保留为可运行基线，不在原结构中逐页堆生产能力。
- 先定义 Interface 和数据库，再迁移 UI；不让旧 `localStorage` 类型反向决定服务器模型。
- 每个阶段都保持可演示，出现问题可以退回当前单机 Demo。
- 规则行为通过旧测试向新 Module Interface 的契约测试迁移，验证完成后删除重复浅层测试。

## 2. 推荐工作区

```text
memory-lighthouse-next/
├─ apps/
│  ├─ server-api/
│  ├─ admin-web/
│  ├─ client-web/
│  └─ client-android/
├─ packages/
│  ├─ openapi-generated/
│  ├─ event-contracts/
│  └─ design-tokens/
├─ infra/
│  ├─ compose/
│  ├─ livekit/
│  └─ reverse-proxy/
├─ docs/
└─ scripts/
```

四个 App 独立构建和发布。`packages` 只存生成契约、事件 Schema 和设计 Token，不共享服务器业务 Implementation，也不尝试让 Kotlin 运行 TypeScript 规则。

是否最终采用单 Git 仓库可在实施前确认；无论仓库数量，部署物和权限 Module 都保持独立。

## 3. 现有资产去向

| 当前资产 | 目标 | 迁移方式 |
| --- | --- | --- |
| `src/agent/agent-engine.ts` | server Routine/Care Event + 客户端表现状态 | 先用黑盒测试固定行为，再拆确定性事实与 UI 状态 |
| `routine-scheduler.ts` | server Routine Module | 改为按时区物化 Occurrence 的 Worker |
| `event-closure.ts` | server Routine/Care Event Module | 在单事务中实现确认和待办闭环 |
| `prompt-builder.ts` | server Companion Session Module | 输入 Care Snapshot，输出版本化 Prompt |
| `privacy-policy.ts` | server Consent Module + 客户端门禁 | 服务端为权威，客户端只提前阻止无效操作 |
| `runtime/*`、`use-omni-session.ts` | client-web 陪伴模式 | 保留音视频链路，数据和配置改由服务器下发 |
| 家属/记忆 React 页面 | client-web 家属模式 | 替换 AppState/localStorage 为查询缓存和服务器命令 |
| `minicpmo-Android` | client-android 陪伴媒体 Module | 迁移 CameraX、Audio Engine、Realtime Protocol；重建应用分层 |
| Art Design Clean | admin-web | 保留 MIT License；删除 Mock 和 localStorage Token |

## 4. 迁移阶段

### M0：冻结和契约化

1. 为当前 Demo 打基线 Tag。
2. 保留现有演示脚本和 Replay 模式。
3. 将现有 29 个测试按“确定性规则、模型协议、UI”分类。
4. 确认 OpenAPI、错误码、事件 Schema 和数据库迁移规则。

验收：旧 Demo 仍可启动，目标文档与接口评审通过。

### M1：建立服务器骨架

1. 创建 NestJS、Prisma 7 配置和 MySQL migration。
2. 建立 Module 目录、请求上下文、统一错误、日志和审计。
3. 接入 Redis、MinIO、Outbox 和本地 Compose。
4. 实现注册、登录、邮箱验证、家庭和陪伴对象。

验收：通过 Interface 测试完成注册、登录、创建家庭和越权拒绝。

### M2：设备身份与客户端壳

1. 用户 Web 新增真实认证与家属/陪伴路由树。
2. Android 重建导航、Repository、Room/DataStore、Keystore 和网络层。
3. 实现安装登记、Challenge、二维码/动态码 Claim、批准、设备凭据和撤销。
4. 陪伴设备激活后清除 User Session 并进入锁定陪伴模式。

验收：二维码和动态码都能完成两阶段激活；解绑后设备立即失效。

### M3：资料和任务闭环

1. 迁移陪伴对象、联系人、Consent、Memory、Asset、Medication。
2. 实现 Routine、Schedule、Occurrence、Confirmation、Care Event 和 Family Task。
3. 将旧 `localStorage` 规则行为改为服务器命令。
4. 家属 Web/Android 展示同一数据；并发修改产生明确冲突。

验收：家属录入 → 到点任务 → 本人确认/超时 → 家属处理全链路落库。

### M4：MiniCPM-o 陪伴

1. Web 迁移当前 Realtime Runtime。
2. Android 迁移 CameraX、双工音频和 ModelBest Protocol。
3. 服务器生成 Care Snapshot、Prompt Version 和 Agent Action。
4. 记录模型会话、模型文字输出、可用的用户转写和 Memory Usage。
5. 保留 Replay 和 Ascend Adapter。

验收：真实 Provider 和 Replay 使用同一业务 Interface；模型失败不产生虚假确认。

### M5：远程陪伴

1. 部署 LiveKit，完成 Web/Android SDK 接入。
2. 实现 Remote Access Policy、会话状态机、Join Ticket 和 Webhook。
3. 实现 MediaSessionCoordinator，保证模型与家属通话互斥。
4. Android 接入 Core-Telecom、CallStyle 和 Foreground Service。
5. 覆盖四种端组合与弱网/撤权竞态。

验收：家属可发起、现场可拒绝/结束、预授权模式有倒计时、全程不录制且审计完整。

### M6：管理员和生产化

1. 改造 Art Design 菜单、权限、表格和健康页面。
2. 建立独立管理员登录和动态菜单。
3. 实现开发期 Inspection Grant、逐条原文查看、水印和审计。
4. 完成备份恢复、保留任务、监控、部署脚本和安全门禁。

验收：生产环境不能启动内容检查；开发环境所有原文访问可追溯。

## 5. localStorage 数据导入

当前 Demo 数据不应直接写数据库。提供一次性导入器：

1. 用户在旧 Demo 导出 JSON。
2. 新 Web 在本地解析并显示数据类别、数量和目标陪伴对象。
3. 逐项执行现有 Schema 校验、大小限制和敏感授权检查。
4. 上传 Asset，等待扫描通过。
5. 使用单个 `importBatchId` 创建 Memory、Medication、Routine 和联系人。
6. 任一业务项失败返回逐条报告，不把部分成功表述为整体成功。
7. 导入事件写 Audit，原 JSON 不上传或长期保存。

映射：

```text
CareRecipient       → care_recipients
TrustedPerson       → trusted_contacts / recipient_members（若对应登录成员）
MedicationMemory    → medications + routines + routine_schedules
Routine             → routines + routine_schedules
MemoryItem          → memories + memory_revisions + tags
StoredAsset         → assets + 具体关联表
CareEvent           → 仅演示导入时标记 source=LEGACY_DEMO
ConsentState        → 不直接继承；必须重新取得版本化 Consent
ProviderConfig      → 不导入，由服务器环境配置
```

## 6. Android 重构结构

```text
client-android/
├─ app/
├─ core-auth/
├─ core-network/
├─ core-database/
├─ core-design/
├─ feature-login/
├─ feature-family/
├─ feature-activation/
├─ feature-companion/
├─ feature-remote-assistance/
├─ feature-memories/
├─ feature-routines/
└─ media-runtime/
   ├─ minicpmo/
   ├─ livekit/
   └─ media-session-coordinator/
```

初期可保留单 Gradle App Module 下的 package 分层，等接口稳定后再拆 Gradle Module，避免过早增加构建复杂度；业务分层从第一天保持。

## 7. 回滚策略

- 每个迁移阶段保持旧 Demo Tag 可单独运行。
- 数据库只做可前滚的兼容迁移；先加列/表，再双读验证，最后删除旧结构。
- Web 新功能通过服务器 Feature Flag 分阶段开放。
- Android Device Credential 与 User Session 独立，出现绑定故障可以只回滚激活能力。
- LiveKit 故障只关闭远程陪伴，不影响资料、日程和 MiniCPM-o 陪伴。
- 任何生产切换前先完成备份恢复演练和一镜到底冒烟测试。


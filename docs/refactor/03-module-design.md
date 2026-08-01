# 服务器 Module 设计

## 1. 设计原则

- Module 的 Interface 是调用方和测试共同使用的表面。
- Interface 表达完整用例，不暴露 Prisma 模型或零散 CRUD。
- Implementation 内聚合验证、授权、事务、审计和事件发布。
- 跨 Module 通过命令、查询或领域事件协作，不直接修改对方表。
- 只有远程或确实存在多个实现的依赖才设置 Adapter。

## 2. Module 清单

### 2.1 Identity Module

**拥有**：用户、登录标识、密码凭据、用户会话、密码重置。

**Interface**：

```text
registerUser(command) -> UserSession
authenticate(command) -> UserSession
refreshSession(command) -> UserSession
revokeSession(command) -> void
requestPasswordReset(command) -> Accepted
completePasswordReset(command) -> void
resolvePrincipal(token) -> Principal
```

Implementation 隐藏邮箱/用户名规范化、密码哈希、失败计数、令牌轮换和会话撤销。

### 2.2 Household Module

**拥有**：家庭、家庭成员、邀请、成员状态、陪伴对象级 Care Authority。

**Interface**：

```text
createHousehold(command) -> Household
inviteMember(command) -> Invitation
acceptInvitation(command) -> HouseholdMembership
changeMemberAuthority(command) -> HouseholdMembership
removeMember(command) -> void
authorize(principal, action, resource) -> AuthorizationDecision
```

### 2.3 Care Profile Module

**拥有**：陪伴对象、联系人、沟通偏好和基础档案。

```text
createCareRecipient(command) -> CareRecipient
updateCareRecipient(command) -> CareRecipient
manageTrustedContact(command) -> TrustedContact
getCareSnapshot(query) -> CareProfileSnapshot
```

### 2.4 Device Activation Module

**拥有**：设备登记、Activation Challenge、Device Identity、绑定和撤销记录。

```text
createActivationChallenge(command) -> ActivationPresentation
claimActivationChallenge(command) -> PendingActivation
approveActivation(command) -> DeviceCredential
rotateDeviceCredential(command) -> DeviceCredential
revokeDevice(command) -> void
heartbeat(command) -> Presence
```

二维码和动态码是同一个 Activation Challenge 的两种展示 Adapter，不是两套绑定规则。

### 2.5 Consent Module

**拥有**：授权文档、授权记录、撤回记录和处理目的。

```text
grantConsent(command) -> ConsentGrant
revokeConsent(command) -> ConsentRevocation
evaluateConsent(query) -> ConsentDecision
getConsentSnapshot(query) -> ConsentSnapshot
```

授权撤回应同步触发会话终止、Prompt 失效和对象访问收缩。

### 2.6 Memory Module

**拥有**：可信记忆、标签、版本和附件关系。

```text
createMemory(command) -> TrustedMemory
updateMemory(command) -> TrustedMemory
archiveMemory(command) -> void
searchAuthorizedMemories(query) -> MemorySlice
```

搜索 Interface 接收当前意图和授权范围，调用方不能一次请求整个家庭的全部敏感资料。

### 2.7 Asset Module

**拥有**：对象元数据、上传意图、内容哈希、扫描状态和保留状态。

```text
beginUpload(command) -> UploadIntent
completeUpload(command) -> Asset
authorizeDownload(query) -> DownloadGrant
quarantineAsset(command) -> void
deleteExpiredAssets(command) -> DeletionResult
```

MinIO 细节封装在对象存储 Adapter 中。

### 2.8 Routine Module

**拥有**：药物记录、日程、调度规则、日程实例和确认。

```text
defineRoutine(command) -> Routine
changeRoutine(command) -> Routine
materializeOccurrences(command) -> MaterializationResult
recordConfirmation(command) -> ConfirmationResult
findDueOccurrences(query) -> RoutineOccurrence[]
```

`recordConfirmation` 在一个事务中关闭同一实例的开放待办并写入来源明确的 Care Event。

### 2.9 Care Event Module

**拥有**：事实事件、家属待办、处理动作和事件投影。

```text
recordCareEvent(command) -> CareEvent
openFamilyTask(command) -> FamilyTask
actOnFamilyTask(command) -> FamilyTask
queryTimeline(query) -> CareTimeline
```

严重度只描述处理优先级，不表达医学危险判断。

### 2.10 Companion Session Module

**拥有**：陪伴会话、Care Snapshot、Agent Action、Conversation Turn、Model Session 元数据。

```text
startCompanionSession(command) -> CompanionSession
requestAgentAction(command) -> AgentAction
appendObservation(command) -> ObservationResult
appendConversationTurn(command) -> ConversationTurn
endCompanionSession(command) -> SessionSummary
```

模型 Adapter 只产生 Observation 和 Conversation Turn；Routine 或 Care Event 的状态迁移仍由规则 Implementation 决定。

### 2.11 Realtime Communication Module

**拥有**：Remote Media Grant、Remote Assistance Session、参与者、Join Ticket 和信令审计。

```text
createRemoteMediaGrant(command) -> RemoteMediaGrant
requestRemoteAssistance(command) -> RemoteAssistanceSession
respondToRemoteAssistance(command) -> SessionDecision
issueJoinTicket(command) -> JoinTicket
endRemoteAssistance(command) -> SessionOutcome
```

Join Ticket 只对一次会话、一个参与者和一组媒体轨道有效，不能替代 User Session 或 Device Identity。

### 2.12 Notification Module

**拥有**：通知、收件人、渠道偏好和 Delivery Attempt。

```text
enqueueNotification(command) -> Notification
dispatchPending(command) -> DispatchResult
recordDeliveryResult(command) -> DeliveryAttempt
```

### 2.13 Platform Operations Module

**拥有**：Platform Role、Inspection Grant、Content Inspection 和 Audit Entry。

```text
grantInspection(command) -> InspectionGrant
inspectContent(command) -> InspectedContent
revokeInspection(command) -> void
appendAudit(command) -> AuditEntry
queryOperationalView(query) -> OperationalView
```

内容检查 Interface 总是要求 `reason` 和 Inspection Grant；不存在“管理员自动全读”的通用查询。

## 3. 领域事件

| 事件 | 发布方 | 主要消费者 |
| --- | --- | --- |
| `HouseholdMemberRemoved` | Household | Device Activation、Realtime、Notification |
| `CareAuthorityChanged` | Household | Consent、Realtime、Companion Session |
| `DeviceActivated` | Device Activation | Notification、Audit |
| `DeviceRevoked` | Device Activation | Realtime、Companion Session、Audit |
| `ConsentRevoked` | Consent | Companion Session、Memory、Asset、Realtime |
| `RoutineOccurrenceDue` | Routine | Companion Session、Notification |
| `ConfirmationRecorded` | Routine | Care Event、Notification |
| `FamilyTaskOpened` | Care Event | Notification |
| `RemoteAssistanceRequested` | Realtime | WebSocket 推送、Notification |
| `RemoteAssistanceEnded` | Realtime | Care Event、Audit |
| `InspectionPerformed` | Platform Operations | Audit、开发监控 |

事件先写 `outbox_events`，后台发布成功后标记，不在数据库事务内调用网络依赖。

## 4. 包结构建议

```text
server-api/src/
├─ modules/
│  ├─ identity/
│  │  ├─ interface/
│  │  ├─ implementation/
│  │  └─ identity.module.ts
│  ├─ household/
│  ├─ care-profile/
│  ├─ device-activation/
│  ├─ consent/
│  ├─ memory/
│  ├─ asset/
│  ├─ routine/
│  ├─ care-event/
│  ├─ companion-session/
│  ├─ realtime-communication/
│  ├─ notification/
│  └─ platform-operations/
├─ adapters/
│  ├─ modelbest/
│  ├─ ascend-minicpmo/
│  ├─ minio/
│  ├─ email/
│  └─ webrtc/
├─ infrastructure/
│  ├─ prisma/
│  ├─ redis/
│  ├─ outbox/
│  └─ observability/
└─ interfaces/
   ├─ rest/
   ├─ websocket/
   └─ workers/
```

`interface/` 指 Module 提供给调用方的业务 Interface；最外层 `interfaces/` 指 HTTP、WebSocket 和 Worker 等传输入口，二者不要混用。


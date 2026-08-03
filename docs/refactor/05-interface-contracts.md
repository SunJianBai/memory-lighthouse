# 接口与实时协议

## 1. 通用约定

- 基础路径：`/v1`；破坏性变化使用新的主版本路径。
- 传输：HTTPS JSON；实时控制使用鉴权 WSS；媒体不走普通 REST。
- 资源 ID：ULID 字符串，客户端不得推断顺序或规模。
- 时间：RFC 3339 UTC，日程额外返回 IANA 时区和本地日期。
- 分页：游标 `cursor` + `limit`，不使用高偏移量分页。
- 写幂等：创建会话、确认、激活批准、关闭待办等命令要求 `Idempotency-Key`。
- 并发：更新携带 `version` 或 `If-Match`，冲突返回 `409 VERSION_CONFLICT`。
- 请求追踪：响应返回 `X-Request-Id`，客户端错误报告携带该值。
- 文件：先创建 Upload Intent，再通过 MinIO 短时 URL 上传，最后 Complete。

成功响应保持 Art Design 易适配的统一形式，同时保留真实 HTTP 状态码：

```json
{
  "code": "OK",
  "message": "",
  "data": {},
  "requestId": "01J..."
}
```

错误响应：

```json
{
  "code": "ACTIVATION_EXPIRED",
  "message": "激活请求已过期，请重新生成",
  "requestId": "01J...",
  "details": {}
}
```

`message` 用于用户可理解提示，客户端分支只依赖稳定 `code`。

## 2. 认证 Interface

```text
POST   /v1/auth/register
POST   /v1/auth/login
POST   /v1/auth/refresh
POST   /v1/auth/logout
POST   /v1/auth/logout-all
POST   /v1/auth/device-mode-lock
POST   /v1/auth/email-verifications
POST   /v1/auth/email-verifications/confirm
POST   /v1/auth/password-resets
POST   /v1/auth/password-resets/confirm
GET    /v1/me
GET    /v1/me/sessions
DELETE /v1/me/sessions/:sessionId
```

注册请求允许邮箱和用户名至少填一项；创建家庭或激活设备前必须存在已验证邮箱。登录只接收一个 `identifier`，服务器按规范化规则匹配邮箱或用户名，不返回“账号不存在”差异信息。

注册请求包含邮箱时，服务端在账号与登录会话创建成功后自动发送 6 位数字验证码。已登录用户可向 `POST /v1/auth/email-verifications` 提交 `{ "email": "family@example.com" }` 绑定首个邮箱或重新发送；确认接口为公开的 `POST /v1/auth/email-verifications/confirm`，请求体固定为 `{ "email": "family@example.com", "code": "042731" }`。验证码默认 10 分钟有效，新验证码会使同一账号此前未使用的验证码失效，连续错误达到 5 次后失效，成功确认后不可再次使用。接口对不存在邮箱、错误码、过期码和已使用码返回相同的通用错误，数据库只保存与邮箱身份及令牌记录绑定的 HMAC 摘要，不保存验证码原文。密码重置仍使用独立的高熵一次性链接，不与短验证码共用确认契约。

Web 刷新令牌使用 HttpOnly Cookie；Android 在响应体取得经 Keystore 加密保存的刷新令牌。两者均执行轮换和重放检测。

Web 在兑换或恢复 Device Identity 前必须先调用 `device-mode-lock`。该接口按 HttpOnly Refresh Cookie 查找并撤销整个 Web Session family、清除 Cookie，且不要求页面已经持有 Access Token；这样即使认证启动曾因瞬时网络错误进入匿名态，也不能把仍有效的家属 Refresh Cookie 带入陪伴模式。接口失败时客户端不得兑换凭据或加载设备上下文。

## 3. Household 与陪伴对象 Interface

```text
GET    /v1/households
POST   /v1/households
GET    /v1/households/:householdId
PATCH  /v1/households/:householdId

GET    /v1/households/:householdId/members
POST   /v1/households/:householdId/invitations
POST   /v1/household-invitations/:token/accept
PATCH  /v1/households/:householdId/members/:memberId
DELETE /v1/households/:householdId/members/:memberId

GET    /v1/households/:householdId/care-recipients
POST   /v1/households/:householdId/care-recipients
GET    /v1/households/:householdId/care-recipients/:recipientId
PATCH  /v1/households/:householdId/care-recipients/:recipientId
GET    /v1/households/:householdId/care-recipients/:recipientId/authorities
PUT    /v1/households/:householdId/care-recipients/:recipientId/authorities/:memberId
```

家庭 ID 显式位于路径中，不使用前端提交的角色或“当前家庭”替代授权判断。

成员角色修改、成员移除和 Care Authority 写入均属于高风险授权变更，JSON Body 必须额外携带 `currentPassword`。服务端以密码原值重新认证当前账号，不做 trim 或其他规范化，并按 IP、账号、登录会话及 IP/账号组合限流；密码错误时不得进入业务事务。Web/Android 只在内存/Compose state 中短暂保存该字段，每次提交、失败或取消后立即清空。

## 4. 设备安装与激活 Interface

```text
POST   /v1/device-installations
POST   /v1/households/:householdId/care-recipients/:recipientId/activation-challenges
GET    /v1/activation-challenges/:challengeId
GET    /v1/activation-challenges/:challengeId/approval-details
POST   /v1/activation-challenges/:publicId/claim
POST   /v1/activation-challenges/:challengeId/approve
POST   /v1/activation-challenges/:challengeId/cancel
POST   /v1/device-credentials/exchange
POST   /v1/device-auth/refresh
GET    /v1/households/:householdId/companion-bindings
PATCH  /v1/households/:householdId/companion-bindings/:bindingId
DELETE /v1/households/:householdId/companion-bindings/:bindingId
```

安装登记请求：

```json
{
  "installationPublicKeySpki": "base64url-encoded-ed25519-spki",
  "installationKeyAlgorithm": "ED25519",
  "keyProtection": "NON_EXPORTABLE_V1",
  "platform": "ANDROID",
  "manufacturer": "Example",
  "model": "Companion",
  "osVersion": "15",
  "appVersion": "0.2.0"
}
```

`installationKeyAlgorithm` 与 `keyProtection` 都是必填协议能力。前者只接受 `ED25519` 或 `ECDSA_P256_SHA256`：服务端必须验证 SPKI 类型与声明一致，P-256 只接受 `prime256v1`，并在 claim、exchange、refresh 中从数据库列选择 Ed25519 或 DER 编码 ECDSA/SHA-256 验签，拒绝曲线、算法及 IEEE-P1363/DER 编码混淆。后者当前只接受 `NON_EXPORTABLE_V1`。缺失或旧值拒绝注册；服务端持久化两个字段，并在 claim、批准详情、批准、凭据交换、Device Access Token 校验和 Device Refresh Credential 轮换时重新要求受支持值。`keyProtection` 是官方客户端版本门槛，不是远程硬件证明：服务端无法仅凭声明证明浏览器或 Keystore 的物理实现，仍依赖官方客户端的不可导出密钥实现、持钥签名和家属现场核对批准。

创建 Challenge 响应：

```json
{
  "challengeId": "01J...",
  "publicId": "ML-7K2P",
  "dynamicCode": "H7K9P2QX",
  "qrPayload": "memory-lighthouse://activate?...",
  "expiresAt": "2026-08-01T10:05:00.000Z"
}
```

二维码的秘密部分只展示一次。设备 Claim 后仍然没有家庭访问权，必须等待已登录家属批准并证明持有安装私钥，才能兑换 Device Credential。公开状态轮询只返回状态、时间，以及仅在 `CONSUMED` 时返回的短时不透明恢复令牌，不返回设备信息；有当前 Care Authority 的家属通过 `approval-details` 读取厂商、型号、平台、系统/App 版本、公钥指纹后缀、认领时间和粗粒度网络类别。批准请求必须同时携带 `Idempotency-Key` 请求头及该详情响应中的 `claimSnapshotToken`；设备信息或挑战版本变化时返回 `ACTIVATION_APPROVAL_SNAPSHOT_CHANGED`，要求重新核对。设备认领按 IP、Challenge 与安装身份限流；家属创建/批准再按 IP、账号、登录会话、陪伴对象或 Challenge 的组合限流。

设备完成凭据兑换后，客户端立即注销并清除当前家属 Session，后续陪伴界面只使用 Device Access Token 与可轮换 Device Credential；不得保留家属 Access/Refresh Token 作为隐藏后门。首次 Device Credential 由服务端使用独立域和 Credential Pepper 对 `challengeId + installationId + approvedAt` 做 HMAC 派生，只持久化加 Pepper 的凭据哈希，不保存或加密保存可恢复明文。若数据库已经提交 `CONSUMED`、Binding 与 Credential，但 HTTP 响应丢失，状态接口签发绑定 `challengeId + installationId + approvedAt + challenge.version + expiresAt` 的 60 秒 HMAC 恢复令牌；同一安装必须用不可导出私钥签署包含完整令牌的独立 `exchange-recovery` proof。恢复事务复核 ACTIVE Device/Binding、公钥指纹、家庭与长者、初始 Credential 哈希、撤销/到期/轮换状态，并以 MySQL `status=CONSUMED AND version=<令牌版本>` CAS 原子消费 proof、递增版本，然后只重新呈现同一凭据并签发新的短时 Access Token，不创建第二条 Binding/Credential。首次 exchange 请求或已消费 recovery 请求的重放均返回 `ACTIVATION_ALREADY_CONSUMED`；响应再次丢失时客户端取得新版本令牌并重新签名。Redis 不是恢复授权事实。Web 将待兑换 Challenge 暂存于当前浏览器会话，Android 将其保存在 Keystore 加密存储中；两端都继续轮询 `APPROVED/CONSUMED`，直至凭据安全落盘。轮询取消不得删除恢复句柄；`CANCELLED / EXPIRED / ATTEMPTS_EXCEEDED` 是用户可见终态，网络/5xx/408/429 才自动重试，409 恢复冲突必须有界。若服务端响应成功但 Web 的 IndexedDB commit 中止，客户端必须停止当前自动轮询、跨刷新保留 Challenge，并在恢复完成前拒绝新 Claim 覆盖；运行中的旧 Challenge 兑换也不得被新代际重置。退出陪伴设备模式只导航到受保护的家属路由，必须重新输入账号密码登录。Binding 的状态修改与永久撤销也要求 JSON Body 中的 `currentPassword`，校验和限流规则与成员授权变更相同；撤销成功后设备访问令牌和凭据族立即失效。

完整时序见 [device-activation-sequence.mmd](./diagrams/device-activation-sequence.mmd)。

## 5. Consent Interface

```text
GET  /v1/households/:householdId/care-recipients/:recipientId/consents
POST /v1/households/:householdId/care-recipients/:recipientId/consents/:scope/grant
POST /v1/households/:householdId/care-recipients/:recipientId/consents/:scope/revoke
GET  /v1/households/:householdId/care-recipients/:recipientId/consent-events
```

Grant/Revoke 是命令而非通用 PATCH，便于强制写入授权事件、理由和文档版本。

## 6. Memory、Asset、Medication Interface

```text
GET    /v1/households/:householdId/care-recipients/:recipientId/memories
POST   /v1/households/:householdId/care-recipients/:recipientId/memories
GET    /v1/households/:householdId/memories/:memoryId
PATCH  /v1/households/:householdId/memories/:memoryId
DELETE /v1/households/:householdId/memories/:memoryId
GET    /v1/households/:householdId/memories/:memoryId/revisions

POST   /v1/households/:householdId/assets/upload-intents
POST   /v1/households/:householdId/assets/:assetId/complete
GET    /v1/households/:householdId/assets/:assetId/download-grant
DELETE /v1/households/:householdId/assets/:assetId

GET    /v1/households/:householdId/care-recipients/:recipientId/medications
POST   /v1/households/:householdId/care-recipients/:recipientId/medications
PATCH  /v1/households/:householdId/medications/:medicationId
DELETE /v1/households/:householdId/medications/:medicationId
```

Upload Intent 返回的 PUT 请求同时绑定 `x-amz-server-side-encryption: AES256` 与 `If-None-Match: *`；客户端必须原样发送，Complete 仅表示对象已到达，资产仍要等待真实字节校验和恶意内容扫描通过。

## 7. Routine、Occurrence、Event 和 Family Task Interface

```text
GET    /v1/households/:householdId/care-recipients/:recipientId/routines
POST   /v1/households/:householdId/care-recipients/:recipientId/routines
PATCH  /v1/households/:householdId/routines/:routineId
DELETE /v1/households/:householdId/routines/:routineId

GET    /v1/households/:householdId/care-recipients/:recipientId/occurrences
POST   /v1/households/:householdId/occurrences/:occurrenceId/confirm
POST   /v1/households/:householdId/occurrences/:occurrenceId/family-verify

GET    /v1/households/:householdId/care-recipients/:recipientId/events
GET    /v1/households/:householdId/family-tasks
POST   /v1/households/:householdId/family-tasks/:taskId/claim
POST   /v1/households/:householdId/family-tasks/:taskId/resolve
POST   /v1/households/:householdId/family-tasks/:taskId/dismiss
```

客户端不能发送 `status=COMPLETED` 通用更新；必须调用明确的确认 Interface，由服务器验证当前状态并在事务中完成闭环。

Occurrence 确认/家属复核、Family Task 的 claim/resolve/dismiss 及设备“联系家人”命令都要求 `Idempotency-Key`。若请求体也含 `idempotencyKey`，必须与请求头逐字一致；客户端对网络超时、断连及用户再次重试必须复用原键。服务端持久化“命令类型 + 主体 + 目标 + 完整规范化 payload”的 SHA-256 和首次响应；同键且完整命令一致时原样重放首次响应，`source`、`utteranceId`、`note`、`resolutionCode`、`version` 等任何业务字段变化均返回 `IDEMPOTENCY_CONFLICT`。

## 8. Companion 和模型 Interface

Device Principal 使用独立路径，服务器从凭据解析 binding 和 recipient：

```text
GET  /v1/device/context
POST /v1/device/heartbeats
GET  /v1/device/due-occurrences
POST /v1/device/companion-sessions
POST /v1/device/companion-sessions/:sessionId/model-sessions
POST /v1/device/model-sessions/:modelSessionId/utterances
POST /v1/device/model-sessions/:modelSessionId/events
POST /v1/device/companion-sessions/:sessionId/end
POST /v1/device/occurrences/:occurrenceId/confirm
POST /v1/device/family-contact-requests
```

设备心跳是媒体对账接口，而不只是在线打点。若本地 MiniCPM 运行时仍在采集，客户端必须在请求中携带 `activeCompanionSessionId`。服务端仅在该 ID 与当前 `ACTIVE` 会话一致且 `CAMERA_CAPTURE`（视频模式）、`MICROPHONE_CAPTURE`、`MODEL_PROCESSING` 仍有效时返回 `mediaDirective=CONTINUE` 并续租；否则返回 `mediaDirective=STOP` 和机器可读 `reason`。客户端收到 `STOP` 或模型事件提交失败时必须立即关闭 CameraX/getUserMedia、AudioRecord/音轨与 Provider WebSocket。客户端未声明活动 ID 但数据库仍有活动会话时，服务端以 `CLIENT_SESSION_MISSING` 结束并释放幽灵会话；双方均无活动会话时返回 `CONTINUE`，不会因历史撤权记录永久锁死重新授权后的新会话。

```json
{
  "activeCompanionSessionId": "01J...",
  "appVersion": "0.1.0",
  "osVersion": "Android 15"
}
```

```json
{
  "online": true,
  "serverTime": "2026-08-02T00:00:00.000Z",
  "mediaDirective": "STOP",
  "reason": "CONSENT_REVOKED_MICROPHONE_CAPTURE"
}
```

模型会话创建返回 Provider、端点、有效授权快照、Prompt 版本和最小 Care Snapshot。ModelBest 当前不返回用户侧转写时，客户端只能保存模型文字输出；不得从模型回复反推或伪造用户原文。

## 9. Remote Assistance Interface

```text
GET  /v1/households/:householdId/companion-bindings/:bindingId/availability
GET  /v1/households/:householdId/companion-bindings/:bindingId/remote-access-policy
PUT  /v1/households/:householdId/companion-bindings/:bindingId/remote-access-policy

POST /v1/households/:householdId/remote-sessions
GET  /v1/households/:householdId/remote-sessions/:sessionId
POST /v1/households/:householdId/remote-sessions/:sessionId/cancel
POST /v1/households/:householdId/remote-sessions/:sessionId/end
POST /v1/households/:householdId/remote-sessions/:sessionId/join-ticket

POST /v1/device/remote-sessions/:sessionId/accept
POST /v1/device/remote-sessions/:sessionId/decline
POST /v1/device/remote-sessions/:sessionId/end
POST /v1/device/remote-sessions/:sessionId/join-ticket

POST /v1/webhooks/livekit
```

Join Ticket 固定为单次签发、单次实际入会。LiveKit webhook 适配层必须保留 event UUID、participant SID，以及票据 metadata 中的 `participantId/ticketId`。首次合法 `participant_joined` 原子消费票据；相同 event UUID + SID 的 webhook 重投幂等，任何新的 join event 或 SID 都视为票据重放并立即移除参与者。合法参与者离开后会话结束；需要恢复时重新发起现场接听流程，不复用或重新签发原票据。

发起请求：

```json
{
  "bindingId": "01J...",
  "media": {
    "receiveDeviceAudio": true,
    "receiveDeviceVideo": true,
    "sendFamilyAudio": true,
    "sendFamilyVideo": false
  }
}
```

服务器创建会话前重新验证成员、Care Authority、Remote Access Policy、Consent、设备在线状态和媒体租约。修改 Remote Access Policy 必须提交当前密码进行重新认证，并按 IP、账号、登录会话和 Binding 限制密码尝试；远程发起按源 IP、用户、登录会话、目标 Binding 及其组合多维限流。Web/Android 在请求结果不确定时保留同一 Idempotency Key，只有收到成功响应或业务意图变化后才换键。Join Ticket 只有在设备现场明确接受后签发，每个会话参与者只签发一次，并持久化 `ISSUING/PROVISIONING/ROOM_READY/ISSUED/CONSUMED/REVOKED` 生命周期；只有 `ISSUED` 成功持久化后才向客户端返回 JWT。进程崩溃遗留的未交付阶段由定时任务按 CAS 恢复，过期 `PROVISIONING` 的确认与会话终止在同一串行化事务中完成。再次请求已交付或已消费的票据返回 `REMOTE_JOIN_TICKET_ALREADY_ISSUED`。远程通话固定返回 `recording=false`、`transcription=false`。

## 10. 管理员 Interface

```text
POST /v1/admin/auth/login
POST /v1/admin/auth/refresh
POST /v1/admin/auth/logout
GET  /v1/admin/operations/dashboard
GET  /v1/admin/users
GET  /v1/admin/households
GET  /v1/admin/devices
GET  /v1/admin/model-sessions
GET  /v1/admin/remote-sessions
GET  /v1/admin/audit-logs

POST /v1/admin/inspection-grants
POST /v1/admin/inspection-grants/:grantId/approve
POST /v1/admin/inspection-grants/:grantId/revoke
GET  /v1/admin/inspections/memories/:memoryId
GET  /v1/admin/inspections/utterances/:utteranceId
```

原文检查 Interface 在生产构建中不注册；开发环境每次读取都要提供 Grant ID，并返回 `Cache-Control: no-store`。

## 11. 实时控制 WebSocket

用户和设备分别连接：

```text
wss://api.example.com/v1/realtime/user
wss://api.example.com/v1/realtime/device
```

统一消息结构：

```json
{
  "id": "01J...",
  "type": "remote-session.invited",
  "occurredAt": "2026-08-01T10:00:00.000Z",
  "sequence": 1842,
  "payload": {}
}
```

核心事件：

```text
device.presence.changed
activation.claimed
activation.approved
routine.occurrence.due
care-event.created
family-task.created
family-task.updated
remote-session.invited
remote-session.cancelled
remote-session.accepted
remote-session.ended
remote-session.policy-revoked
consent.revoked
device.revoked
```

WebSocket 不是事实源。客户端记录最后 `sequence`，断线后通过 REST `updatedAfter/cursor` 补齐；无法补齐时执行完整相关资源刷新。

## 12. 稳定错误码

```text
AUTH_INVALID_CREDENTIALS
AUTH_SESSION_REVOKED
EMAIL_VERIFICATION_REQUIRED
HOUSEHOLD_ACCESS_DENIED
RECIPIENT_ACCESS_DENIED
VERSION_CONFLICT
IDEMPOTENCY_CONFLICT
IDEMPOTENCY_KEY_REQUIRED
IDEMPOTENCY_KEY_MISMATCH
ACTIVATION_EXPIRED
ACTIVATION_ALREADY_CONSUMED
ACTIVATION_ATTEMPTS_EXCEEDED
ACTIVATION_APPROVAL_SNAPSHOT_CHANGED
ACTIVATION_IDEMPOTENCY_CONFLICT
DEVICE_KEY_PROTECTION_UNSUPPORTED
DEVICE_INSTALLATION_KEY_ALGORITHM_UNSUPPORTED
DEVICE_REVOKED
CONSENT_REQUIRED
MEDIA_PERMISSION_REQUIRED
REMOTE_CALL_NOT_ALLOWED
REMOTE_DEVICE_OFFLINE
REMOTE_DEVICE_BUSY
REMOTE_SESSION_TERMINAL
REMOTE_JOIN_TICKET_ALREADY_ISSUED
MODEL_PROVIDER_UNAVAILABLE
ASSET_SCAN_PENDING
INSPECTION_GRANT_REQUIRED
INSPECTION_GRANT_EXPIRED
RATE_LIMITED
```

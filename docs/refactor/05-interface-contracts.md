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
POST   /v1/auth/email-verifications
POST   /v1/auth/email-verifications/confirm
POST   /v1/auth/password-resets
POST   /v1/auth/password-resets/confirm
GET    /v1/me
GET    /v1/me/sessions
DELETE /v1/me/sessions/:sessionId
```

注册请求允许邮箱和用户名至少填一项；创建家庭或激活设备前必须存在已验证邮箱。登录只接收一个 `identifier`，服务器按规范化规则匹配邮箱或用户名，不返回“账号不存在”差异信息。

Web 刷新令牌使用 HttpOnly Cookie；Android 在响应体取得经 Keystore 加密保存的刷新令牌。两者均执行轮换和重放检测。

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

## 4. 设备安装与激活 Interface

```text
POST   /v1/device-installations
POST   /v1/households/:householdId/care-recipients/:recipientId/activation-challenges
GET    /v1/activation-challenges/:challengeId
POST   /v1/activation-challenges/:publicId/claim
POST   /v1/activation-challenges/:challengeId/approve
POST   /v1/activation-challenges/:challengeId/cancel
POST   /v1/device-credentials/exchange
POST   /v1/device-auth/refresh
GET    /v1/households/:householdId/companion-bindings
PATCH  /v1/households/:householdId/companion-bindings/:bindingId
DELETE /v1/households/:householdId/companion-bindings/:bindingId
```

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

二维码的秘密部分只展示一次。设备 Claim 后仍然没有家庭访问权，必须等待已登录家属批准并证明持有安装私钥，才能兑换 Device Credential。

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

服务器创建会话前重新验证成员、Care Authority、Remote Access Policy、Consent、设备在线状态和媒体租约。Join Ticket 只有在现场接受或合法倒计时结束后签发。

## 10. 管理员 Interface

```text
POST /v1/admin/auth/login
POST /v1/admin/auth/refresh
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
ACTIVATION_EXPIRED
ACTIVATION_ALREADY_CONSUMED
ACTIVATION_ATTEMPTS_EXCEEDED
DEVICE_REVOKED
CONSENT_REQUIRED
MEDIA_PERMISSION_REQUIRED
REMOTE_CALL_NOT_ALLOWED
REMOTE_DEVICE_OFFLINE
REMOTE_DEVICE_BUSY
REMOTE_SESSION_TERMINAL
MODEL_PROVIDER_UNAVAILABLE
ASSET_SCAN_PENDING
INSPECTION_GRANT_REQUIRED
INSPECTION_GRANT_EXPIRED
RATE_LIMITED
```


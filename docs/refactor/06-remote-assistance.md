# 远程陪伴音视频

## 1. 产品语义

“家属接管摄像头和麦克风”在技术上定义为：家属发起一次 Remote Assistance Session，陪伴设备在本地策略允许后自行启用摄像头和麦克风，并把轨道发布到仅限本次会话的媒体房间。家属不能绕过 Android/Web 权限、硬件静音、系统隐私开关或现场挂断按钮直接控制硬件。

产品文案建议使用“远程陪伴”或“家属连线”，避免使用容易被理解为隐蔽监控的“远程接管”。

## 2. 推荐拓扑

```text
家属 Web / Android
        │ 创建、接听、结束、Join Ticket
        ▼
NestJS Realtime Communication Module
        ├─ MySQL：授权、会话状态和审计
        ├─ Redis：在线状态、媒体租约和限流
        ├─ WSS / Push：通知陪伴设备
        └─ LiveKit Server SDK：房间与参与者管理
                         │
                  自托管 LiveKit SFU
                    │           │
             家属 LiveKit SDK   陪伴 LiveKit SDK
```

选择 LiveKit 的原因：WebRTC 不定义信令，裸 P2P 仍需自行处理 SDP/ICE、Perfect Negotiation、ICE Restart、网络切换、TURN、跨端差异和断线恢复；LiveKit 已提供 JavaScript 和原生 Android SDK，并包含信令、SFU、重连、权限和 TURN 能力。[WebRTC 连接基础](https://webrtc.org/getting-started/peer-connections)、[LiveKit SFU](https://docs.livekit.io/reference/internals/livekit-sfu/)、[LiveKit Android SDK](https://github.com/livekit/client-sdk-android)

这项技术选择已记录为 accepted ADR；产品方已确认允许增加自托管 LiveKit 部署进程。

## 3. 会话状态机

```text
REQUESTED
  ├─ RINGING
  │   ├─ ACCEPTED → CONNECTING → ACTIVE → ENDING → ENDED
  │   ├─ DECLINED
  │   └─ EXPIRED
  ├─ PREAUTHORIZED_COUNTDOWN
  │   ├─ ACCEPTED → CONNECTING
  │   └─ LOCAL_CANCELLED
  └─ CANCELLED / FAILED / REVOKED
```

- `ACCEPTED` 表示本地策略允许，不代表媒体已经连通。
- `ACTIVE` 由 LiveKit Webhook 确认双方进入房间且陪伴端发布必要轨道。
- 任意阶段发生成员移除、授权撤回、设备解绑或媒体租约丢失时进入 `REVOKED/ENDED`。
- 所有终态幂等；迟到的接受、取消或 Webhook 不能复活终态会话。

## 4. 两种接听模式

### 4.1 默认：现场接听

陪伴端显示家属身份和媒体范围，现场点击接听后才启动 Camera/Microphone Foreground Service 和 LiveKit。普通手机、锁屏状态和陪伴 Web 一律使用此模式。

### 4.2 可选：预授权倒计时

只有在陪伴设备本地提前开启、授权特定家属且授权未过期时可用：

- 接入前播放明显铃声和语音提示。
- 显示 5～10 秒全屏倒计时。
- 倒计时期间可以取消。
- 通话期间持续显示家属姓名、摄像头/麦克风状态、时长和大号挂断按钮。
- 家属修改该能力时需要重新验证密码。
- 普通后台 Web 不承诺自动接听；Android 也只在前台或专用陪伴设备模式下可靠。
- 永不提供静默接入选项。

## 5. Android 约束

Android 14 及以上通常禁止后台 App 直接创建需要摄像头或麦克风 while-in-use 权限的 Foreground Service；应先显示来电并由用户操作，再启动声明了 `camera|microphone` 类型的服务。[后台启动限制](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)、[Android 14 前台服务类型](https://developer.android.com/about/versions/14/changes/fgs-types-required)

Android Implementation：

- 使用 `androidx.core:core-telecom` 接入 VoIP 生命周期。
- 使用 `NotificationCompat.CallStyle` 提供接听、拒绝和挂断。
- 用户接听后启动 `camera|microphone` Foreground Service。
- 使用 LiveKit Android SDK 发布轨道。
- 保留不可忽略的通话通知，并尊重系统摄像头/麦克风隐私指示器。
- Push 只唤醒来电通知，不能直接打开摄像头。[Core-Telecom](https://developer.android.com/develop/connectivity/telecom/voip-app/telecom)、[CallStyle](https://developer.android.com/develop/ui/compose/notifications/call-style)

如果要把设备配置成真正的长期专用陪伴平板，需要 Device Owner/DPC 和 Lock Task Mode；普通屏幕固定不等价。[Android 专用设备模式](https://developer.android.com/work/dpc/dedicated-devices/lock-task-mode)

## 6. Web 约束

- `getUserMedia()` 仅在安全上下文和用户授权后可用。
- 页面关闭后 Service Worker 可以展示来电通知，但不能代替页面打开摄像头和麦克风。
- 浏览器后台可能被挂起，不能作为无人值守接入的可靠主端。
- 浏览器可能阻止远端音频自动播放，需要用户手势恢复音频。
- Web 规范要求用户同意和捕获状态指示，不应利用持久权限把媒体静默发送到新终点。[Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/)、[LiveKit JS SDK](https://docs.livekit.io/reference/client-sdk-js/)

因此 Android 是远程联系的主陪伴端，Web 是前台备用端。

## 7. MediaSessionCoordinator

Android 和 Web 陪伴端都需要一个深 Module 成为摄像头、麦克风和播放设备的唯一所有者：

```text
IDLE
├─ AI_COMPANION_ACTIVE
├─ FAMILY_CALL_RINGING
├─ FAMILY_CALL_ACTIVE
└─ PRIVACY_LOCKED
```

Interface：

```text
requestLease(owner, mediaKinds) -> LeaseDecision
transition(leaseId, targetState) -> MediaState
release(leaseId, reason) -> void
observeState() -> MediaState
```

家属来电时：

```text
AI_COMPANION_ACTIVE
→ FAMILY_CALL_RINGING
→ 停止 MiniCPM-o 上行并释放采集器
→ FAMILY_CALL_ACTIVE
→ 通话结束并完全释放 LiveKit
→ 经本地明确提示后，用户选择是否恢复 AI 陪伴
```

赛事版不同时向 MiniCPM-o 和 LiveKit 开两套采集器。未来需要模型参与家属通话时，让模型作为受控房间参与者加入，而不是抢占本地硬件。

## 8. Join Ticket 和 LiveKit 权限

- Token 只由 NestJS 生成，客户端永远不知道 LiveKit API Secret。
- 房间名使用不可猜测随机值。
- 接听或合法倒计时完成后才签发。
- 初始有效期建议 1～2 分钟，只允许加入指定房间。
- 家属可发布麦克风和可选摄像头；陪伴设备可发布本地摄像头/麦克风并订阅家属轨道。
- 普通参与者没有房间管理权限。
- NestJS 只在会话的首张 Join Ticket 前显式创建一次最多 2 人的房间。第一个短 SERIALIZABLE 事务锁定 `remote_assistance_sessions` 行，并把唯一参与者选为 session-wide `PROVISIONING` owner；其他并发签票保持 `ISSUING`、返回忙且绝不调用 CreateRoom。owner 在事务外执行有硬超时的建房调用，成功后由第二个短 SERIALIZABLE 事务提交 `room_provisioned_at` 与 `ROOM_READY`。任一阶段失败或超时都会终止整个会话，不能把 owner 交给第二个请求继续建房；事务提交前绝不签票。后续家属端或陪伴端签票看到该标记后复用房间，不再发出可能迟到的 CreateRoom 请求。只有持久会话仍为非终态、采用现场接听且 `accepted_at` 已写入时才允许创建或签发。LiveKit 的 `room.auto_create` 在开发和生产环境均关闭。
- Join Ticket 在返回 JWT 前持久经过 `ISSUING → PROVISIONING → ROOM_READY → ISSUED`；只有 `ISSUED` 才可能返回客户端。进程崩溃遗留的 `ISSUING/ROOM_READY` 可按状态和时间做 CAS 复位，遗留的 `PROVISIONING` 必须在同一个串行化终止事务内再次确认仍过期，随后将会话置为 `FAILED`、撤销全部票据并进入房间清理。
- 会话结束时优先删除房间；只有删除失败才降级移除在线参与者并重试删除。自托管 LiveKit 的 `removeParticipant` 只能断开当前连接，不能撤销客户端已经取得的刷新令牌；连接中的客户端可能获得有效期至少 10 分钟的刷新令牌。因此安全边界不能只依赖初始 Token 的短 TTL，而必须依赖“显式建房 + 禁止自动建房 + 终态删房”，使旧令牌无法重建已结束的房间。[LiveKit Tokens & grants](https://docs.livekit.io/frontends/reference/tokens-grants/)
- 显式创建但无人入会的房间使用 `empty_timeout: 60`，与初始 Join Ticket 的 60 秒窗口对齐并自动失败关闭；它只负责回收未入会的孤儿房间，不能代替终态时优先执行的 `deleteRoom`。

## 9. Redis 媒体租约

```text
key: media-owner:{bindingId}
value: { ownerType, ownerId, leaseId }
operation: SET NX + TTL
renewal: authenticated heartbeat
```

- 一个 Binding 同时只有一个 `AI_COMPANION` 或 `REMOTE_ASSISTANCE` 媒体所有者。
- 取得远程租约失败返回 `REMOTE_DEVICE_BUSY`。
- Redis 租约用于快速互斥，MySQL 会话生命周期用于审计和恢复。
- Worker 定期将失去租约但仍非终态的会话收敛为 `FAILED/ENDED`。
- 远程会话进入终态后，MySQL 的 `room_cleanup_status=PENDING` 是跨 Redis/LiveKit 的持久清理屏障。只有 LiveKit 确认房间已删除（不存在也视为成功）且 MySQL 原子写入 `COMPLETED` 后才能释放远程媒体租约；删除或数据库检查点失败时继续持有/续租隔离租约，启动时及每 15 秒重试，并拒绝同一 Binding 的新 AI 或远程媒体。
- 外部建房结果不确定时设置 `room_cleanup_not_before`，在窗口内重复删房并保持隔离；但核心安全不依赖上游在固定时间内完成。`room_provisioned_at` 保证“可能迟到的首次建房”之前没有任何已交付票据，而一旦票据可交付，所有后续签票都不会再次调用 CreateRoom。
- 陪伴心跳只续租客户端明确声明且服务端仍为 `ACTIVE` 的同一 AI 会话；进程重启后未声明本地运行时会使幽灵会话以 `CLIENT_SESSION_MISSING` 结束。撤销相机、麦克风、模型处理或记忆注入授权会在同一数据库事务中终止陪伴/模型会话，设备下一次心跳收到 `STOP` 并立即卸载本地采集与 Provider 连接。

## 10. 默认不录制

远程陪伴默认不录音、不录像、不转写。管理员的“对话原文检查”只涉及 MiniCPM-o 会话文字，不允许实时旁听家属通话。

未来若需要录制，必须新增独立 Consent Scope、双方明显录制提示、LiveKit Egress、MinIO 资产、短保留期限和访问审计；这不属于当前版本。[LiveKit Egress](https://docs.livekit.io/transport/media/ingress-egress/egress/)

## 11. 验收矩阵

- 家属 Android ↔ 陪伴 Android。
- 家属 Web ↔ 陪伴 Android。
- 家属 Android ↔ 陪伴 Web。
- 家属 Web ↔ 陪伴 Web。
- Wi-Fi、移动网络、弱网和强制 TURN。
- 通话中 Wi-Fi/移动网络切换。
- Android 前台、后台、锁屏、进程被杀。
- 摄像头/麦克风拒绝、运行中撤回及系统总开关关闭。
- 浏览器自动播放被阻止。
- MiniCPM-o 会话中收到家属来电。
- 两位家属同时发起。
- Token 重放、房间猜测和跨家庭加入。
- 解绑或撤回授权后立即拒绝新会话。
- 呼叫者取消与陪伴端接听的竞态。
- 结束后摄像头、麦克风、音频和 Foreground Service 全部释放。

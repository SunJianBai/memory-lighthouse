# 安全、权限与隐私

## 1. 安全主体

系统区分下列主体，不能因共用一个客户端而互相替代：

| 主体 | 认证方式 | 允许范围 |
| --- | --- | --- |
| 家属 User | 邮箱/用户名、密码、User Session | 被授权家庭内的业务操作 |
| Device Identity | 激活后设备密钥、范围受限会话 | 单个绑定陪伴对象的陪伴能力 |
| Platform Admin | 独立管理员入口、强认证 | 运营元数据和平台配置 |
| Development Content Auditor | 限时 Inspection Grant | 指定家庭和内容类型的只读原文 |

前端角色、菜单、`householdId`、`deviceId` 均不可信。服务器必须根据当前 Principal、成员关系、目标资源和实时授权作出决定。

## 2. 家庭权限模型

### 2.1 家庭角色

| 操作 | OWNER | CAREGIVER | VIEWER |
| --- | ---: | ---: | ---: |
| 管理家庭成员 | 是 | 否 | 否 |
| 管理陪伴对象资料 | 是 | 按 Care Authority | 否 |
| 管理记忆、药物、日程 | 是 | 按 Care Authority | 否 |
| 查看事件和待办 | 是 | 按 Care Authority | 只读授权摘要 |
| 激活陪伴设备 | 是 | `canActivateDevice` | 否 |
| 发起远程陪伴 | 仍需授权 | `canRemoteCall` | 否 |
| 查看对话原文 | 是 | `canViewConversation` | 否 |
| 导出或删除家庭数据 | 是 | 否 | 否 |

角色只是默认权限集合。高风险能力通过陪伴对象级 `Care Authority` 单独授予，尤其是 `canRemoteCall`、`canActivateDevice` 和 `canViewConversation`。

### 2.2 管理员限制

- Platform Admin 永远不能取得远程音视频 Join Ticket。
- 管理员不能借助内容检查 Interface 修改家庭内容。
- Development Content Auditor 与 Platform Admin 分离。
- 管理员端使用独立域名、Cookie 受众和权限集合，不接受普通用户令牌。
- 管理员 Access Token 使用独立签名密钥、Issuer 与 Audience；管理员刷新 Cookie 为 `ml_admin_refresh`，仅作用于 `/openBMB/api/v1/admin/auth`。`user_sessions.purpose=ADMIN_WEB` 是刷新轮换和重放族的强制条件，普通 User Session 与 Admin Session 均不能换取对方令牌。

## 3. 令牌和凭据

| 凭据 | 推荐时效 | 约束 |
| --- | ---: | --- |
| User Access Token | 10～15 分钟 | 当前用户会话；敏感权限需实时查询 |
| User Refresh Token | 7～30 天、每次轮换 | Web 使用 HttpOnly Cookie；服务器只保存哈希 |
| Activation Claim | 不超过 5 分钟、一次性 | 只能认领指定 Activation Challenge |
| Device Access Token | 5～10 分钟 | 固定 household、recipient、device 和能力 |
| Device Refresh Credential | 持续轮换 | 与设备不可导出密钥绑定，可独立撤销 |
| Remote Join Ticket | 不超过 5 分钟、一次性 | 固定会话、参与者、媒体方向 |
| MinIO Presigned URL | 1～5 分钟 | 单个对象、单一操作和大小范围 |
| Inspection Ticket | 不超过 15 分钟 | 固定家庭、数据类别、原因和审批人 |

令牌必须包含环境标识；开发、测试和生产环境互不接受对方签发的凭据。

Remote Join Ticket 的“一次性”同时约束签发与实际入会。服务端把首次 `participant_joined` webhook 的 LiveKit event UUID 和 participant SID 与票据消费记录原子绑定；仅相同 event UUID、相同 SID 的 webhook 重投可幂等通过。相同 JWT/identity 产生的第二个 join event 一律调用 LiveKit `removeParticipant` 断开该连接。LiveKit 在原 participant SID 上完成的短暂网络恢复不重新消费票据；一旦收到合法参与者离开或连接中止事件，本次远程会话结束，不重复签发旧票据，后续重连必须重新发起并由现场接听的新会话。自托管 LiveKit 不支持通过 `removeParticipant` 撤销刷新令牌，因此服务端仅在持久会话仍非终态且已现场接听时显式创建最多 2 人的房间：第一个短事务锁定会话并提交唯一 `PROVISIONING` owner，事务外建房，第二个短事务提交 `room_provisioned_at + ROOM_READY` 后才可签首张票；其他并发请求不得建房，后续签票也不再调用 CreateRoom。所有环境关闭 `room.auto_create`，终态删除房间；即使旧客户端仍持有刷新令牌，也不能重新创建已结束的媒体房间。[LiveKit Tokens & grants](https://docs.livekit.io/frontends/reference/tokens-grants/)

Web 陪伴端使用 WebCrypto Ed25519，生成时把私钥设为不可导出，仅允许导出 SPKI 公钥完成安装登记。Android 优先使用 Android Keystore 中不可导出的 Ed25519（API 33+）；不支持时回退到同样不可导出的 EC P-256（API 23+），不回退到可导出的 PKCS#8 文件。两个官方客户端登记时都必须声明实际 `installationKeyAlgorithm` 与 `keyProtection=NON_EXPORTABLE_V1`；服务端严格校验 Ed25519 或 `prime256v1` SPKI，把算法和保护能力持久化，并在激活和设备凭据查询中持续校验。P-256 的 claim、exchange、refresh 只接受 DER ECDSA/SHA-256。保护声明只能作为官方客户端协议版本门槛，不能等同于硬件远程证明。升级迁移会把迁移前设备标记为 `LEGACY_UNVERIFIED`，一次性撤销所有旧版 Device Credential、Binding、未完成媒体会话和激活挑战，并把算法与保护列收紧为无默认值的 `NOT NULL`，使旧服务或旧客户端不能创建或恢复可用设备。

## 4. 设备激活安全

凭据兑换按分布式提交歧义设计：首次长期 Device Credential 使用 Credential Pepper 和独立 HMAC 域从已批准 Challenge、安装身份与批准时间确定性派生，数据库仍只保存加 Pepper 的哈希。进入 `CONSUMED` 后，旧 exchange proof 永远不能取回凭据；状态接口只签发绑定当前 Challenge 版本、安装身份和 60 秒期限的不透明恢复令牌，设备须以不可导出私钥签署独立 `exchange-recovery` proof。恢复事务同时复核 ACTIVE Device/Binding、家庭与陪伴对象、指纹、哈希、撤销、到期和未轮换状态，并用 MySQL Challenge `version` CAS 原子消费证明。恢复响应再次丢失时再取得新版本令牌；旧签名、并发重放和 Redis 丢失都不能恢复授权。

二维码和动态码采用同一个“两阶段激活”流程：设备先认领，家属再批准。

安全要求：

1. 二维码载荷使用至少 128 位随机值，不包含家庭或陪伴对象明文。
2. 动态码为 6～8 位，仅与不敏感的短 Challenge ID 一起使用。
3. 服务端只保存令牌和动态码哈希。
4. 有效期默认 5 分钟，单 Challenge 最多 5 次失败。
5. 设备认领按 Challenge、IP 和与公钥一一对应的安装身份限流；家属创建/批准按账号、登录会话、IP、陪伴对象或 Challenge 组合限流。
6. 家属批准页通过已认证接口显示设备型号、系统版本、App 版本、公钥指纹后缀、认领时间和粗粒度网络来源；公开状态轮询不返回这些元数据。
7. 批准命令绑定包含挑战版本、设备标识和上述展示信息的 HMAC 快照令牌；信息变化后旧页面不能批准。
8. Android 使用 Keystore 生成不可导出的 Ed25519 或 P-256 设备密钥；Web 使用 WebCrypto 非导出 Ed25519 密钥；登记必须携带实际 `installationKeyAlgorithm` 和 `keyProtection=NON_EXPORTABLE_V1`，服务端在后续关键查询与验签中持续使用数据库值。
9. 激活后销毁家属令牌，只保留 Device Identity。
10. 解绑后撤销设备刷新凭据、实时连接、Join Ticket 和未完成会话。

## 5. 远程音视频安全

- 默认为来电并由现场人员接听。
- 如启用预授权自动接听，必须先有单独 Remote Media Grant，并在陪伴端执行铃声、语音播报、全屏倒计时和持续状态提示。
- 不提供静默摄像头、静默麦克风或管理员接入模式。
- 开始通话前暂停 MiniCPM-o 媒体会话；一个设备同时只能持有一个媒体租约。
- 家属端和陪伴端都能结束会话；授权撤回、成员移除、设备解绑或租约丢失时立即结束。
- Join Ticket 绑定会话、参与者、设备和媒体方向；服务端以 `ISSUING/PROVISIONING/ROOM_READY/ISSUED/CONSUMED/REVOKED` saga 原子约束签发与恢复，LiveKit 加入回调消费票据，结束或撤权时撤销服务端票据并优先删除禁止自动重建的房间；删除失败才移除在线参与者后重试。
- 不记录 SDP、ICE 密钥、TURN 凭据或媒体载荷。
- 默认不录音、不录像；只保存会话开始、接听、网络路径和结束原因等审计元数据。

## 6. 开发期内容检查

开发阶段可以查看可信记忆与对话原文，但必须使用独立流程：

1. Auditor 选择家庭、内容类别并填写原因和工单号。
2. 系统签发最长 15 分钟的 Inspection Grant；正式实现建议增加第二人批准。
3. 默认显示脱敏摘要，展开每条原文时再次写 Audit Entry。
4. 页面显示操作者、时间和请求号动态水印。
5. 禁止批量导出、下载附件和无限滚动抓取。
6. 响应使用 `Cache-Control: no-store`；内容页禁用第三方统计和正文错误上报。
7. Audit Entry 记录访问了哪些记录，但绝不复制原文。
8. 生产启动时若开发内容检查开关为真，服务器应拒绝启动。

这里的“对话原文”当前按文字转写和模型文字回复设计，不包含音频、视频或摄像头帧；该点仍需产品确认。

## 7. 数据加密和密钥

- 所有外部连接强制 TLS。
- MySQL、Redis 和 MinIO 使用不同账号及最小权限。
- 密码使用抗 GPU 的现代密码哈希并记录算法版本，允许渐进升级。
- 刷新令牌、动态码、一次性票据只保存哈希。
- 可信记忆正文、联系人信息和对话原文采用应用层信封加密；数据表保存密文、Nonce 和密钥版本。
- 主密钥不存入数据库或仓库；不同环境使用不同密钥。
- MinIO 对象使用 SSE-S3；上传签名固定要求 `x-amz-server-side-encryption: AES256` 和 `If-None-Match: *`，完成上传时 HEAD 必须返回同一算法，否则对象不进入可用状态。静态主密钥只存在环境 Secret，绝不入库或入仓。
- 密钥轮换以新写入使用新版本、后台渐进重加密的方式进行。

## 8. 默认不持久化的数据

- 连续原始视频、摄像头帧和麦克风原始音频。
- WebRTC 通话录音、录像和媒体流。
- 发送给模型的 Base64 媒体载荷。
- 人脸模板、声纹等生物特征。
- 模型隐藏推理。
- 明文密码、访问令牌、刷新令牌、设备私钥。
- 明文激活码、Join Ticket、TURN 凭据和长期签名 URL。
- 日志中的可信记忆、Prompt、对话原文或对象内容。

## 9. 审计字段

安全审计至少记录：

```text
id, occurredAt, environment
actorType, actorId, actorSessionId, actorRoleSnapshot
sourceIpHash, userAgent, sourceDeviceId
action, resourceType, resourceId
householdId, careRecipientId, targetDeviceId
requestId, traceId, purpose, reasonCode
ticketId, approvalActorId, decision, failureCode
policyVersion, changedFieldNames, beforeHash, afterHash
previousEventHash, eventHash, retentionUntil
```

Audit Entry 追加写入，普通管理员不能更新或删除。远程会话、设备激活和内容检查的专属字段见[数据字典](./database/data-dictionary.md)。

`sourceIpHash` 由 HTTP 控制器对其可信代理边界解析出的客户端 IP 立即计算：使用 `RATE_LIMIT_KEY_SECRET` 和独立域 `platform-audit-source-ip/v1` 做 HMAC-SHA256。业务命令、数据库和日志只接收 32 字节伪名，不接收或保存原始 IP；生产环境缺少该密钥时拒绝启动。

## 10. 滥用防护

- 登录、激活、远程呼叫和密码重置按账号、IP、设备多维限流。
- 连续失败使用递增冷却，不泄露邮箱或用户名是否存在。
- 新设备登录、成员权限变化、自动接听变化、设备激活和原文检查发送通知。
- 频繁呼叫且无人接听触发冷却并通知家庭 OWNER。
- 修改 `canRemoteCall`、自动接听、成员角色或设备绑定时重新验证密码。
- 正式环境远程视频首次使用、新设备或异常位置建议使用邮件二次确认。
- 上传完成后由有租约的后台 Worker 读取 MinIO 真实内容，在同一字节流上校验扩展名、声明 MIME、文件头、大小、SHA-256 并通过 ClamAV `INSTREAM` 扫描；仅 `CLEAN` 可下载。格式/恶意内容为 `QUARANTINED`，扫描器或对象读取故障为不可下载的 `FAILED` 并退避重试。
- 删除任务必须等待既有预签名 PUT 过期，再列举并永久删除该 Object Key 的所有版本和 Delete Marker；简单 S3 DELETE 只产生删除标记，不满足隐私删除要求。Worker 复核不存在任何版本和可见对象后才把数据库状态写为 `DELETED`。

## 11. 环境隔离

开发、测试、生产必须使用不同的域名、数据库、Redis、MinIO Bucket、签名密钥、数据密钥、媒体服务密钥、Android 包名/证书、模型配置和监控项目。禁止把生产数据库或对象备份复制到开发环境；开发验证优先使用合成资料。

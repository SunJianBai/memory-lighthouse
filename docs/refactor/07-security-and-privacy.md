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

## 4. 设备激活安全

二维码和动态码采用同一个“两阶段激活”流程：设备先认领，家属再批准。

安全要求：

1. 二维码载荷使用至少 128 位随机值，不包含家庭或陪伴对象明文。
2. 动态码为 6～8 位，仅与不敏感的短 Challenge ID 一起使用。
3. 服务端只保存令牌和动态码哈希。
4. 有效期默认 5 分钟，单 Challenge 最多 5 次失败。
5. 按 Challenge、IP、账号和设备指纹共同限流。
6. 家属批准页显示设备型号、系统版本、App 版本、认领时间和大致网络来源。
7. Android 使用 Keystore 生成不可导出的设备密钥；Web 使用 WebCrypto 非导出密钥。
8. 激活后销毁家属令牌，只保留 Device Identity。
9. 解绑后撤销设备刷新凭据、实时连接、Join Ticket 和未完成会话。

## 5. 远程音视频安全

- 默认为来电并由现场人员接听。
- 如启用预授权自动接听，必须先有单独 Remote Media Grant，并在陪伴端执行铃声、语音播报、全屏倒计时和持续状态提示。
- 不提供静默摄像头、静默麦克风或管理员接入模式。
- 开始通话前暂停 MiniCPM-o 媒体会话；一个设备同时只能持有一个媒体租约。
- 家属端和陪伴端都能结束会话；授权撤回、成员移除、设备解绑或租约丢失时立即结束。
- Join Ticket 绑定会话、参与者、设备和媒体方向，使用后作废。
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
- MinIO 对象使用服务端加密，并通过短时预签名 URL 访问。
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

## 10. 滥用防护

- 登录、激活、远程呼叫和密码重置按账号、IP、设备多维限流。
- 连续失败使用递增冷却，不泄露邮箱或用户名是否存在。
- 新设备登录、成员权限变化、自动接听变化、设备激活和原文检查发送通知。
- 频繁呼叫且无人接听触发冷却并通知家庭 OWNER。
- 修改 `canRemoteCall`、自动接听、成员角色或设备绑定时重新验证密码。
- 正式环境远程视频首次使用、新设备或异常位置建议使用邮件二次确认。
- 上传同时校验扩展名、MIME、文件头、大小和恶意内容扫描结果。

## 11. 环境隔离

开发、测试、生产必须使用不同的域名、数据库、Redis、MinIO Bucket、签名密钥、数据密钥、媒体服务密钥、Android 包名/证书、模型配置和监控项目。禁止把生产数据库或对象备份复制到开发环境；开发验证优先使用合成资料。


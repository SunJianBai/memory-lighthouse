# 决策确认记录与外部依赖

以下高影响问题已由产品方在 2026-08-01 确认，不再作为开发阻塞项。尚未提供的第三方凭据、云安全组确认和硬件/公网验收列在文末；根域已复用，不需要新增 RTC 或对象存储子域。

## Q1：远程陪伴如何接听

**已确认**：远程来电必须由陪伴端现场明确点击接听；当前不提供自动接听或静默接入。家属发起来电不会直接开启陪伴端摄像头和麦克风。

## Q2：管理员查看的“对话原文”范围

**已确认**：仅在 `MODEL_INPUT_TRANSCRIPTION` 授权开启且 Provider/ASR 实际返回最终用户文本时保存 USER 原文；ModelBest 当前协议不返回用户转写，Android 不反推或伪造。ASSISTANT 文本受 `MODEL_PROCESSING` 授权约束。远程家属通话永不录音、录像或转写。

## Q3：家庭角色

**已确认**：使用 `OWNER / CAREGIVER / VIEWER`，并对每个陪伴对象单独授予 `canRemoteCall`、`canActivateDevice`、`canViewConversation` 等 Care Authority。

## Q4：管理员原文访问是否对家庭可见

**已确认并实现**：家庭 OWNER 可在隐私中心查看管理员何时、因何原因访问过哪些类别的资料，并收到按用户独立已读的站内通知。原文读取、检查记录、哈希链审计、通知及当时所有 ACTIVE OWNER 的回执采用同一事务；家庭视图不暴露管理员身份、具体资源、Grant、Request 或 Ticket 标识。

## Q5：生产环境是否保留原文检查

**已确认**：TX4H4G 生产部署硬关闭内容检查；Development Content Auditor 只允许在明确启用的 `development` 环境中，经 Inspection Grant 和完整审计启用；`test` 与 `production` 环境均不可启用。

## Q6：交付时间与人力

**已确认**：不以原计划日期裁剪范围，由 Codex 按里程碑持续开发、验证并部署完整主闭环。

## Q7：远程媒体基础设施

**已确认**：采用自托管 LiveKit 作为媒体平面，NestJS 负责授权、短时 Join Ticket、业务状态与审计；不自行实现 WebRTC 信令服务器。

## 尚待外部输入

- 根域 `sun227454.online` 已解析到 `124.220.81.104`，LiveKit 信令复用标准 `/rtc/v1`；UFW 当前未启用，仍需确认腾讯云安全组开放 `7881/TCP`、`7882/UDP`、`3478/UDP`。若以后启用 UFW，必须同步加入对应规则。
- 真实 SMTP 主机、端口、账号、密码和发件地址尚未提供，是生产启用和公网切流的阻塞项；当前来电通知使用已认证轮询，不依赖 Android Push。
- Android 单元测试、Lint、Debug APK 与 CI 产物已经完成；尚未连接真机，也未完成双公网设备 LiveKit 音视频验收。
- OpenBMB 尚未切换公网流量，CampusHub 仍正常提供现有服务；CD stage-only 使用私有 GHCR 摘要固定与服务器本地镜像清单双重校验，运行状态以 [Production delivery](https://github.com/SunJianBai/memory-lighthouse/actions/workflows/production-delivery.yml) 为准。即使 stage-only 通过，仍需真实 SMTP 才能执行正式激活和 Caddy 切流。

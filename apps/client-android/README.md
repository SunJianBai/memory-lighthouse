# 守忆灯塔 Android 统一客户端

原生 Kotlin / Jetpack Compose 客户端，一个 APK 在登录后切换“家属端”和“陪伴端”。工程迁移并保留了 `minicpmo-Android` 的 CameraX、OkHttp、16 kHz/24 kHz 全双工音频和 MiniCPM-o 4.5 Realtime 协议能力，同时接入守忆灯塔服务端的真实身份、设备激活、陪伴会话与 LiveKit 契约。

## 已接入功能

- 邮箱或用户名密码登录、注册、Android refresh token 轮换；访问令牌和设备凭据使用 Android Keystore AES-GCM 加密保存。
- 家庭、长者和陪伴设备概览；生成二维码/动态激活码并批准设备。
- 陪伴设备生成独立 Ed25519 安装密钥，按服务端 canonical proof 完成认领、交换和设备凭据轮换。
- MiniCPM-o 语音/视频双工；先在服务端建立 `CompanionSession` / `ModelSession`，再使用服务端下发的 Realtime URL 与提示词；获授权时上报模型文字和运行事件。
- 家属发起来电、陪伴端轮询发现来电、现场接听/拒绝/挂断；双方通过服务端一次性 join ticket 接入 LiveKit。
- 远程通话不使用录制、数据发布或转写接口；应用切到后台时主动关停摄像头、麦克风和连接。
- 长者界面使用 18–30sp 文字、至少 48dp 触控目标、高对比语义色和明确来电提示。

## 构建

要求 JDK 17+、Android SDK 36：

```powershell
cd D:\Codes\AI\OpenBMB\projects\memory-lighthouse\apps\client-android
.\gradlew.bat testDebugUnitTest assembleDebug lintDebug
```

APK 输出：`app/build/outputs/apk/debug/app-debug.apk`。

默认 API Base URL 为：

```text
https://sun227454.online/openBMB/api/v1
```

登录页“开发服务器设置”可修改地址。Release 仅接受 HTTPS；Debug manifest 允许连接 Android 模拟器或局域网的 HTTP 开发服务。

## 外部运行条件

- 正式部署需要 `sun227454.online` 的 HTTPS API 可达。
- 音视频通话需要 LiveKit 服务端下发的 `url` 可从 Android 设备访问，并开放相应 WebRTC/TURN 端口。
- MiniCPM-o 运行需要服务端 `MINICPM_REALTIME_URL` 指向可用的 MiniCPM-o 4.5 Realtime Provider。
- Android 12+ 真机需由用户在开始陪伴、扫码或现场接听时授予摄像头/麦克风权限。

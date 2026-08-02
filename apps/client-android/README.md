# 守忆灯塔 Android 统一客户端

原生 Kotlin / Jetpack Compose 客户端，一个 APK 在登录后切换“家属端”和“陪伴端”。工程迁移并保留了 `minicpmo-Android` 的 CameraX、OkHttp、16 kHz/24 kHz 全双工音频和 MiniCPM-o 4.5 Realtime 协议能力，同时接入守忆灯塔服务端的真实身份、设备激活、陪伴会话与 LiveKit 契约。

## 已接入功能

- 邮箱或用户名密码登录、注册、Android refresh token 轮换；访问令牌和设备凭据使用 Android Keystore AES-GCM 加密保存。
- 设备激活成功后立即撤销并清除本机家属 access/refresh 会话，只保留独立 Device Identity；重启后可无家属登录恢复锁定陪伴界面，进入家属管理必须重新登录。
- 家庭、长者和陪伴设备概览；生成二维码/动态激活码并批准设备。
- 家庭 OWNER 可查看成员、更新他人家庭角色、移除成员并按长者配置照护权限；也可解绑陪伴设备。敏感变更均要求当次输入当前密码，密码不规范化，仅暂存在对话框内存状态，不进入 ViewModel 或持久化存储；客户端禁止自我降权或移除。
- 陪伴设备在 Android Keystore 中生成不可导出的独立签名密钥，安装登记显式声明实际 `installationKeyAlgorithm` 与 `keyProtection=NON_EXPORTABLE_V1`，按服务端 canonical proof 完成认领、交换和设备凭据轮换；私钥不会进入 SharedPreferences、文件或应用进程可导出的 PKCS#8。保护字段是官方客户端版本门槛，不是硬件远程证明。
- MiniCPM-o 语音/视频双工；先在服务端建立 `CompanionSession` / `ModelSession`，再使用服务端下发的 Realtime URL 与提示词；获授权时上报模型文字和运行事件。
- 家属发起来电后，专用陪伴模式以前台服务和加密设备凭据轮询发现；Core Telecom 与不可滑除的 `CallStyle` 通知提供接听、拒绝和挂断，双方通过服务端一次性 join ticket 接入 LiveKit。
- 发现服务只声明 `specialUse`，不访问摄像头或麦克风。只有现场明确接听后才启动独立的 `camera|microphone` 前台服务；拒接、挂断、撤权、远端结束和异常都会释放媒体。
- 通话由 Application 级协调器持有，Activity 退到后台、锁屏或重建不会主动挂断；进程重建只恢复来电发现，绝不会根据服务端的 `ACCEPTED` 状态静默重开媒体。
- 远程通话不使用录制、数据发布或转写接口。
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
- Android 13+ 还需授予通知权限，才能稳定显示来电 `CallStyle` 通知。

## 设备签名算法兼容性

客户端优先尝试 Android Keystore Ed25519（API 33+）；若设备 Keystore 不提供该算法，则使用 API 23+ 广泛支持、同样不可导出的 EC P-256。P-256 安装登记声明 `installationKeyAlgorithm=ECDSA_P256_SHA256`，服务端只接受 `prime256v1` SPKI，并对 claim、exchange、refresh 的同一 canonical message 验证 DER 编码的 `SHA256withECDSA` 签名。两种算法都不会回退到软件私钥或明文持久化。

待激活 Challenge 保存在 Keystore 加密的本地存储中。客户端对 `APPROVED` 与 `CONSUMED` 都会继续用同一安装身份兑换；后者使用服务端签发、绑定 MySQL Challenge 版本的 60 秒恢复令牌，并由不可导出安装私钥签署独立 `exchange-recovery` proof。旧请求不可重放；若数据库提交成功但响应丢失，服务端只重新呈现同一条未轮换凭据，Android 收到后再原子保存并清除待激活状态。

激活轮询只对网络、5xx、408、429 自动重试，两类 409 恢复冲突最多尝试五次；取消协程只结束旧轮询，不会删除待恢复 Challenge。`CANCELLED / EXPIRED / ATTEMPTS_EXCEEDED` 会清理终态并提示重新激活，Keystore、签名或响应解析等本地永久错误也不会静默无限轮询。

从旧版可导出 Ed25519 私钥实现升级时，客户端会删除旧密钥材料；本次协议升级还会删除 v2 Keystore alias 并以 v3 alias 生成新密钥，使 APK 回滚不能复用迁移前安装。仅设备侧的旧安装、凭据和待激活状态失效，用户登录保留，设备必须重新由家属批准激活。

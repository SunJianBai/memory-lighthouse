# 守忆灯塔 Memory Lighthouse

面向轻度认知障碍长者的全模态日常任务陪伴平台。项目已拆分为 Server API、用户 Web、管理员 Web 和原生 Android 四个独立产物；用户 Web 与 Android 均按账号权限切换家属端/陪伴端，原 MiniCPM-o 4.5 比赛 Demo 作为独立路由完整保留。

这不是医疗诊断或自动用药决策工具。系统不识别药片、不判断剂量、不推断危险，只复述家属录入的时间、标签、位置和要求。

## 快速运行

环境要求：Node.js 20.19 或更新版本。

```powershell
cd D:\Codes\AI\OpenBMB\projects\memory-lighthouse
npm install
npm run dev
```

打开 `http://127.0.0.1:4310/openBMB/`。真实家属工作区使用 `/openBMB/app/*`，陪伴设备模式使用 `/openBMB/companion`；比赛 Demo 位于 `/openBMB/demo/*`。

```powershell
npm run test
npm run build
```

以上根目录 `dev/test/build` 快捷命令只针对 Client Web 与原 Demo。Server、Contracts、Admin 和 Android 的完整门禁由 GitHub Actions 分别执行，具体命令与证据见[验收记录](docs/TEST_REPORT.md)。

## 已实现的客户端流程

1. 邮箱/用户名密码注册登录、HttpOnly Cookie 刷新轮换、6 位邮箱验证码和密码重置。
2. 家庭与陪伴对象创建、选择；记忆、日程与家庭待办使用真实 Server API。
3. 二维码或动态码设备 Claim，家属再次批准，设备证明 Ed25519 私钥持有后兑换轮换凭据。
4. Consent 中心逐项授权或撤回摄像头、麦克风、模型、转写、记忆、远程协助和开发期检查。
5. 陪伴设备以独立短时 device access token 获取最小上下文、发送心跳、创建 Companion/Model Session，再启动现有 MiniCPM-o runtime。
6. 家属发起远程通话，陪伴端现场接听后连接 LiveKit；远程通话固定不录音、不转写。
7. 管理员开发期读取原文时，同一事务生成检查审计和所有当前家庭 OWNER 的站内通知；隐私中心显示类别、原因、时间及独立已读状态。
8. 原本地 Demo 的引导、记忆、确定性状态机、演示回放与 MiniCPM-o 联调行为全部保留。

## 三种推理模式

| 模式 | 用途 | 数据路径 |
| --- | --- | --- |
| ModelBest 公网 | 本方案主模型 | 按[官方 Realtime API](https://minicpmo45.modelbest.cn/docs/zh/realtime-api/overview/)连接音频/视频全双工与 Chat；只有明确授权后可选 |
| 本地 Ascend | 可选本地部署 | 浏览器通过 SSH 隧道连接 vLLM-Omni；内置本地参考音，不依赖公网下载 |
| 演示回放 | 离线保底 | 本地摄像头预览、浏览器语音与确定性场景；界面始终明确标为“演示回放” |

首次加载保持在回放模式，避免在取得公网授权前隐式上传音视频；授权后可在“设置”一键切换到 ModelBest。

本地默认接口：

```text
ws://localhost:17862/v1/realtime
http://127.0.0.1:18099/v1/chat/completions
openbmb/MiniCPM-o-4_5
```

如果服务器通过现有 SSH 主机别名访问，可建立隧道：

```powershell
ssh -N `
  -L 17862:127.0.0.1:7862 `
  -L 18099:127.0.0.1:8099 `
  openlibing-DevEnv-863242
```

本方案使用公网模型时，先在“记忆中心 → 授权与数据”允许公网处理，再进入“设置”选择“ModelBest 公网”并检查连接。本地部署命令作为无公网环境的可选方案。具体协议见 [模型接入说明](docs/MODEL_INTEGRATION.md)。

## 页面入口

- `/openBMB/login`、`/openBMB/register`：用户认证。
- `/openBMB/app/overview`：家属工作区。
- `/openBMB/app/memories`：服务器记忆档案。
- `/openBMB/app/routines`：日程与家庭待办。
- `/openBMB/app/devices`：设备激活与绑定。
- `/openBMB/app/privacy`：Consent 中心与 OWNER 管理员访问历史。
- `/openBMB/app/remote`：家属发起和管理远程陪伴通话。
- `/openBMB/companion`：激活后的陪伴设备模式与现场接听。
- `/openBMB/admin/`：管理员运营、审计和开发期内容检查；生产环境内容检查硬关闭。
- `/openBMB/demo/showcase`：原一镜到底演示台。

## 设计和工程资料

- [完整重构设计：账号、MySQL、设备激活、远程音视频与多端架构](docs/refactor/README.md)
- [领域上下文地图](CONTEXT-MAP.md)
- [产品与用户流程](docs/PRODUCT_SPEC.md)
- [智能体与状态机](docs/AGENT_DESIGN.md)
- [模型接入说明](docs/MODEL_INTEGRATION.md)
- [4 分钟现场演示脚本](docs/DEMO_SCRIPT.md)
- [隐私与安全边界](docs/PRIVACY_AND_SAFETY.md)
- [验收记录](docs/TEST_REPORT.md)
- [原方案追踪与实现取舍](docs/SOURCE_TRACEABILITY.md)
- [视觉设计系统](design-system/memory-lighthouse/MASTER.md)

## 项目结构

```text
apps/server-api          NestJS + Prisma + MySQL Server API
apps/client-web          React/Vite 家属工作区、陪伴模式与原 Demo
apps/admin-web           Vue 3 管理员面板（参考 Art Design 管理壳层）
apps/client-android      Kotlin / Jetpack Compose 原生统一客户端
apps/client-web/src/api  统一 API client 与内存 access token
apps/client-web/src/device 设备密钥、激活和凭据轮换
apps/client-web/src/runtime MiniCPM-o 音视频与 Realtime runtime
packages                 API 与事件契约
infra                    MySQL、Redis、MinIO、同机 ClamAV、LiveKit 与 Caddy
```

核心业务闭环和四端产物已实现，当前处于生产交付与公网验收阶段。TX4H4G 尚未切换公网流量；ClamAV 已按同机回环方案纳入不可变发布，QQ SMTP 的非秘密配置已确定，但完整 QQ 邮箱与授权码尚未写入服务器。用户已说明媒体端口开放，仍需公网实测；Android 真机/双公网设备 LiveKit 验收由用户执行。陪伴端通过设备凭据保护的轮询接口发现跨设备来电，浏览器跨标签页通知只用于降低本机联调延迟；界面不会把通知或媒体失败伪装成成功。服务端鉴权 WSS 或 Android Push 可作为后续通知增强，但不是当前来电授权与媒体安全的替代品。

# 守忆灯塔 Memory Lighthouse

面向轻度认知障碍长者的全模态日常任务陪伴 Demo。它把 MiniCPM-o 4.5 的持续视觉、持续语音、主动说话和可打断能力，放进“家属录入可信记忆 → 长者端适时提醒 → 本人确认或家属接手”的完整业务闭环。

这不是医疗诊断或自动用药决策工具。系统不识别药片、不判断剂量、不推断危险，只复述家属录入的时间、标签、位置和要求。

## 快速运行

环境要求：Node.js 20.19 或更新版本。

```powershell
cd D:\Codes\AI\OpenBMB\projects\memory-lighthouse
npm install
npm run dev
```

打开 `http://127.0.0.1:4310/`。首次体验建议点击“开始完整演示”，然后在演示台依次运行五个场景。

```powershell
npm run test
npm run build
```

## 已实现的完整流程

1. 家属通过四步引导建立长者资料、第一联系人和授权边界。
2. 在记忆中心上传长者照片、授权联系人照片、药盒标签照片，并录入药物时间、操作要求、日常偏好与常用位置。
3. 陪伴端仅在开始会话后申请摄像头和麦克风权限。
4. 确定性日程引擎在时间窗口内触发任务；全模态模型负责自然语言陪伴、视觉标签核对和可打断对话。
5. 明确确认会生成可解释事件；无法确认只进入“待家属查看”，不制造紧急告警。
6. 家属端查看事件摘要、日程和授权联系人，并可人工确认待办。
7. 所有资料默认保存在当前浏览器，可导出、恢复、单项删除或整体重置。

## 三种推理模式

| 模式 | 用途 | 数据路径 |
| --- | --- | --- |
| 本地 Ascend | 比赛主演示 | 浏览器通过 SSH 隧道连接 vLLM-Omni；内置本地参考音，不依赖公网下载 |
| ModelBest 公网 | 官方服务对照 | 只有在记忆中心明确授权后可选；音视频会发送到公网服务 |
| 演示回放 | 离线保底 | 本地摄像头预览、浏览器语音与确定性场景；界面始终明确标为“演示回放” |

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

然后进入“设置”，选择“本地 Ascend”并点击“检查服务连接”。具体协议见 [模型接入说明](docs/MODEL_INTEGRATION.md)。

## 页面入口

- `#/care`：长者陪伴端，大字号、低认知负担操作。
- `#/family`：家属端，事件摘要、待确认事项和日程。
- `#/memories`：人物、药物日程、生活记忆、授权与数据。
- `#/demo`：一镜到底演示控制台。
- `#/settings`：Provider、接口、备份与恢复。
- `#/onboarding`：首次建立陪伴档案。

## 设计和工程资料

- [产品与用户流程](docs/PRODUCT_SPEC.md)
- [智能体与状态机](docs/AGENT_DESIGN.md)
- [模型接入说明](docs/MODEL_INTEGRATION.md)
- [4 分钟现场演示脚本](docs/DEMO_SCRIPT.md)
- [隐私与安全边界](docs/PRIVACY_AND_SAFETY.md)
- [验收记录](docs/TEST_REPORT.md)
- [视觉设计系统](design-system/memory-lighthouse/MASTER.md)

## 项目结构

```text
src/agent       确定性状态机、日程调度和模型 Prompt
src/components  应用壳与长者端核心体验
src/data        本地持久化、图片压缩、导入导出
src/domain      领域模型和可重置演示数据
src/hooks       MiniCPM-o 会话编排
src/pages       欢迎、引导、家属、记忆、设置与演示页面
src/runtime     音视频采集、编解码、Realtime/HTTP 运行时
public/worklets 实时 PCM 采集与播放 AudioWorklet
```

当前仓库是可展示、可联调的单机 Demo，不是生产级照护系统。生产化还需要账户体系、端到端加密、撤回授权审计、跨设备同步、通知网关、访问日志和合规评估。

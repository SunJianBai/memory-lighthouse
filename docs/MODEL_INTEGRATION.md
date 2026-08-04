# MiniCPM-o 4.5 模型接入

## 本地 vLLM-Omni

默认配置连接现有 Ascend 运行栈：

```text
Realtime WebSocket  ws://localhost:17862/v1/realtime
Chat HTTP           http://127.0.0.1:18099/v1/chat/completions
Model               openbmb/MiniCPM-o-4_5
```

陪伴端使用 Realtime WebSocket。连接参数包含 `duplex=1`、`minicpmo45_native_duplex=1` 和 `autostart=0`；初始化消息提供系统提示、文本/音频模态与参考音。麦克风转为 16 kHz PCM，200ms 一包；摄像头约 1fps 压缩为 JPEG 并与音频共同发送。模型音频以 24 kHz PCM 进入 AudioWorklet 播放队列。

`public/ref_minicpm_signature.wav` 随项目提供本地参考音，来源于工作区 MiniCPM-o Demo 资产。它避免本地模式为取得参考音访问公网。部署或公开分发前仍应确认所用资产的授权范围；也可以在 Provider 配置中换成团队自有、明确授权的声音。

本地启动前验证：

```powershell
Invoke-RestMethod http://127.0.0.1:18099/health
Invoke-RestMethod http://127.0.0.1:18099/v1/models
```

如果端口不可达，先检查 SSH 隧道和服务器端 `status.sh` / `status_realtime_web.sh`，不要把前端回放当成真模型结果。

## ModelBest 公网（本方案主模型）

默认入口：

```text
wss://minicpmo45.modelbest.cn/v1/realtime
https://minicpmo45.modelbest.cn
```

实现严格对照 [MiniCPM-o 4.5 Realtime API 官方概览](https://minicpmo45.modelbest.cn/docs/zh/realtime-api/overview/)：

1. 根据摄像头授权连接 `?mode=video` 或 `?mode=audio`。
2. 等待 `session.queue_done` 后发送带 `system_prompt`、`config` 和 `voice` 的 `session.init`。
3. 收到 `session.created` 后才进入 live；上行是 16 kHz 单声道 float32 PCM，视频模式附带 JPEG `video_frames`。
4. 分别处理 `response.output.delta` 的 `listen`、`text`、`audio`；24 kHz 音频进入播放队列。
5. 确定性日程动作另开 `?mode=chat` 轮次，把同一份完整安全 Prompt 作为 `system` 消息连同业务事件发送，并等待 `response.done` 后才把提醒记为已送达。

只有 `cloudProcessingApproved=true` 时设置页才允许选择公网 Provider。首次加载仍使用回放，避免未授权时自动上传。公网参考音使用官方服务的默认 float32 PCM；浏览器上传的音频资料不隐式发送给公网。

## 演示回放

回放模式不建立模型连接。它使用相同业务状态机和事件存储，由本地日程规则与用户明确操作触发确定性流程，并通过浏览器 `SpeechSynthesis` 播放本地语音。页面始终显示“演示回放”，不会把固定文本包装成真实模型生成。

## 会话生命周期

1. 用户点击开始。
2. 激活音频播放上下文。
3. 申请麦克风；视频模式再申请摄像头。
4. 建立 Realtime WebSocket 并初始化会话。
5. 持续发送 PCM 音频和最新 JPEG 帧。
6. 接收文字、音频、监听信号和延迟指标。
7. 用户打断时清空未播放音频并恢复监听。
8. 结束或错误时关闭 Socket、音轨、定时器和 AudioContext。

确定性日程到期时不会靠模型自行猜时间。规则层会显式发起一轮短动作请求：本地模式调用同一 vLLM-Omni 的 Chat HTTP，公网模式建立独立 Chat Realtime 请求；两者都携带完整授权上下文与安全边界，生成结果回到同一字幕区。

官方 ModelBest duplex 输出只有模型侧的 `listen`、`text`、`audio`，没有用户转写事件。因此公网模式支持自然语音对话与打断，但“本人完成”“重复”“联系家属”等业务留痕使用页面大按钮；本地 Provider 若返回输入转写，才启用确定性语音命令分类。Demo 不额外调用浏览器云 ASR，也不从模型回答反推本人是否确认。

## 故障降级

- 真模型连接失败：页面显示具体错误并提示切换回放。
- 摄像头不可用：音频会话可继续，画面状态单独标记。
- 本地隧道不可用：设置页健康检查失败，不会自动把敏感数据切到公网。
- 公网未授权：禁止选择 ModelBest。
- 麦克风未授权：真实模型会话不启动；摄像头未授权时只建立音频会话。
- 敏感记忆授权撤回：立即结束现有会话以清除旧 Prompt；药物日程、联系人和敏感人物记忆不再进入后续 Prompt 或动作轮次，后续上传被阻止。

## 当前实测

2026-08-01 在本工作站完成：

- ModelBest `/health` 返回 HTTP 200。
- ModelBest `/api/config/eta` 返回 HTTP 200。
- 公网 Realtime WebSocket 完成排队/初始化并收到 `session.created`，音频会话进入 live。
- 按官方 Chat 生命周期并携带完整安全 Prompt 触发晨间日程，收到 `response.done` 后真实返回“林阿姨，现在是早上八点半了。我们一起确认一下，您已经查看标有‘早 · 08:30’的白色药盒了吗？”，随后状态才进入等待本人确认。
- 无头浏览器没有可用虚拟摄像头，因此公网验证只证明音频 Realtime 会话；真实摄像头的全模态演示应在比赛设备上再跑硬件检查。
- 本地 `18099` 当时不可达，SSH 主机验证返回公钥拒绝；本地链路代码复用工作区已验收的 vLLM-Omni 运行时，但本次没有伪造在线结论。

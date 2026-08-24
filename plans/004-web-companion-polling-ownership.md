# Web 陪伴端轮询、来电与媒体归属串行化

- 基线提交：`056fda48c078e116550b0ef702c47bd7cf9722fd`
- 创建日期：2026-08-25
- 状态：DONE

## 问题

陪伴端每 5 秒发送一次设备心跳、每 2 秒查询一次当前来电，而通用请求超时为 15 秒。慢网下同类请求会重叠：旧来电响应可能覆盖更新状态；旧心跳失败还会在现有成功序号判断之前直接停止当前摄像头、麦克风和模型连接。Effect 清理只能阻止部分来电写回，不能使仍在途的心跳失败失效。独立复审还确认，来电从 A 切换到 B 或页面卸载时，旧 LiveKit connect/disconnect 与新会话之间同样需要明确的客户端所有权和串行边界，否则可能在新页面状态下继续占用摄像头、麦克风。

## 本阶段范围

1. 提供无依赖、可测试的 epoch single-flight gate，同一 gate 同时只允许一个任务在途。
2. `invalidate()` 后允许新 epoch 立即工作，旧任务无论成功或失败都不得再产生页面或媒体副作用；gate 仍跟踪所有旧 transport，供安全边界排空。
3. 创建陪伴会话前暂停新心跳并等待所有在途心跳结束，避免旧的“无会话 ID”心跳在服务端结束刚创建的新会话。
4. 心跳与当前来电查询使用独立 gate；组件卸载、激活状态退出或 effect 重建时失效对应任务。
5. WebSocket 推送、接听、拒绝和结束命令会失效在途来电 GET；媒体命令开始前暂停并排空 discovery，避免旧 `null` 与新连接并发。
6. 来电快照按 `requestedAt + sessionId + version` 仲裁，同一会话拒绝版本倒退，旧会话不得覆盖更新会话或终态；`null`/终态形成永久 session tombstone。
7. 客户端 LiveKit connect/disconnect 通过会话所有权协调器串行执行；A 失效时抑制旧回调，并在 connect settle 后补偿断开，B 不得被 A 的延迟清理误断。
8. 接听、拒绝和结束命令使用 mounted lifecycle lease；重复操作互斥，React StrictMode cleanup/replay 产生新 epoch，旧命令不得在卸载后重新打开摄像头或麦克风。
9. 媒体租约仅由当前可见且已连接的媒体 owner 续期，旧续期错误不得污染新会话。
10. 当前有效心跳失败且 AI 陪伴会话正在运行时仍保持 fail-closed；空闲设备失败只显示离线。
11. 当前有效的 `STOP` 指令、来电更新和服务端结束通话行为保持不变。

## 明确排除

- Android 激活与远程通话生命周期。
- Web 设备激活 claim/exchange 流程。
- LiveKit 服务端、票据协议、Room 实现和服务端远程通话状态机；本阶段只收紧页面侧连接与租约的所有权。
- 通用 API Client 超时策略及其他页面轮询。
- UI 视觉重构或新增依赖。

## 验收标准

1. 在途任务未完成时第二次 tick 返回 `skipped`，底层请求只执行一次。
2. 当前任务成功或失败后 gate 释放，后续 tick 可继续执行。
3. 旧 epoch 任务返回成功或失败均为 `stale`，且不能清除或抢占新 epoch 的在途任务。
4. `pauseWhile` 阻止新 tick，并在执行会话创建/媒体命令前等待所有旧 transport settle。
5. CompanionPage 的 heartbeat/currentRemote 均通过 gate，effect 清理、WebSocket/命令更新和页面卸载均执行失效。
6. 同会话旧 version、旧会话推送及旧 `null` 不得覆盖新来电或断开新媒体。
7. A→B、A→终态、connect pending→失效、页面卸载均按 media tail 完成最终断开；不存在绕过队列的并发 disconnect。
8. StrictMode close→mount 后新命令可用，旧 lease 永久失效；重复远程命令不并发。
9. 当前心跳失败、`STOP`、当前来电和远程结束的既有用户行为保持通过。
10. Client Web 单测、类型检查和生产构建全部通过，`git diff --check` 无错误。

## 实现步骤

1. 先增加源码接线回归并确认基线缺少 single-flight/失效保护。
2. 新增纯 TypeScript gate 和确定性 Deferred 行为测试。
3. 接入心跳与来电同步，删除不足以保护失败路径的心跳序号方案。
4. 根据独立复审补齐会话 tombstone、媒体 tail、命令 mounted lease 与 StrictMode replay 覆盖。
5. 执行目标测试、Client Web 完整门禁和独立复审。

## STOP 条件

- 修复需要改变服务端 API、LiveKit 票据/远程通话协议或通用请求语义。
- 无法用可控 Promise 确定性证明重叠、失效和新旧 epoch 归属。
- Client Web 既有门禁出现无法归因于本阶段的新失败。

## 执行记录

- RED：先增加 CompanionPage 源码接线回归，基线目标测试 9 项中 1 项按预期失败，确认原实现没有 polling gate。
- GREEN：新增 polling、remote snapshot、command lease 与 media coordinator 的纯 TypeScript seam；接入心跳、discovery、WebSocket、接听/拒绝/结束、租约续期和页面卸载路径。
- 媒体 fail-closed：`LiveMediaConnection.disconnect()` 在等待 Room 断开前先停止本地轨道，失败时保留 Room 供队列重试；replacement connect 仅在清理重试成功后执行。
- 独立复审先后发现并验证关闭：A→B 旧媒体遗留、pending connect 复活、tombstone 复活、旧命令状态污染、卸载后连接、StrictMode replay 永久关闭 gate、绕过 media tail 的并发断开，以及断开失败后的 fail-open replacement。
- 最终目标回归：3 个文件、31 项全部通过。
- 最终 Client Web 门禁：30 个测试文件、154 项全部通过；`tsc -b` 与 Vite production build 通过；`git diff --check` 通过。

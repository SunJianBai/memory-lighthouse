# Android AI 陪伴心跳与模型会话所有权

- 基线提交：`cc3cb22ebc7b604564f83346d20fb54a39372991`
- 创建日期：2026-08-25
- 状态：COMPLETED

## 问题

陪伴设备心跳会先读取本地 `activeCompanionSessionId`，再独立发送网络请求；AI 会话启动、结束和心跳之间没有共享操作边界。旧的无会话心跳可能在新会话已由服务端创建后才到达服务端，服务端会把新会话判定为 `CLIENT_SESSION_MISSING` 并结束。旧会话的 STOP 或心跳失败也可能在新模型启动后才交给媒体切换器，从而关闭新会话的摄像头、麦克风和 MiniCPM-o runtime。

仅比较 session ID 或在响应返回后忽略旧结果不足以解决问题：无会话心跳已经可能在服务端结束新会话；`null -> 新会话 -> null` 也存在 ABA。必须同时提供会话 generation 和跨网络操作的 single-flight 串行边界。

## 本阶段范围

1. 建立可独立测试的本地 AI 陪伴会话所有权状态：启动意图、活动 session、清理和失效都推进 generation。
2. 将设备 AI 心跳、AI 会话启动和 AI 会话结束放入同一个可取消 Mutex 操作边界，禁止旧空心跳与新启动在服务端交叉。
3. 心跳 STOP 与活动会话心跳失败只允许作用于发起心跳时仍为当前的 generation；失效结果不得触发媒体 handoff 或清理后继会话。
4. 将 STOP 的目标 companion session ID 贯穿 Repository、RemoteCallCoordinator、媒体 handoff 和 MainViewModel；UI 只关闭与目标匹配的当前 AI 页面/runtime。
5. 将全局 STOP latch 改为按 companion session ID 隔离；A 的 STOP 不能吞掉 B 的 STOP，旧 CONTINUE 也不能重置 B 的 fence。
6. Companion Session 创建成功但 Model Session 创建失败、取消或启动 owner 已失效时，尽力补偿结束已创建的服务端 Companion Session。
7. 保留当前安全行为：当前活动会话收到 STOP 或心跳失败时仍先停止本地模型/媒体并清除活动跟踪；空闲心跳、正常启动和正常结束继续可用。
8. 用行为测试覆盖真实竞态；静态安全测试只负责验证 wiring，不作为并发正确性的唯一证据。

## 明确排除

- 服务端 heartbeat、companion-session、model-session API 或数据库协议变更。
- 家属远程通话的 LiveKit heartbeat lease 重构。
- MiniCPM-o Realtime provider 回调的完整 generation 重构。
- 陪伴页面视觉、提示词或模型参数调整。

## 正确性不变量

1. 同一设备任意时刻最多有一个 AI 心跳/会话启动/会话结束网络操作进入服务端关键区。
2. 心跳请求体、响应指令、失败处理和清理属于同一 generation；generation 变化后全部失效。
3. 新会话启动开始前，先前已经进入关键区的空心跳必须完成本地指令处理；启动进入关键区后，后续心跳必须上报新 session ID。
4. 旧 session 的结束、STOP、失败或确认不得清理或停止新 session。
5. 当前 session 的 STOP/失败即使本地停止回调失败，也不能继续保留为活动跟踪。
6. 媒体 STOP 去重按目标 session 隔离；目标为空或与当前 runtime 不匹配时只完成 handoff，不关闭任何新 runtime。
7. 启动的第一阶段已在服务端创建 session 后，后续阶段失败必须发出一次补偿 end；补偿失败不得覆盖原始异常。

## RED 测试

1. 阻塞无会话心跳，在其完成前启动新 AI 会话：旧实现会并发调用启动接口；正确实现必须让启动等待心跳完成。
2. 阻塞活动会话 A 的 STOP，失效 A 并排队启动 B：STOP 必须携带 A，且不得交给 B 的本地媒体；B 最终成为活动 session。
3. 阻塞活动会话 A 的网络失败，失效 A 并排队启动 B：旧失败不得触发 B 的停止或清除 B。
4. 同时发起两次心跳：第二次网络调用必须等待第一次完成，证明 single-flight。
5. 当前活动会话收到 STOP/失败：本地停止恰好一次，跟踪被清除；正常 CONTINUE、启动和结束保持正向覆盖。
6. 所有权纯逻辑覆盖 generation、session ID 比较及 `null -> B -> null` ABA 失效。
7. 媒体 handoff 覆盖 STOP(A) 后 STOP(B)、重复 STOP(B)、CONTINUE(A) 与当前 B fence 的隔离。
8. MainViewModel 覆盖目标 A/当前 B 时不关闭、不停媒体、不清 B；目标 B 时只停止一次。
9. Companion Session 创建成功而 Model Session 创建失败时，补偿 end(A) 恰好执行一次并保留原始错误。

## 验收门禁

1. 上述竞态测试在基线实现上以正确原因失败，并在修复后通过。
2. Android 目标测试、完整 `testDebugUnitTest`、`lintDebug`、`assembleDebug` 与 `git diff --check` 全部通过。
3. 独立复审确认没有剩余 P0/P1/P2，或所有发现均有测试和修复闭环。
4. 本阶段只提交 Android 心跳/会话所有权、对应测试和本计划；不推送或发布，除非用户另行要求。

## STOP 条件

- 正确修复必须改变服务端 heartbeat 协议、数据库模型或生产配置。
- 无法用可控 Deferred 在本地行为测试中复现竞态。
- 共享操作边界会与现有媒体 handoff 的确认回调形成无法消除的锁循环。
- Android 既有门禁出现无法归因于本阶段的失败。

## 执行记录

- 用 `CompanionSessionOwnership` 的 generation ticket 隔离启动、活动、清理和失效；AI 心跳、启动、结束的服务端网络操作由同一 Mutex 串行。
- 心跳在 Mutex 内只完成网络请求、ticket 校验和 typed outcome 生成；媒体 handoff 与 UI ACK 在锁外执行，消除了 Repository/媒体 Mutex 的 ABBA 锁反转。
- STOP、心跳失败和 UI 停机均携带原 companion session ID；MainViewModel 在同一媒体状态锁内比较并摘除连接，旧 A 指令对当前 B 零副作用。
- STOP latch 改为按 companion session ID 隔离，并为 UI 停机 ACK 增加 6 秒上限；成功、异常和 consumer 脱离都会释放 pending handoff。
- end 在首次等待 Mutex 前同步 retire 精确 session；取消的 heartbeat 不伪造失败或清 owner；已获得 session ID 的启动失败/取消会在 NonCancellable、8 秒上限内补偿 end。
- 第一阶段创建请求若已在服务端提交但响应完全丢失，客户端因尚未取得 session ID 无法立即定向补偿；下一次不携带 session ID 的 heartbeat 仍会触发服务端租约收敛。这是现有协议下的已知边界，未扩展服务端 API。
- end 在等待网络操作锁期间若被上层取消，会保持“本地已 retire、服务端等待下一次空 heartbeat 收敛”的安全状态；极短时间内立即重启 AI 可能先收到 BUSY。为避免把现场接听延迟到 HTTP 最长超时，本阶段没有把 end 改为不可取消，后续可单独增加有界的服务端补偿队列。
- 版本提升为 Android `1.0.8`（versionCode 9），发布说明同步更新。
- RED 已在旧实现上验证：空心跳与 start 并发、双 heartbeat 并发、失败启动无补偿、STOP(A) latch 吞 STOP(B)、迟到 STOP(A) 关闭 B 均按预期失败。
- 修复后目标所有权/竞态测试通过；完整 `testDebugUnitTest lintDebug assembleDebug` 通过（53 tasks，BUILD SUCCESSFUL，2026-08-25）；`git diff --check` 通过。
- 用户随后明确要求提交、推送并部署，因此本阶段将在验收后合入 `main` 并通过 `android-v1.0.8` 触发签名发布。

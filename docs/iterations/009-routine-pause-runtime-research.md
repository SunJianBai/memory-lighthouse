# 009 补充调研：暂停／恢复对正在运行陪伴会话的影响

日期：2026-09-21。静态基线：`c02904ca7d2525e0b7b671620217214aa75d5d30`。本文承接 `docs/iterations/009-routine-pause-research.md`，只补运行时链路，不重复竞品研究。所有源码引用均为仓库相对路径及本次核实行号。只新增本文；没有修改生产代码、既有文档、测试、数据库或服务，没有执行测试、设备／浏览器操作、提交、推送或部署。以下方案未实现，不能作为运行通过证明。

## 1. 结论

- **Web 确有客户端主动日程触发，且有第二条重播入口。** 自动到时提醒和“请再说一遍”（按钮／语音）都会把本地日程说明发给模型；当前只有“我完成了”之前读取权威 occurrence，提醒／重播之前没有这一步。见 `apps/client-web/src/components/CareExperience.tsx:227–279`、`:318–328`、`:398–404`、`:555–562`；`apps/client-web/src/pages/product/CompanionPage.tsx:708–721`。
- **Android 本次没有找到与 Web 对等的本地日程调度器。** 实际可追踪路径是获取服务器 prompt（v3/v4 合成路径可含有界日程资料），初始化双工模型，然后持续发送音视频；Repository 只从 careSnapshot 取日程数量，不保留可逐项调度的 occurrence 集合。不能写成“给 Android 现有日程定时器加复核”。见 `apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/data/LighthouseRepository.kt:827–872`、`apps/client-android/app/src/main/java/com/sun/minicpmo_android/MainViewModel.kt:379–424`、`:745–788`、`apps/client-android/app/src/main/java/com/sun/minicpmo_android/network/RealtimeProtocol.kt:40–51`、`:77–92`；prompt 版本边界见下段。
- **复核目标 occurrence 还不够：Web 每次独立模型动作重新附带整个旧 prompt。** 对实际含日程 A 的 v3/v4 prompt，提醒 B 时也可能重新发送已暂停 A 的 `actionableCare`。两种 provider 的发送路径都要处理，不能只过滤业务事件中的标题／说明。见 `apps/client-web/src/runtime/session-runtime.ts:218–223`、`:542–558`；prompt 内的日程内容见 `apps/server-api/src/modules/companion-session/companion-prompt.ts:143–167`、`:195–210`。
- **可选的较弱承诺是“下次客户端显式提醒先复核，并且不重新注入失效日程”，不是“暂停成功后立即停止所有模型日程语音”。** 已进入持续双工模型的上下文不因读取过滤而撤回；GET 与外部模型发送也不是同一事务。若产品必须要求后一种强保证，需要另立输出／派发仲裁范围，不应以本轮 UI 或一次 GET 冒充完成。以下较弱方案必须先由用户选择，不能代替尚未决的在线会话范围。

版本限定：当前 composer 常量为 4；`promptVersion <= 2` 原模板直接返回，v3 才组装 care_context，v4 复用 v3 再加 live_context。日程数组受 3,000 字符 JSON 预算及字段截断限制，并记录省略数量；本文“旧 prompt 中的日程”仅指实际已合成进去的有界条目，不指完整未裁剪快照，也不推定所有线上／历史会话都使用 v4。证据：`apps/server-api/src/modules/companion-session/companion-prompt.ts:6`、`:33–43`、`:61–92`、`:143–167`、`:197–201`、`:215–253`。

## 2. Web：哪些路径实际发送日程

| 路径 | 静态事实与影响 | 源码证据 |
| --- | --- | --- |
| 初始化本地集合 | 设备 context／会话启动的 careSnapshot 映射为 `Routine`；`id` 为 routineId，同时保留 occurrenceId/version/status；DUE、AWAITING_CONFIRMATION 才 enabled。只更新 React 集合不等于更新已启动模型。 | `apps/client-web/src/pages/product/CompanionPage.tsx:180–219`、`:434–446`、`:620–623` |
| 初始化模型 | model response 的 prompt 原样变成 runtime override；hook 优先采用 override。云端初始化发送 `session.init`，本地双工发送 `session.update.instructions`。v3/v4 合成器放入有界 actionableCare，默认模板允许已授权日程所需的主动表达。 | `apps/client-web/src/pages/product/companion-session-config.ts:24–42`；`apps/client-web/src/hooks/use-omni-session.ts:346–363`；`apps/client-web/src/runtime/session-runtime.ts:971–986`、`:1147–1161`；`apps/server-api/src/modules/companion-session/companion-prompt.ts:8–16`、`:61–92`、`:143–210` |
| 自动到时 | 每秒更新时间；仅 live + observing 时在缓存找到期项，先写 `lastAutomaticRoutineRef` 再调用 trigger。已物化项只检查 enabled、DUE/AWAITING 和 scheduledAt 已到，没有本地失效上界。暂停发生在取快照后，缓存仍可能命中。 | `apps/client-web/src/components/CareExperience.tsx:112–115`、`:269–279`；`apps/client-web/src/agent/routine-scheduler.ts:11–33` |
| 发送／播报 | replay 用浏览器语音；真实 provider 调 requestModelAction，包装为确定性业务事件，经 runtime.sendTurn 发送。local 模型动作完成文本还会走浏览器语音合成。record 中的 serverBackedMode 判断仅禁止写演示事件，不构成提醒授权检查。 | `apps/client-web/src/components/CareExperience.tsx:127–146`、`:227–265`；`apps/client-web/src/hooks/use-omni-session.ts:254–278`、`:379–419` |
| 重复当前步骤 | 按钮及 voice repeat 都调用 repeatReminder，把缓存 currentRoutine.instructions 发给模型；未要求 awaiting_confirmation。只保护自动触发会遗漏此路径。 | `apps/client-web/src/components/CareExperience.tsx:318–328`、`:386–406`、`:555–562` |
| 本人确认／升级 | 确认先 GET 当前项，再用返回 version 发 POST；服务端物化项的自动家属升级不由此客户端 timeout 执行。当前确认重查不能证明主动提醒有同等保护。 | `apps/client-web/src/pages/product/CompanionPage.tsx:708–721`；`apps/client-web/src/agent/routine-scheduler.ts:78–95` |

另一个恢复可达性问题：当前 runtime 集合只在 context 加载、会话开始处设置；运行期间心跳更新在线／媒体指令，不更新日程。恢复若创建新 scheduleId/occurrenceId，单纯给旧缓存候选增加复核仍不会发现新项，需要一个当前项发现刷新入口。证据：`apps/client-web/src/pages/product/CompanionPage.tsx:434–446`、`:620–623`、`:324–339`、`:484–497`；本次对该文件所有 `setRuntimeState` 用例的检索只命中上述两处。

还应把“活动任务”的业务身份切换为 occurrenceId，而不是只按 routineId 查找：当前 currentRoutine 通过 `agent.activeRoutineId` 找第一个同 routine.id 的元素；恢复的新旧实例或同日多个实例可能具有相同 routineId。此处为风险推导，不是已复现故障。证据：`apps/client-web/src/pages/product/CompanionPage.tsx:201–218`；`apps/client-web/src/components/CareExperience.tsx:122–125`、`:230`。

## 3. Android：初始化日程上下文，不等于本地主动提醒

已追到的完整正向链路如下；结论范围仅限当前仓库源码，不替代对实际安装 APK 的检查。

1. `CompanionSessionBridge.prepare()` 只允许 AUDIO／VIDEO，调用 Repository 启动陪伴和模型会话。Repository 取 `prompt.content`，只将 careSnapshot 转成 memoryCount/routineCount；连接对象没有 occurrence 列表调度步骤。证据：`apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/data/CompanionSessionBridge.kt:10–15`；`apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/data/LighthouseRepository.kt:827–872`。
2. MainViewModel 将服务器 systemPrompt 写入有效连接配置，再连实时客户端。`RealtimeApiClient.sendSessionInit()` 发送一次 `session.init.system_prompt`。证据：`apps/client-android/app/src/main/java/com/sun/minicpmo_android/MainViewModel.kt:379–424`；`apps/client-android/app/src/main/java/com/sun/minicpmo_android/network/RealtimeApiClient.kt:105–110`；`apps/client-android/app/src/main/java/com/sun/minicpmo_android/network/RealtimeProtocol.kt:40–51`。
3. 后续双工发送音频／可选视频帧／force_listen，没有按日程内容构造提醒消息。一般 CHAT 发送来自用户 composer，不是日程调度，而且 CompanionSessionBridge 拒绝 CHAT。证据：`apps/client-android/app/src/main/java/com/sun/minicpmo_android/MainViewModel.kt:88–104`、`:745–788`、`:818–823`；`apps/client-android/app/src/main/java/com/sun/minicpmo_android/network/RealtimeProtocol.kt:53–92`；`apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/data/CompanionSessionBridge.kt:10–15`。

检索范围包括 `apps/client-android/app/src/main/java` 下的 current-occurrences／occurrences/current、systemPrompt、sendChat/sendDuplex、reminder/routine、AlarmManager/WorkManager 等，未定位到本地日程定时派发或调用设备当前项接口的实现。**这是有界源码负面证据，不是“Android 永远不会主动说日程”的证明**：v3/v4 初始化 prompt 可含 actionableCare，模型可根据既有上下文自行发言。共同的 prompt 组装来源为 `apps/server-api/src/modules/companion-session/companion-session.application.service.ts:1543–1575`、`apps/server-api/src/modules/companion-session/companion-prompt.ts:12–15`、`:61–92`、`:143–210`。

因此本轮最小原生处理是：保留新会话快照过滤、文案准确表达旧会话边界、回归现有会话归属；不要为了“补复核”顺带新增 Android 本地日程调度器。若要求 Android 当前双工会话也停止基于旧日程主动表达，则需要刷新／重建模型会话或可验证输出控制，已经超出“在现有主动触发前加 GET”的范围。

## 4. current-occurrences 可以复用，但不是派发许可证

实际路由为 **GET `/device/occurrences/current`**，本文将它简称 current-occurrences。Web 已有 `deviceSession.currentOccurrences()`。证据：`apps/server-api/src/modules/care-workflow/http/device-occurrences.controller.ts:27–36`；`apps/client-web/src/device/device-session.ts:464–466`。

- 它验证设备 COMPANION 能力、bindingId/bindingVersion/device/household/recipient 的有效绑定，再查当前家庭／长者 ACTIVE routine 和 active schedule。暂停正确改变这些服务端生命周期后，后续查询会排除该规则。证据：`apps/server-api/src/modules/care-workflow/care-workflow.application.service.ts:505–536`。
- 它最多返回 **32 条**，包含未来 **24 小时**内 DUE，以及 AWAITING_CONFIRMATION、NEEDS_FAMILY_REVIEW；不是“现在可以播报”的纯列表。触发前必须再次筛状态为 DUE/AWAITING、时间已到、目标 occurrenceId 与家庭／长者吻合；NEEDS_FAMILY_REVIEW 不可当作普通日程提醒。返回视图有 householdId、recipientId、scheduleId、version、最新 instructions，可直接使用，不应继续发送旧 instructions。证据：`apps/server-api/src/modules/care-workflow/care-workflow.constants.ts:46–47`；`apps/server-api/src/modules/care-workflow/care-workflow.application.service.ts:531–564`；`apps/client-web/src/api/types.ts:159–175`。
- **缺失即不发送，但不能把缺失解释成“已暂停”。** 也可能已结束、规则替换、权限变化或超出 32 条截断窗口。接口没有单项存在性证明或分页完成标记；最小方案只能 fail-closed 并显示“日程已变化／当前不可提醒”。若要求超过 32 条仍完整派发，需要另扩分页／按 occurrence 校验契约，不能声称现有接口天然覆盖所有项。证据同上 `:537–564`。
- **权威读取与实际发送存在 TOCTOU。** 服务端查询完成后到客户端把消息交给独立模型连接之间，另一家属仍可暂停；接口既不持有派发锁，也不返回可在模型侧核验的租约。即使多加一次 GET，最后一次读取之后仍存在间隙。此为上述 GET 和客户端直接 sendTurn 链路的并发推导，非实测。

## 5. 建议最小完整方案（只覆盖下一次客户端显式触发）

仅在用户明确接受下列在线会话边界后才可采用本节：**“每次客户端主动提醒／重复日程前须成功读取当前状态；读取已排除或当前不可行动的日程不发送；网络失败不使用缓存补发。已经交给模型的上下文、正在生成／播放的内容不承诺撤回。”** 预发送复核只保证服务端读取这一刻的顺序：暂停先提交、随后开始的读取必须排除；它不保证整个“暂停→模型发送”原子性。对读后才并发提交的暂停，不能宣称零迟到。范围尚未选择或不接受此边界时，停止进入实现；不能以本节有限方案自行降低承诺。

### 5.1 Web 统一入口与新实例发现

建议提取一个可注入 `readCurrent`、`clock`、`sendAction`、`owner` 的运行时控制器；下述均为待实现设计。

1. 自动发现 tick 与手动／语音 repeat 使用同一个 owner-scoped single-flight lane。运行且可触发时定期读 current-occurrences；用**该次权威结果**替换当前缓存并选到期项，发现恢复的新 occurrence。不要只循环旧 snapshot，也不要每秒 latest-wins 把慢请求永久作废。可复用当前 `CompanionPollingGate` 的 epoch／single-flight 思路，但仍需显式检查 owner，证据：`apps/client-web/src/realtime/companion-polling-gate.ts:11–51`。
2. 明确区分 pending 校验、已交付发送、失败／不确定结果。网络读取失败不 dispatch ROUTINE_DUE、不记已提醒；释放 lane 后有限退避重查，不离线排队补发。发送一旦已经交给网络但返回失败，可能实际已播报，不能自动重试并伪称 exactly-once；标记不确定并允许用户重新发起后再次复核。现有“请求前写 lastAutomaticRoutineRef”需替换，否则一次读取失败会吞掉当前 occurrence；现状见 `apps/client-web/src/components/CareExperience.tsx:275–278`。
3. 对 absent/失效项立即清除该 occurrence 的 UI 活动态；清理“我完成了”和重播的旧目标，不要退回同 routineId 的另一实例。确认动作继续用最新 version，但也纳入同一 owner 守卫。现有目标查找和确认路径见第 2 节。
4. 重播日程时重新读取并只重播精确 occurrenceId 的最新说明。无有效日程时，不可用“重复刚才提醒”作为兜底让模型重述旧日程；可以保留不含日程的中性说明。自动与人工重播互斥或去重，避免同一次读成功触发两次。

### 5.2 下一次发送不得重新携带整个旧日程列表

建议在服务器模型连接契约中额外提供一个**不含日程条目的、服务器组装的业务动作基础 prompt**（如 `actionPrompt`，actionableCare 可为空），保留模板安全边界、权限、长者和记忆等现有内容。Web 的日程 sendTurn 接受显式 per-turn prompt override，local/cloud 两支都用该基础 prompt + 本次权威校验过的单项日程；不要默认再附带旧 `options.prompt`。不要从完整 prompt 中用字符串／正则删除 JSON，也不要客户端自行重造服务器模板。该新增契约应有明确版本／能力标记，保持旧 composer 分支语义冻结，不把历史 v1/v2 模板静默解释为已支持隔离的动作 prompt；历史分支约束见 `apps/server-api/src/modules/companion-session/companion-prompt.ts:69–89`。

这是针对已核实的两处旧 prompt 复用的设计：`apps/client-web/src/runtime/session-runtime.ts:218–223`、`:542–558`；服务器集中组装可落在 `apps/server-api/src/modules/companion-session/companion-session.application.service.ts:1559–1572` 对应契约。完整双工初始化 prompt 可暂维持现状，但它属于已进入模型的不可撤回范围。旧连接没有 actionPrompt 时应禁用该受保护动作并提示重新开始，不能悄悄回退完整旧 prompt。该方案不会赋予 Android 新调度能力，也不会使已有双工模型忘记旧上下文。

### 5.3 会话／家庭／长者切换与迟到结果

建议每个提醒请求捕获不可变 owner：`deviceId + bindingId + householdId + recipientId + companionSessionId + runtime identity + generation`；A→B→A 也必须改变 generation，不能只比字符串 scopeKey。请求发出前、每次 await 后、真正 send 前、成功／失败 UI 回调前都重新核对。stop、卸载、凭据／绑定变化、角色切换、远程通话接管要同步失效并取消在途请求；取消是优化，generation 判断才是迟到响应的最终防线。

已有可复用边界，但尚不能当成新提醒 gate 已完成：

- Web 启动生命周期有 generation；停止及卸载会失效，hook stop 清理 runtime 和浏览器语音。提醒回调目前没有同样 owner 参数；旧 `requestModelAction` 回调失败仍会写 session 状态。证据：`apps/client-web/src/realtime/companion-start-lifecycle.ts:17–48`；`apps/client-web/src/pages/product/CompanionPage.tsx:309–319`、`:570–587`；`apps/client-web/src/hooks/use-omni-session.ts:135–154`、`:379–419`。
- 家属管理页的家庭／长者 selection 与设备绑定不是一件事。Web DeviceContext 单独提供 device/binding/household/recipient；家属日程页按 workspaceScopeKey+Epoch 清理页面。不能把家属选择的长者当成正在陪伴设备的目标。证据：`apps/client-web/src/api/types.ts:382–390`；`apps/client-web/src/pages/product/RoutinesApiPage.tsx:266–283`。
- Android 家属 selectHousehold/selectRecipient 更新自己的 familyOperations/workspace load；陪伴实际连接走设备启动 API，不以家属当前 selection 作为参数。会话自身已有 CompanionSessionOwnership generation、MainViewModel connectionGeneration 和 mediaGeneration，并对指定 sessionId 的 STOP 做归属检查。证据：`apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/LighthouseViewModel.kt:367–410`；`apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/data/LighthouseRepository.kt:827–870`；`apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/data/CompanionSessionOwnership.kt:20–78`；`apps/client-android/app/src/main/java/com/sun/minicpmo_android/MainViewModel.kt:114–138`、`:164–187`、`:379–445`。

失联时先禁止新的日程动作，不应把某次旧失败施加到新会话。当前 Web 已有按 activeCompanionId 归属的心跳与媒体停止路径，可作为行为模板；它不是日程缓存同步。证据：`apps/client-web/src/pages/product/CompanionPage.tsx:324–353`。原生也有按 ticket 应用心跳失败／停止后清理的路径，证据：`apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/data/LighthouseRepository.kt:784–824`。

## 6. 可测试接口与验收（均未执行）

| 检查层 | 可复用测试入口／现有证据 | 本轮必须新增的断言 |
| --- | --- | --- |
| Server 读取／prompt | `apps/server-api/src/modules/care-workflow/care-workflow.application.service.spec.ts:648–677`；`apps/server-api/src/modules/companion-session/companion-session.care-snapshot.spec.ts:140–214` | 暂停提交后 GET 和新模型快照排除该规则，其他日程保留；恢复新代可读；无绑定／无能力拒绝；32 项截断明确；actionPrompt 无任何日程而完整 prompt 契约仍可区分。Mock 查询断言之外仍需隔离数据库验证真实过滤。 |
| Web 纯规则／transport | `apps/client-web/src/agent/routine-scheduler.test.ts:56–95`；`apps/client-web/src/device/device-session.test.ts:241–268` | 新 runtime gate 以 Deferred+fake clock 注入 readCurrent/sendAction；断言没有模型调用，而不只断言字符串包含 GET。现有 device test 仅证明调用路由和 version 传递。 |
| Web single-flight／ownership | `apps/client-web/src/realtime/companion-polling-gate.test.ts:48–99`、`:162–197` | 请求慢于 tick 不饥饿／不重叠；stop、卸载、绑定变更、A→B→A、session A→B 后旧成功／旧失败都不发送、不改 B UI；旧句柄绝不能改用 runtimeRef 中的新 runtime 发送。 |
| Web provider payload | `apps/client-web/src/runtime/session-runtime.ts:173–223`、`:514–558` | local HTTP 与 cloud turn 分别捕获真实构造 payload；A 暂停但 B 仍有效时，发送 B 的整个 payload 均不含 A 的 occurrence/title/instructions；缺 actionPrompt 不回退。初始化与后续独立动作分开验。 |
| Android 初始化／归属 | `apps/client-android/app/src/test/java/com/sun/minicpmo_android/MainViewModelCompanionDirectiveOwnershipTest.kt:47–116`；`apps/client-android/app/src/test/java/com/sun/minicpmo_android/lighthouse/data/CompanionSessionOwnershipTest.kt:24–61` | 新连接取新 prompt；启动中 stop/重新连接使迟到 prepare 无法应用；旧 STOP 不停止新会话；不捏造“本地日程触发调用次数”作为已有功能的验收。 |

建议验收顺序：

1. 缓存中有到期 A，在读取 current 前完成暂停：自动 tick、按钮 repeat、语音 repeat 均零发送；状态为 NEEDS_FAMILY_REVIEW、未来 DUE、已消失／替代 occurrence 同样零发送。
2. A、B 都在初始 prompt；暂停 A，B 到时：只发送 B 的最新说明，检查整个 model payload 未重带 A。用更新过的说明证明没有继续引用旧缓存。
3. 暂停后恢复形成新 occurrence：不重启 Web 会话也能经发现刷新看到新项；旧 occurrence 不复活；同一 routine 的旧、新及多个日内实例不能混淆。无未来匹配时保持无提醒。
4. Deferred 固定暂停／读取／发送的顺序：分别覆盖“暂停提交后开始读”“读成功后暂停、发送尚未发生”。前者必须阻止；后者记录为本方案 TOCTOU 边界，不能伪报强保证。另测读取超时、网络失败、发送结果不确定，不自动补发旧指令。
5. 在读请求 pending 时执行停止、远程通话接管、退出／切角色、重新绑定、家庭／长者 A→B→A、新会话 B 启动；旧成功、旧失败均不能使新会话说旧日程。记录 family selection 与 device binding 分别变化的测试，不能混为一项。
6. 最后用 Web local/cloud 和真实 Android 分别做端到端观察，记录初始化 payload、独立动作 payload、声音实际播放时刻、暂停提交时刻。模型基于既有上下文自行发言要单列，不应错误归因为客户端定时器漏挡。

## 7. 未知与明确非保证

- 未运行测试、构建、数据库合同、服务或真实设备；未检查线上版本、APK 构建差异、模型服务是否额外调度／缓存上下文。客户端静态路径不能证明模型端行为。
- 不知道模型在旧双工上下文中何时自行触发日程话语；没有可证实的单条上下文撤回协议。文案不可承诺“暂停后当前会话马上忘记”或“已经排队的语音必定撤销”。
- GET 不与模型 send 原子化；轮询只改善发现延迟，推送也不自动解决原子派发和已进入模型的内容。需要严格零迟到时，必须明确服务端派发／模型输出仲裁与暂停的共同排序机制，而非增加客户端轮询频率。
- 32 条有界列表的缺失必须保守抑制，不能保证任意规模下全部提醒可达。时钟偏差、慢模型返回、音频队列、跨日／时区、重连旧 prompt 的行为仍需单独实测。
- 本方案不新增 Android 日程调度、不增加全局暂停、不强制中断所有陪伴会话、不让暂停变成任务完成；服务端生命周期、恢复代际／生效下界仍按主研究另行批准实现。

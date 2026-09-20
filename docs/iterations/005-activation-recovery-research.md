# 005 调研：设备激活结果一致性与恢复边界

调研日期：2026-09-20。公开官方资料访问日期同上；代码核对基线为 `main / 81531c5`，相邻 004 收尾改动不在本调研范围。按 research 技能只读核对产品资料与 Server / Web / Android 源码，未登录竞品、操作真实设备、运行浏览器或模拟器，也未执行测试。本文是候选迭代依据，不是根因结论或完成报告。

## 现象与用户需求

主线本地浏览器 QA 已再次观察到：陪伴设备显示绑定尾号 `C26H9T`，只读自检通过真实 API 返回成功时，仍同时保留“激活请求已经结束，不能重复使用”红色提示（请求编号 `01M2YY51MD61JHSN573YJA3R8P`）；之后自检结果到期，旧提示仍在。本调研未操作该浏览器，也未发起新的激活。这个现场证据确认“可用设备与旧激活错误同屏”，但没有重放产生错误的请求顺序；具体触发路径、原始响应码和并发关系仍需确定性复现，不能直接认定根因。

候选需求：家属和陪伴设备应对同一次设置得到不矛盾的结果，知道现在是在等待谁、已经完成哪一步、能否继续恢复，以及必须在哪一端重新生成凭据。成功激活不等于当前在线、媒体可用或模型可对话；这些仍属于 004 自检维度。

## 三组官方证据与可借鉴原则

| 产品／平台 | 官方资料支持的事实 | 对本项目的推论，不是竞品效果证明 |
| --- | --- | --- |
| Google Home / Nest | Nest 温控器文档区分“已连 Wi-Fi”与“已加入账号”；提供二维码之外的输入码路径，并建议重开 Home 检查设备是否出现在面板。音箱／屏幕的设置卡住、无法连网、设备未出现分别有重启、重试或重开应用的步骤。[温控器关联排障](https://support.google.com/googlehome/answer/9248705?hl=en)、[音箱与屏幕设置排障](https://support.google.com/googlehome/answer/15542711?hl=en) | 网络连通不是绑定成功；应展示有依据的阶段，并给与阶段对应的下一步。本轮不照搬重启路由器或恢复出厂设置。 |
| Home Assistant Companion | 官方 onboarding 在找不到服务器时允许手输地址，认证后命名设备，完成连接后进入 dashboard；完整重置单列为排障流程，包含清理客户端数据与服务端 mobile app 记录，而不是一般连接重试。[初次设置](https://companion.home-assistant.io/docs/getting_started/)、[Android 重新开始的边界](https://companion.home-assistant.io/docs/troubleshooting/faqs/#starting-fresh-with-the-android-app) | 成功应有明确落点；“重试检查”和“清空身份重新设置”必须区分，不能把一次请求失败自动升级为重新绑定。 |
| Google 受限输入设备授权流程 | 用户在另一台设备批准，请求端按返回的间隔轮询；未批准、拒绝、轮询过快和获得 token 分开处理；code 有有效期，超期未完成需要从获取 code 开始。官方 API 参考另外明确区分 `authorization_pending`、`slow_down`、`expired_token`。[设备授权流程](https://developers.google.com/identity/protocols/oauth2/limited-input-device)、[API 错误语义](https://developers.google.com/identity/openid-connect/reference) | 等待批准是正常进度；过期应停止旧请求并明确获取新码，暂时失败则保留可恢复进度。这是双端授权的交互类比，不是要求改用 Google 登录或 OAuth，也不照搬其 HTTP 状态码。 |

以上资料不能证明本项目错误原因，也不能证明用户满意度或激活成功率会提高。

## 当前实现证据

- **Server 已有分阶段协议和安全恢复，不缺通用“重试激活”接口。** 状态查询返回 `PENDING / CLAIMED / APPROVED / CONSUMED` 及失败终态；`CONSUMED` 可取得与安装、版本、批准时间绑定的恢复 token。已消费 exchange 必须验证对应安装私钥签名、token、有效绑定及未轮换／撤销／过期的原始凭据，并推进版本防重放。见 [状态查询与恢复入口](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/device-activation/device-activation.application.service.ts:355)、[受限凭据恢复](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/device-activation/device-activation.application.service.ts:1053)。
- **错误文本本身不能定位失败步骤。** `ACTIVATION_ALREADY_CONSUMED` 对应上述中文文本；公共终态检查会把 `CONSUMED` 和 `CANCELLED` 都映射至该错误，审批详情、批准等路径也调用此检查。它不等价于“设备未激活”，也不能单凭文本断定重复 exchange。见 [错误定义](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/device-activation/device-activation.errors.ts:55)、[终态映射](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/device-activation/device-activation.application.service.ts:1607)。
- **Web 家属页存在值得定向验证的展示路径。** `DevicesPage.poll` 先查状态，再在 `CLAIMED` 时查受保护审批详情；错误写入共享 `error`，后续成功状态未在该函数清除它。`CONSUMED` 会刷新绑定列表，但 JSX 仍展示二维码和“取消本次激活”；失败终态仍显示原始状态名。每两秒轮询用的是 `LatestScopedRequest`，不是独占在途请求。以上是源码事实，不能替代现象复现。见 [轮询](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/pages/product/DevicesPage.tsx:76)、[终态展示](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/pages/product/DevicesPage.tsx:293)。
- **Web 陪伴页已有恢复和持久化防护。** 激活轮询有局部在途保护、epoch 和 exchange gate；允许 `APPROVED / CONSUMED` 进入兑换／恢复。网络、5xx、408、429 可重试，恢复冲突在第 5 次停止；凭据写入失败保留恢复句柄。成功分支写入 notice，循环错误写入同一个页面 `error`，仍需行为测试验证二者收敛，不能一律清除该页面其他功能错误。见 [激活循环](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/pages/product/CompanionPage.tsx:735)、[重试策略](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/device/activation-polling-policy.ts:1)、[先持久化再发布凭据](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/device/device-session.ts:321)。
- **Android 不能预设与 Web 同病。** Repository 已先持久化 pending，再轮询；兑换先保存 credential 后清除 pending。ViewModel 按 challenge、generation、展示票据限制旧结果，真正保存凭据后收敛到锁定陪伴模式，启动时 credential 胜过残留 pending；禁止已有凭据／pending／在途认领时重复认领。暂时可重试失败没有直接套用 Web 的每次报错显示策略。见 [Repository](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/data/LighthouseRepository.kt:600)、[激活轮询和收敛](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/LighthouseViewModel.kt:1472)、[重复认领保护](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/LighthouseViewModel.kt:1822)。

基线注意：以上结论均以本次 checkout 源码为准。已有 `plans/005-android-activation-presentation-ownership.md` 是另一编号序列中的已完成计划，不是本轮 iterations/005 的新需求。

## 先做的诊断复现，不是根因猜测

遵循 diagnosing-bugs 的“先有能判红的反馈环”门槛；本调研没有这样的已运行复现，故不选根因或实现方案。下一阶段最小验证应当：

1. 固定一组家属页＋陪伴页、同一个 challenge 和安装实例；记录页面路由、请求动作、脱敏关联 ID、时间、状态／错误码、credential 持久化是否完成。不记录二维码 secret、动态码、token、签名或完整网络地址。
2. 用可控 Deferred transport 驱动实际页面链路，验证“同一次激活的权威成功完成后，仍出现旧激活失败提示”这一精确断言。分别覆盖家属状态／审批详情两步和陪伴端状态／兑换／持久化／context；先定位实际报错端点，不用只测文案映射或源码字符串断言代替。
3. 调整响应顺序：慢于 2 秒的状态查询、审批详情在批准或取消后返回、一次可重试失败后恢复、exchange 已提交但响应丢失、凭据持久化失败后重开。另测新 challenge／家庭切换后的旧成功与旧失败。先复现实际现场路径，再将其余列为邻近回归，避免凭“可制造”就认定现场根因。
4. 保存一条可重复运行、已观察到失败的目标测试命令及结果，再决定修改点。若只能重现成功，记录缺失的响应序列／现场证据，不宣称定位或修复完成。

## 候选范围与验收

默认不改协议、不迁移存储、不扩展诊断面板；由上面的失败复现决定源码变更范围。

| 范围 | 候选验收边界 |
| --- | --- |
| Web 家属激活页 | `CLAIMED` 明确“等待家属核对批准”；`APPROVED` 明确“等待设备完成”；`CONSUMED` 表示该邀请已完成，移除旧码继续使用和取消入口，提供继续添加的明确入口；过期／取消／次数耗尽有中文原因和由家属生成新码的下一步。新码仅用户显式发起。绑定列表刷新失败与激活失败分开表达。 |
| Web 激活结果一致性 | 同 challenge 的旧激活请求错误不能在权威成功后覆盖结果；后续成功只清除归属该激活过程的过时错误，不吞掉权限、context、心跳、媒体或安全错误。家属状态、详情及操作在慢响应与切换作用域后不饥饿、不并发堆积、不跨对象写回。 |
| Web 陪伴设备恢复 | 等待批准不显示失败；响应丢失可走现有安装证明恢复；本地凭据未确认落盘前不宣称设置全部完成。恢复期间保留需要的安装身份／pending；明确终态才要求新码。已具备凭据但 context／在线检查失败应说明后续状态未同步，不能要求用户重复绑定。 |
| Server | 先用现有服务测试锁住单次消费、审批快照／权限、过期、失效恢复 token、重放与撤销边界；仅在复现证明返回契约确实不足或有缺陷时修改。不得为消除报错而把任何 `ALREADY_CONSUMED` 无条件当成功，也不得绕过安装证明。 |
| Android | 优先验证现有成功、等待、终态与重开恢复是否满足同一用户语义；只有可复现差异才补最小展示／错误归属修改。不为“覆盖三端”无依据重构；即使无源码变更，也保留既有激活所有权和持久恢复回归。 |

“激活完成”的依据按所处端区分：家属端确认服务端已消费邀请／绑定已建立；陪伴端确认自己的凭据已保存。若两端尚未同步，应如实说明等待设备完成或状态暂未更新，不用“正在发送心跳”代替已验证在线。

## 必须保留的保护与非目标

- 审批前核对设备快照；审批幂等键、最新授权复查、安装私钥和不可导出能力协议、恢复 token 新鲜度与一次性、绑定撤销与凭据轮换检查不可弱化。现有 [Server 激活回归](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/device-activation/device-activation.application.service.spec.ts:562) 已包含对应案例，本轮仅核对存在，未运行。
- Web 保留 exchange single-flight、失败后可释放 gate、在途不得 reset、IndexedDB 提交失败保留恢复入口。见 [exchange gate 回归](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/device/activation-exchange-gate.test.ts:4)、[持久化回归](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/device/device-session.test.ts:72)。
- Android 保留旧认领不得劫持新登录、旧终态不得污染新页面、协程取消不删除 pending、真实 credential 落盘仍收敛且胜过 pending、激活后退出家属身份的边界。见 [Android 激活展示所有权回归](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-android/app/src/test/java/com/sun/minicpmo_android/lighthouse/LighthouseViewModelActivationPresentationOwnershipTest.kt:68)。

非目标：自动批准／重绑／撤销设备、清理用户凭据或恢复出厂、跨设备迁移私钥、替换激活协议、后台持续探测、重新设计 004 自检、引入 Google 登录／蓝牙配对、扩展管理员能力、保证通话／模型质量。任何安全协议变更都需单独论证，不能由一条残留错误文案直接推出。

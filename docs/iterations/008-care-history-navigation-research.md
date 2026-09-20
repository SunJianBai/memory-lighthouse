# 008 候选调研：照护记录筛选与历史查询

调研日期：2026-09-20；静态源码基线：`37729075b9354ad9edd0675457c631033bea7f18`。本轮承接 [007 实施与验收](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/docs/iterations/007-care-history-readability.md:1)及[007 调研](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/docs/iterations/007-care-history-readability-research.md:1)，按 research 技能核对官方产品帮助与 Server / Web / 原生 Android 源码。只新增本文；未运行测试、访问数据库、使用本地浏览器／模拟器、启动服务、提交、推送或部署。以下是单一候选的研究结论，不是已实现功能或已批准的产品承诺。

## 1. 结论与用户价值

**值得做的最小候选是“当前长者的有界历史浏览”，不是全文搜索系统。** 家属回看前几天的提醒核验，或查找已被新动态挤出前 30 条的记录，目前缺少可见入口。第七轮已解决“读不懂状态与时区”，本轮应解决“到哪里看更早的记录”，继续保留原有近期安排与核验入口。

这是从下列源码约束推导出的可验证可用性缺口，不代表已访谈用户、统计到真实家庭记录量或证实留存提升。历史查询只能返回已存储、当前有权访问的数据；没有记录不等于长者没有行动，也不承诺恢复未生成、已删除或已清理的数据。

## 2. 官方竞品依据（仅 3 项 primary sources）

| 官方来源与已核实功能 | 对本候选的启示 | 不应照搬或过度推断 |
| --- | --- | --- |
| [Google Calendar：Search on Google Calendar](https://support.google.com/calendar/answer/37176?co=GENIE.Platform%3DDesktop&hl=en)，正文“How to search / Filter your results / I don't see all past events”：可查过去与未来事件，可按日历及日期范围收窄；官方明确搜索最多返回 200 个事件，并建议查不到旧事件时缩小日期范围。 | 给出日期入口和结果覆盖边界；“未显示”不能直接解释为“不存在”。 | 200 是 Google 的产品限制，不是本产品应照抄的容量；不能由此声称需要全文检索或无限保留历史。 |
| [Apple Reminders：Create custom Smart Lists on Mac](https://support.apple.com/guide/reminders/create-custom-smart-lists-remnfec66479/mac)，正文“Create a custom Smart List”第 7 步：日期可选指定起止范围或过去／未来的相对范围。 | “选定一段时间”是已有用户功能模式；相对近期与明确日期范围应在界面上区分。 | 不需要复制智能列表、标签体系、任意 AND/OR 规则或保存筛选器；这些不是本轮已证实的问题。 |
| [Microsoft：Manage tasks with To Do in Outlook](https://support.microsoft.com/en-us/outlook/calendar/manage-tasks-with-to-do-in-outlook)，正文“Open To Do…”及“Add due dates…”：分别有 Planned、Completed 等列表，Planned 可查看今天、明天及之后的任务。 | 回看历史与查看未来安排是不同意图；增加历史入口时不应悄悄移除现有未来 7 天提醒。 | Microsoft 的 Completed 不能替代本产品的 CONFIRMED／EXPIRED／待核验语义；“已关闭”仍不等于“已完成”。 |

上述页面于本次调研直接读取；仅用于证明这些官方用户功能与设计边界，不推断其内部实现、性能、用户偏好或本产品收益。

## 3. 当前链路：已有能力与精确限制

### Server

- **提醒查询已支持条件，不是后端完全不能查历史。** `OccurrenceQueryDto` 只有可选 `from`、`to`、字符串 `status`；日期用 `IsISO8601` 验证，未在该 DTO 中验证起止先后、跨度、分页或状态枚举。Controller 转成 `Date`；Service 按 `scheduledAtUtc >= from && scheduledAtUtc < to` 及状态过滤，按时间降序，无 `take`、cursor、总数或 `hasMore`，同一时间没有 ID 次序。客户端若请求更早范围，服务端能够读到该范围已有实例。[DTO](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/http/care-workflow.dto.ts:128)、[Controller](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/http/occurrences.controller.ts:29)、[Service](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/care-workflow.application.service.ts:506)
- **动态查询目前没有条件。** `GET …/events` 不接收查询 DTO；Service 只按家庭和长者过滤，按 `occurredAt desc, id desc` 返回全部记录，没有日期、类型、级别条件或服务端条数限制。不能把它描述为“后端最多 30 条”。[Controller](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/http/occurrences.controller.ts:87)、[Service](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/care-workflow.application.service.ts:826)
- **不是从零建立权限隔离。** 两个列表先要求 `VIEW_EVENTS`，数据库条件同时包含 `householdId` 与 `recipientId`。策略验证有效家庭成员、长者确属该家庭且有效，以及角色／照护授权；OWNER 的既有规则与普通 CAREGIVER 不同，不能新增历史接口时自行简化成“登录即可”或“一律检查 canViewEvents”。[策略入口](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/household/domain/household-access.policy.ts:54)、[角色及能力规则](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/household/domain/household-access.policy.ts:158)
- **全文搜索不是廉价的条件扩展。** 事件标题／摘要为加密列，列表投影逐条解密；提醒标题及说明从关联的当前 routine 投影。因此不能给加密列直接加 `contains`，也不能将提醒列表描述为完整的历史正文快照或逐次状态变更审计。[事件模型](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/prisma/schema.prisma:811)、[提醒／动态投影](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/care-workflow.application.service.ts:1579)

### Web

- `RoutinesApiPage.load` 每次固定计算 `now - 24h` 至 `now + 7×24h`，不发送 `status`；这是滚动绝对时间窗，不是长者时区的“昨天到未来第七天”自然日。动态先完整下载，随后 `slice(0, 30)` 放入页面状态。[请求](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/pages/product/RoutinesApiPage.tsx:136)、[截取](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/pages/product/RoutinesApiPage.tsx:214)
- 提醒与动态区域没有日期／状态筛选或“加载更多”；提醒徽标是当前结果中非 CONFIRMED／EXPIRED 的数量，动态徽标是已保留条数，均不是全量历史计数。第七轮中文状态与长者时区展示已在实际区域接入，不需要重做。[提醒区域](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/pages/product/RoutinesApiPage.tsx:662)、[动态区域](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/pages/product/RoutinesApiPage.tsx:733)
- 已有 `LatestScopedRequest`、scope key 与 epoch 校验，切换工作区清空旧数据。手动筛选可以沿用其最新请求归属思路，但分页必须另外绑定筛选条件和 cursor，不能只看长者 ID。现有核验成功后调用 `load()`；新增条件后该回刷必须继续尊重当前查询。[归属及清空](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/pages/product/RoutinesApiPage.tsx:148)、[核验回刷](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/pages/product/RoutinesApiPage.tsx:460)、[已有迟到响应测试](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/pages/product/RoutinesApiPage.test.tsx:161)

### Android

- `loadRecipientResources` 同样固定 `now.minus(1, DAYS)` 至 `now.plus(7, DAYS)`；初载动态 `.take(30)`，核验完成的另一条回刷路径也 `.take(30)`。只修初载会在核验后丢失历史结果。[初载](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/LighthouseViewModel.kt:1313)、[核验回刷](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/LighthouseViewModel.kt:555)
- Repository／路径构造仅给提醒传 `from/to`，没有状态或分页参数；动态只传家庭与长者。[Repository](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/data/LighthouseRepository.kt:371)、[路径构造](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/data/FamilyApiContract.kt:157)
- `CareSection` 中已有筛选只作用于**家庭待办**，不是提醒／动态；两个记录区域直接渲染其列表。不要把家庭待办筛选再实现一遍，或错称本轮历史记录已能筛选。[CareSection](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/ui/FamilyManagementScreen.kt:1362)
- 切家庭／长者启动新的 generation 并清空长者资源；加载完成检查归属及所选家庭／长者。新历史查询要同时防同一长者下不同条件、同条件刷新与加载更多的竞态，保留退出登录／角色切换的失效处理。[切换入口](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/LighthouseViewModel.kt:366)、[提交结果前检查](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/LighthouseViewModel.kt:1347)、[generation 实现](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/LatestFamilyWorkspaceLoad.kt:18)

**真正缺口汇总：** 更早提醒没有 UI 查询入口；第 31 条及之后的动态被客户端丢弃；日期／状态条件无法由用户选择；现有列表协议不能可靠表达分页完成与结果边界。源码能证实这些约束，不能证实线上已经存在多少被隐藏记录或多少性能问题。

## 4. 建议的最小范围

### 页面与语义

1. 保留两端既有记录卡片及默认近期视图，不新增导航页或看板。提醒默认仍可看近期及未来安排；动态默认显示最新一页。明确标出当前范围及“已加载 N 条”，不要写成“历史共 N 条”。
2. 在既有记录区域提供轻量“查看历史”入口，展开开始／结束日期、查询和恢复近期按钮；日期输入草稿与已应用条件分开，点击查询再请求。历史初始可预填最近 7 个长者当地自然日，并允许选择更早日期；7 天只是建议默认，不是数据保留期。提醒另给单一状态选择：全部及已有五种中文状态；动态先只做日期，不增加来源／类型／级别组合面板。
3. 两类记录保持各自查询结果与加载状态，条件不影响日程规则、今日照护或家庭待办。提醒按**计划提醒时间**查询、状态为查询时当前状态；动态按**发生时间**查询。某日核验了前一天提醒时，两者日期不同是正常语义，不应强行拼成同一条时间线。
4. 日期包含用户所选结束日，基准沿用第七轮的**当前长者档案时区**，查询边界与卡片显示一致。建议服务端由本地日期算成 `[开始日零点, 结束日次日零点)`；不要在浏览器用 `new Date('YYYY-MM-DD')` 当长者午夜，也不要用固定 24 小时拼接夏令时自然日。现有今日照护已在服务端读取长者时区并使用本地日窗，可作为复用起点，但不是任意日期范围已经实现的证据。[今日照护](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/today-care.service.ts:29)
5. 每页建议 30 条，服务端验证硬上限；有后续时显示“加载更多”，结束才显示“本次查询已加载完”。范围无记录、加载失败、无权访问是不同状态。单次查询可限制跨度（建议最多 31 个自然日）并提示分段查询，但不能禁止选择更早的月份或把该限制说成只保留最近 31 天。

### Server 最小契约与兼容

- 日期／状态必须在数据库查询中先过滤，再按稳定顺序分页，最后仅解密／投影这一页。不能对当前 Web `slice(0,30)` 或 Android `take(30)` 再 `.filter()` 却宣称“历史查询”；也不应通过全量下载、全量解密来实现新历史入口。
- 建议两类结果均返回 `{ items, nextCursor }`；固定页大小或受验证的 `limit`，内部取 `limit + 1` 判断后续，无需为本轮新增昂贵总数。提醒排序补 `id desc`；动态沿用现有双降序。游标以相应时间和 ID 续查，并与家庭、长者、日期、状态等查询上下文绑定；每页重新执行原授权。篡改／跨作用域／与条件不匹配的游标不能越权，也不能静默查询另一范围。
- 原接口返回数组，直接改成 envelope 会破坏现有两端及其他调用者。建议增加明确的分页读端点（如 `…/occurrences/history`、`…/events/history`，最终命名由实施计划确定），复用现有查询／投影与权限，不复制状态机；两端的新列表和核验回刷接入该契约。保留旧数组契约兼容，不能声称由此已消除所有旧端点的无界读取。
- 新 DTO 应明确真实存在的日期、起止顺序、跨度、页大小、状态白名单与游标大小／格式；无效时区不回退为查看者时区。新增分页并不要求变更历史数据或加搜索表。现有索引有提醒的 recipient/status/time 和动态的 recipient/time；这不等于所有新查询都已性能达标，后续需根据查询形状及隔离数据证据决定是否补索引，不在调研阶段无证据强加迁移。[提醒索引](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/prisma/schema.prisma:784)、[动态索引](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/prisma/schema.prisma:837)

## 5. 三端可行性与实施风险

| 端 | 可复用基础 | 必要工作与风险 |
| --- | --- | --- |
| Server | 现有 `VIEW_EVENTS`、家庭／长者过滤、UTC 字段、投影与时区日窗 | 增加有界读契约、日期条件与稳定分页；保持旧客户端兼容。无需修改确认／关闭状态机。 |
| Web | 已有卡片、中文标签、长者时区、最新请求与 scope/epoch 归属 | 增加小型查询状态与可访问表单；查询和分页独立于其他资源；重复“加载更多”单飞，同一 scope 的旧条件成功／失败均不得覆盖新条件。 |
| Android | 原生 Compose、Repository／路径映射、generation、长者资源清空 | 扩展查询 DTO／分页解析和独立状态；保持 LazyColumn、键盘与小屏可用；初载、刷新、核验后的更新路径都使用当前条件，不能重新退回 take(30)。 |

筛选后的核验不增加权限：仍使用既有命令、版本和确认流程；状态改变后重新查询或按条件移除已不匹配项。历史结果是实时查询视图，不是跨多页数据库快照：翻页期间新动态通常在首屏，刷新后可见；提醒状态也可能改变。不承诺浏览过程中绝对静态的审计快照，也不要把瞬时状态变化解释成记录丢失。

## 6. 验收候选（本调研未执行）

1. **真正可达：** 隔离夹具放入早于现有 24 小时窗口的提醒、至少 65 条动态及同一时刻多条记录。选择对应日期能看到旧提醒；连续加载可读到第 31／61 条，静态数据集内无重复或漏项；网络请求确实带条件并由服务端分页，不是缓存局部筛选。
2. **范围与状态：** 起始边界包含、结束日次日边界不包含；上海／洛杉矶、跨月年、23／25 小时日按声明时区一致。非法日期、反向范围、过大跨度／limit、未知状态、损坏 cursor 明确拒绝；错误不能被显示成“没有记录”。
3. **权限隔离：** 未登录、非家庭成员、同家庭无该长者事件权限、错误 household/recipient 组合、跨长者 cursor 均不可读取；OWNER 与 CAREGIVER 沿用原策略。后续页权限已撤销时拒绝续查，并按页面错误策略清除不应继续呈现的受保护结果。
4. **归属竞态：** 用 Deferred／可控假传输复现查询 A 未完成就应用 B、切换长者或家庭、A→B→A、退出登录、加载更多与刷新交错；旧数据、旧失败、旧 cursor 不污染当前结果。静态源码匹配不能替代行为测试。
5. **核验与回刷：** 历史待核验项仍按原版本／授权执行；核验后从“待家属核验”筛选中退出，新动态只在符合发生日期的查询中出现；不能恢复默认范围、丢失筛选或向新长者写入旧结果。
6. **两端实际界面：** Web 真实页面及 Android 原生页面验证日期输入、查询／重置／加载更多、独立空态与失败、小屏及大字体；检查近期未来提醒未消失、中文状态／关闭语义／时区仍正确。单测、构建、HTTP 夹具和实际设备结果分别记录，不互相替代。

## 7. 重大选择与非目标

建议默认保持“单一当前长者、当前档案时区、明确日期窗口、提醒当前状态、服务端分页”。这是原记录区的有限扩展，不需为每个按钮措辞单独征求方向；仍需在后续迭代计划中固定默认范围、跨度与契约，再开始实施。

以下诉求会显著改变方案，不能默默并入：跨家庭／跨长者聚合；“搜全部文字”及加密检索；按当时原始时区或当时正文还原历史；任意时刻状态审计／长期不可变快照；医疗合规留存与导出。这些涉及新的权限、数据或产品承诺，应另行确认。

本候选不做：文本搜索框、标签／智能列表、任意多条件组合、统计趋势、AI 总结或风险推断、导出／分享、新通知、历史正文回填、重算提醒、重写家庭待办筛选、修改核验判定、全站时区重构、生产部署。若最终只批准客户端局部筛选，必须标成“筛选已加载记录”，且不能将本候选的“更早历史可达”判为完成。

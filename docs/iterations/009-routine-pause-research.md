# 009 候选调研：日程临时停用与手动恢复

调研日期：2026-09-21；静态源码基线：`a7e05077db3fa5049c1d19b26a3ad5bdb62198fb`。承接 [008 研究格式](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/docs/iterations/008-care-history-navigation-research.md:1)，按 research 技能核对官方产品帮助与 Server / Web / 原生 Android 源码。本文中的代码行号以该基线为准；并行进行的 008 审查改动不属于本调研。只新增本文；未实现业务、运行测试、访问数据库、使用设备／浏览器 UI、启动服务、提交、推送或部署。以下是研究结论和待批准方案，不是已实现功能、验证通过声明或医疗场景承诺。

## 1. 结论与用户价值

**“保留原日程配置，临时停止后再手动恢复”存在真实能力缺口，但不是只缺一个开关。** 当前日程领域只有 `ACTIVE`／`DELETED`，没有 `INACTIVE` 或 `PAUSED`；查询、编辑、删除都仅接受未删除的 ACTIVE 日程。Web 的“已停用”只是状态显示的兜底分支，不能作为已有停用能力的证据。[状态常量](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/care-workflow.constants.ts:7)、[服务入口](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/care-workflow.application.service.ts:163)、[Web 标签与唯一编辑按钮](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/pages/product/RoutinesApiPage.tsx:594)

应当明确分开两种需求：

- **只是改变时间、重复星期或结束日期：已有编辑入口基本覆盖，不建议再做一套“调整安排”功能。** 两端均保留原配置作为表单初值，能提交新的起止日期与重复规则。[Web 表单](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/components/RoutineEditor.tsx:35)、[Android 表单](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/ui/FamilyManagementScreen.kt:2148)
- **临时离家，恢复时间暂不确定，希望不改规则、不删重建：现有入口不足。** 改结束日期会修改原配置；删除将写入 DELETED 并使规则失活，后续没有恢复入口。可保留“可逆暂停”候选，但须先确定已生成提醒、恢复下界与正在运行会话的边界，不能直接判定为低风险 UI 补齐。[编辑变更规则](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/care-workflow.application.service.ts:348)、[删除语义](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/care-workflow.application.service.ts:423)

这一价值判断来自题设场景与源码约束，不代表做过家庭访谈或验证过使用频率。**若产品只需要改时间／结束重复，应否决本候选并使用既有编辑；只有明确需要保留原配置的可逆停用，才进入实施计划。**

## 2. 官方竞品依据（仅 2 项核心 primary sources）

| 官方来源与已核实功能 | 对本候选的启示 | 不应过度推断 |
| --- | --- | --- |
| [Google Tasks：Manage repeating tasks in Google Tasks & Google Calendar](https://support.google.com/tasks/answer/12132599?co=GENIE.Platform%3DDesktop&hl=en)，正文 Important、Edit or complete a recurring task、Delete tasks in a series：支持停止重复；官方明确停止后不能让同一系列再次重复，须新建系列。Calendar 中删除可区分本次、本次及后续、全部。 | “停止重复”“删除系列”“临时暂停后恢复”不是同一动作；确认界面必须讲清影响范围。 | 不能声称 Google Tasks 已有可逆暂停，也不能据此推断本产品应删除／重建日程。 |
| [Google Calendar：Create a recurring event](https://support.google.com/calendar/answer/37115?co=GENIE.Platform%3DDesktop&hl=en)，正文 Set up a new repeating event、Make changes to events that repeat：可设置重复频率及结束时间，修改时选择应用到系列中哪些事件。 | 既有起止日期编辑能解决有明确边界的安排变更；暂停必须单独说明从何时生效、影响哪些已生成实例。 | 页面没有证明“一键暂停且原样恢复”。不能把修改结束时间等同暂停，也不照搬其事件上限。 |

上述页面本次直接读取，只用来核实用户功能与术语边界，不用于证明内部状态机、性能或本产品收益。没有找到官方暂停说明不能推出“所有竞品都没有暂停”；本候选也不依赖这样的否定命题。

## 3. 当前链路：已有能力与精确限制

### Server：没有可逆状态；编辑与删除都有副作用

- `Routine.status` 是字符串列，不是数据库枚举，但应用常量仅 ACTIVE／DELETED。`UpdateRoutineDto` 及 `UpdateRoutineCommand` 无状态字段；现有 PATCH 不能通过传 `INACTIVE` 获得受支持的生命周期转换。Controller 只有 list/create/update/delete，没有 pause/resume。[模型](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/prisma/schema.prisma:713)、[DTO](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/http/care-workflow.dto.ts:83)、[命令](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/care-workflow.types.ts:54)、[路由](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/http/routines.controller.ts:28)
- `listRoutines` 仅返回 ACTIVE、`deletedAt=null`，且只投影 `active=true` 的 schedules。`updateRoutine` 先以相同条件查记录；相同排期内容不会新建 schedule，实际改变规则才将旧 schedule 置 false，创建 `max(scheduleVersion)+1` 的新 schedule。**新状态即使能写进数据库，也会从现有列表消失；简单关闭 schedule 后，配置投影也会为空。**[列表与投影](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/care-workflow.application.service.ts:149)、[更新查询](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/care-workflow.application.service.ts:278)、[排期版本](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/care-workflow.application.service.ts:348)
- 删除不是临时停用：事务内将 routine 标记 DELETED、写 `deletedAt`、递增 version，并关闭其 active schedules，写 `routine.deleted` outbox；不删除已生成 occurrence，也没有在该方法内关闭家庭任务。不能借用 DELETE 后清空 `deletedAt` 来承诺恢复。[deleteRoutine](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/care-workflow.application.service.ts:423)

### 调度、已生成实例、待办与派发读取

| 环节 | 当前实际行为及证据 | 暂停／恢复必须解决的问题 |
| --- | --- | --- |
| 生成 | 只选 ACTIVE routine 下 active schedule；先读 schedules，再独立 `createMany(skipDuplicates)`，不是在一个事务内重查生命周期后写入。[生成器](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/occurrence-scheduler.application.ts:67) | 暂停与“已读规则、尚未插入”的生成并发时，仍可能插入旧 schedule 的 DUE。需要共同版本／锁定或等价竞态防护，不能只调整读取过滤。 |
| 预生成窗口 | runner 默认每 60 秒运行；默认向前生成 24 小时（配置允许 1–168 小时），下界向当前分钟取整，先生成再推进 100 条。[runner](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/care-workflow-scheduler.runner.ts:31) | 这是源码默认，不是线上配置证明。已存在未来记录；停止新生成不等于停止已有记录；批量推进也不保证一次 tick 清完所有记录。 |
| 失活推进 | DUE／AWAITING_CONFIRMATION 只要 routine 非 ACTIVE／已删或 schedule 失活，就可被取入批次，包含尚未到时间的未来 DUE；单项事务再次判断有效性，将它们改为 EXPIRED 并写 outbox。[选择条件](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/occurrence-scheduler.application.ts:117)、[终止转换](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/occurrence-scheduler.application.ts:162) | 现有失活语义不是“冻住等待恢复”，而是终止。若暂停复用此路径，必须明确告知当前未确认项也可能被关闭。 |
| 家庭核验 | AWAITING 到升级时间会生成 NEEDS_FAMILY_REVIEW、careEvent 和 OPEN familyTask；失活分支只处理 DUE／AWAITING，不回收已升级记录和 OPEN／CLAIMED 任务。[升级](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/occurrence-scheduler.application.ts:212) | 暂停不等于“已完成”或“家属已核验”。已升级任务建议继续保留，是否取消需要另作明确选择。 |
| 恢复去重 | 唯一键为 `(scheduleId, scheduledAtUtc)`，生成 ID 也由这两项确定；EXPIRED 无出向转换。[唯一键](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/prisma/schema.prisma:784)、[确定性 ID](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/domain/schedule-time.ts:166)、[终态](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/domain/occurrence-state-machine.ts:24) | 暂停期间已 EXPIRED 的未来项无法在原 schedule 下重新生成；不能用 skipDuplicates 当作恢复，也不能无审计地把终态改回 DUE。 |
| 历史／今日照护 | 历史查询按家庭、长者、日期与 occurrence 状态读取，没有按 routine 是否 ACTIVE 隐藏；今日统计同样统计已有实例及 OPEN／CLAIMED 任务。[历史](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/care-history.service.ts:70)、[今日照护](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/today-care.service.ts:42) | 暂停后历史仍应可见；关闭项仍会计入历史，不能用暂停暗示之前未发生、已完成或清除了待办。 |
| 设备读取／会话快照 | current-occurrences 及 careSnapshot 都要求 ACTIVE routine、active schedule，并返回有界可行动实例。[设备读取](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/care-workflow.application.service.ts:528)、[快照读取](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/companion-session/companion-session.application.service.ts:1183) | 暂停可让后续服务端读取排除规则；这不是对已取走数据／已经播报内容的撤回。outbox 写入本身也不证明终端已收到撤销。 |

**具体恢复反例（推导，未运行）：** 早上预生成今晚实例；中午暂停使该实例 EXPIRED；下午恢复时若沿用原 scheduleId，今晚记录仍占唯一键，生成器会跳过，原终态不会自动再提醒。若改成新 scheduleId，虽然能生成今晚提醒，但 runner 的分钟取整还可能生成“恢复本分钟、点击前已经过去”的时间点。现有 `startDate` 仅精确到当地日期，不能表达这条时间边界。[窗口下界](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/care-workflow-scheduler.runner.ts:61)、[日规则及 UTC 窗口比较](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/domain/schedule-time.ts:207)

### Web 与 Android：管理入口和运行时边界要分别看

- **Web 家属页：** 区域标题“已启用规则”；卡片只有“编辑”，没有暂停／恢复，当前这一区域也没有删除按钮。保存走带 version 和幂等键的 PATCH，成功后检查 scope/epoch 归属再更新并回刷。不能把 Android 的删除入口写成两端都有。[卡片](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/pages/product/RoutinesApiPage.tsx:552)、[保存与归属](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/pages/product/RoutinesApiPage.tsx:249)
- **Android 家属页：** 卡片有编辑／删除，删除确认仅说不再生成新实例；表单和请求体无停用字段。Repository 使用当前 routine.version，编辑有幂等键；ViewModel 按 routine ID 建立操作 lane 并复核 recipientId。[卡片](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/ui/FamilyManagementScreen.kt:1547)、[删除确认](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/ui/FamilyManagementScreen.kt:438)、[请求体](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/data/FamilyApiContract.kt:136)、[Repository](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/data/LighthouseRepository.kt:349)、[ViewModel](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/LighthouseViewModel.kt:524)
- **已下发内容不是实时规则：** Web 从 careSnapshot 映射本地 `enabled`、occurrence 状态和时间，实时会话中的 effect 用本地集合触发提醒；确认前才再读 current-occurrences。读取失败／规则变化与“已经听到一句提醒”不同，新增家属按钮无法自行让这个缓存失效。[快照映射](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/pages/product/CompanionPage.tsx:201)、[本地触发](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/components/CareExperience.tsx:269)、[到时判断](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/agent/routine-scheduler.ts:11)、[确认重查](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/pages/product/CompanionPage.tsx:708)
- **原生陪伴会话也不能假定即时更新：** Android 建立模型连接时获取并保存 prompt／careSnapshot 计数；此构造路径不是后续暂停指令撤回或热更新的证明。只能确认下一次受过滤的服务端读取不包含暂停规则，不能宣称当前模型会话立即忘记已收到的内容。[模型连接](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/data/LighthouseRepository.kt:844)

### 权限、版本和并发

- 日程管理沿用 `MANAGE_ROUTINE`：有效家庭成员、有效且属于该家庭的长者；OWNER 按现有规则获准，普通成员需 CAREGIVER 及对应 `canManageRoutine`。暂停不应降为 VIEW_EVENTS 或仅登录可用。[策略入口](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/household/domain/household-access.policy.ts:54)、[角色能力](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/household/domain/household-access.policy.ts:158)
- 编辑在 Serializable 事务内做权限、幂等重放、version 比较和条件更新，冲突有界重试；删除也版本保护，但只使用单次 Serializable 路径。新生命周期命令须复用这些保护，不能把前端禁用按钮当成并发控制。[编辑守卫](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/care-workflow.application.service.ts:277)、[条件更新](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/care-workflow.application.service.ts:365)、[事务工具](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/care-workflow.application.service.ts:1585)
- occurrence 确认独立检查权限、version、状态机；当前查记录没有 routine ACTIVE 条件。仅改 routine 状态、不处理既有 AWAITING，会在调度器关闭它之前仍留下确认窗口。暂停命令与确认／升级需要明确哪一方获胜，不能只阻止列表读取。[确认事务](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/care-workflow.application.service.ts:937)、[状态与条件写入](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/care-workflow.application.service.ts:1012)

## 4. 建议的最小范围（待产品选择，不是实现承诺）

### 用户动作与实例语义

1. 只做当前长者的**单个日程手动暂停／恢复**，保留 routine ID、内容、时区、星期、时间、起止日期和等待参数；不更改家庭任务归属，不自动恢复。建议显式新状态 PAUSED（或统一命名的 INACTIVE），而非复用 DELETED；命名只是建议，目前两者都未实现。
2. 建议暂停后规则仍出现在原日程区，显示“已暂停”和“恢复”；不要从可见列表消失。暂停确认说明影响范围；不重做整个页面，也不新增全局开关。原编辑能力继续承担改时间需求。[现有卡片位置](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/pages/product/RoutinesApiPage.tsx:577)、[原生卡片](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/ui/FamilyManagementScreen.kt:1547)
3. **建议但须确认：** 暂停成功时关闭该日程所有 DUE／AWAITING（包括已到时仍等确认及预生成未来项）；保留 CONFIRMED／EXPIRED、NEEDS_FAMILY_REVIEW 及其 OPEN／CLAIMED 任务。关闭不是完成；应留下可追溯的暂停原因，不把它与未核验、家属否决混为同一事实。若产品选择只停未来而保留 AWAITING，则必须另定义暂停后该项是否仍可确认、是否还升级；当前失活推进会直接关闭它，不能原样复用。[现有状态与升级限制](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/occurrence-scheduler.application.ts:176)
4. 恢复只继续**恢复生效时刻之后**符合原规则的时间点，不补发暂停期间错过的提醒，不复活旧终态、不清空已有核验任务。原 endDate 已过或一次性安排已错过时，应明确“原安排没有后续时间”，引导用既有编辑调整，不能自动延长日期或伪称恢复后一定会提醒。[日期边界](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/domain/schedule-time.ts:207)

### 最小可验证技术方案

- **生命周期命令与读取契约：** 建议独立 pause/resume 命令或同等严格的状态命令，带 version、幂等键与明确目标状态；不让自由 status 字符串穿透通用编辑。管理列表用显式 opt-in 返回 ACTIVE+PAUSED，默认旧契约仍只返回 ACTIVE；暂停项投影保留最近配置，不只查 active schedule。暂停中的编辑／删除是否开放要明确处理，不能显示按钮却返回 NotFound。[现有 DTO](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/http/care-workflow.dto.ts:83)、[现有 include 与过滤](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/care-workflow.application.service.ts:149)
- **排期代际与恢复时间下界：** 建议暂停使旧 schedule 永久失活；恢复按保存配置创建新的 scheduleId／scheduleVersion，旧终态保持不变。同时持久化 `effectiveFromUtc` 或等价的“本代启用生效时刻”约束，并让生成器把它和全局窗口、原 startDate/endDate 一起应用。本文建议只取 `scheduledAtUtc > 恢复生效时刻`，精确相等时也留到下一次；如需包含等于边界，须单独固定。不能用日期或 runner 当前分钟下界代替，也不能只新建版本而不加下界。是否增加字段／迁移由计划定，但**明确、可持久化的时间边界不可省略**。[模型现状](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/prisma/schema.prisma:740)、[窗口比较](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/domain/schedule-time.ts:227)
- **原子性及旧代封闭：** 暂停状态、旧 schedule 失活、需要关闭的 occurrence/version 和操作记录应具有一致提交结果；生成器与暂停／恢复必须用同一生命周期版本／锁定协议或等价机制防止旧代迟到写入。不能只依赖“下次调度会清理”：极短暂停再恢复、生成在途、推进批次上限都会影响结果。恢复后旧 schedule 仍不能派发；同一时刻旧关闭记录和新有效记录可能并存于历史，但只能有一条有效提醒。[分离生成写入](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/occurrence-scheduler.application.ts:70)、[逐项版本保护](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/occurrence-scheduler.application.ts:304)
- **命令重试：** 权限检查后，幂等重放不能因 routine 已变成 PAUSED 而提前被 ACTIVE-only 查询挡住。相同键同命令返回既有结果，变更目标／version／actor 等指纹冲突应拒绝；两位家属对同一 version 的不同操作只能一方获胜。客户端收到老命令的重放结果后仍应读取当前权威状态，避免覆盖后来恢复或编辑的状态。[现有查询次序](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/care-workflow.application.service.ts:278)、[幂等指纹核验](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/domain/care-command-idempotency.ts:30)
- **终端生效边界不能隐瞒：** 最小服务端保证可限定为“不再生成有效后续提醒，新的设备读取／会话快照不再返回该规则”；如果产品要求“现有在线会话在暂停成功后也不再触发尚未播报提醒”，就必须把触发前权威复核、缓存失效及旧响应归属纳入同一验收，不能仅增加管理页按钮。本轮不设计新通知、强制中断会话或全新推送通道；对已经播报、正在播放或已进入模型上下文的内容不承诺追溯撤回。[当前本地触发](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/components/CareExperience.tsx:227)、[原生模型连接](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/data/LighthouseRepository.kt:844)

## 5. 三端可行性与实施风险

| 端 | 可复用基础 | 必要工作与风险 |
| --- | --- | --- |
| Server | MANAGE_ROUTINE、routine.version、schedule 版本、Serializable、命令收据、已有失活过滤 | 新增可逆生命周期和可发现的暂停配置；恢复代际／时间边界；生成竞态与已生成实例的一致处理。仅“列是字符串”不等于不需要数据契约或迁移。 |
| Web | 现有规则卡片、编辑表单、带键命令执行与 scope/epoch 归属 | 暂停／恢复可达、独立错误与在途防重，回刷规则／今日照护／当前历史时保留 008 筛选；新状态明确映射，不能落到兜底“已停用”。已有陪伴快照另受生效边界约束。 |
| Android | 原生 Compose 卡片、Repository、routine lane、家庭操作 ticket | 新命令及暂停配置解析、中文状态、切家属／长者及退出后抑制迟到响应。保留原生布局，不迁移栈；不能复用删除确认话术隐藏 DUE／AWAITING 的处置。 |

两端并发保护有可复用基础，但尚未覆盖暂停行为；Web 现有 scope/epoch 在保存后检查，Android `familyAction` 以 ticket 归属控制发布。以上只是源码可行性依据，不是新行为测试通过。[Web](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/pages/product/RoutinesApiPage.tsx:289)、[Android](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/LighthouseViewModel.kt:1734)

## 6. 验收候选（本调研未执行）

1. **可逆且可发现：** 单个日程暂停后仍可在两端看到完整原配置，恢复沿用 routine ID；其他日程不变；删除项不可被恢复命令复活。旧客户端默认 ACTIVE-only 读取不被新状态破坏；新客户端不显示无效编辑／删除入口。
2. **实例与任务矩阵：** 准备未来 DUE、已到 DUE、AWAITING、NEEDS_FAMILY_REVIEW+OPEN／CLAIMED、CONFIRMED、EXPIRED。按批准策略处理，尤其验证暂停不伪造完成、不自动消除已有家庭核验；历史与今日卡片不误报“已完成”。
3. **预生成恢复反例：** 今晚实例已生成，暂停关闭后再恢复；今晚仍恰好一条有效新实例，旧终态保留、不可派发。反复暂停恢复及相同命令重试不多建活跃代、不重复生成；不能只验证 ACTIVE↔PAUSED 字符串变化。
4. **时间边界：** 恢复发生在计划时间前、计划分钟内已过去 30 秒、恰好边界、结束日期之后；不重放暂停期间或当前分钟已过时刻。覆盖有界日期、一次性安排、跨日、IANA 时区及夏令时；服务重启后恢复下界仍生效。
5. **服务端竞态：** 用可控屏障复现生成已读旧规则后暂停、暂停与推进／确认同时提交、两人同 version 编辑与暂停、恢复重试与再次暂停交错；证明旧代无可派发实例、无重复家庭任务、幂等收据与状态一致。超过 100 条需要推进的夹具不能造成“暂停成功但未关闭窗口”被忽略。
6. **权限与客户端归属：** 未登录、跨家庭／长者、无 canManageRoutine、VIEWER、权限撤销后重试拒绝；OWNER 按原策略。Deferred 覆盖切换家庭／长者、A→B→A、退出登录、迟到成功和失败；冲突可见且不回滚新状态。
7. **生效边界：** 新设备读取与新快照排除暂停规则；若选择支持当前会话，还需以已缓存 DUE 和暂停竞态验证触发前失效，分别记录 Web 与原生结果。已播报内容不能作为可撤回对象；若只保证新读取，界面必须明确限定，不能宣称“立即停止全部提醒”。

后续单元／行为测试、隔离数据库合同、构建和真实界面／设备结果须分别记录。当前未执行任何这些验收；静态检查不能代替运行时证据。

## 7. 重大选择与非目标

进入实施前至少固定三个产品选择：

1. **暂停覆盖哪些既有项？** 建议关闭 DUE／AWAITING、保留已升级核验与家庭待办；若只停未来，需另一套明确的继续确认／升级规则。
2. **恢复从何时开始？** 建议严格晚于服务端恢复生效时刻，不补发；无未来匹配时清楚告知并使用既有编辑，不自动延长原规则。
3. **对当前会话承诺到哪里？** 仅新服务端读取／新会话生效，还是同时覆盖在线缓存尚未播报项？后者扩大运行时失效范围；没有这项决定，不批准“立即停止”的文案与验收。

暂停中的编辑／删除可作为受控次级选择：最小方案可以先只允许恢复或删除，编辑需恢复后进行；若开放暂停态编辑，应保持暂停且替换保存配置，不暗中恢复。这不能靠既有 ACTIVE-only 方法自然实现。[现有方法边界](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/care-workflow.application.service.ts:278)

非目标：定时／自动恢复、暂停区间日历、跳过任意单次、批量／全家庭开关、跨家庭或跨长者聚合、新通知或推送体系、医疗决策／依从性判断、自动完成／清除待办、历史回填、撤回已经播报的内容、生产部署。本文保留的是一个**有条件成立的可逆生命周期候选**，不是已批准实现；若三个主要语义无法在本轮范围内固定，应保留研究并延后，而不是以 UI 开关冒充完成。

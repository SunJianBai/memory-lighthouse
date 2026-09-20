# 007 候选调研：照护记录可读性与时区一致性

调研日期：2026-09-20；静态代码基线：`a0d2809`。依据 research 技能核对官方说明和 Server / Web / 原生 Android 源码。本轮只写本文，未运行测试、使用浏览器／模拟器、访问生产或读写业务数据；下列缺口是源码事实与静态推导，不是实际设备验证结果，也不是已经批准的实施计划。

## 1. 用户场景与官方依据

家属查看“这条提醒现在是什么状态、由谁产生、发生在几点”，不应先理解 `NEEDS_FAMILY_REVIEW` 等内部编码。家属在外地或更换设备时，同一长者的“今日照护”“家庭待办”和历史记录也不应在没有时区标识的情况下出现不同日期／时间。

- Google Calendar 官方明确区分日历时区、单次事件时区和查看者时区，也支持显示第二时区；其任务会随日历时区调整显示时间。可借鉴的是“选择显示基准并让用户知道基准”，不是据此认定本产品必须采用查看者本地时间。[Google：跨时区使用日历](https://support.google.com/calendar/answer/37064?hl=en)
- Apple Reminders 官方说明默认使用当前位置时区，iOS 26 可以另选创建与显示提醒所用的时区。这说明“设备当地时间”与“指定时区”是明确的产品选择，不应偶然由格式化函数决定。[Apple：提醒事项的日期与时间设置](https://support.apple.com/en-nz/102484)
- Google Calendar 将标记完成作为明确动作，并单独提供未完成任务入口；Apple 也区别“完成”与“直接删除”。可借鉴的是保持状态语义，不将到期、待核验、关闭或认领美化成完成。[Google：创建与管理任务](https://support.google.com/calendar/answer/9901136?hl=en)、[Apple：完成提醒](https://support.apple.com/en-nz/102484)

上述文档只支持展示原则，不能证明本产品用户偏好或改善幅度；没有做用户访谈、竞品登录体验或线上统计分析。

## 2. 实码核对：已有能力和精确缺口

### Web

- **提醒记录直接显示内部状态。** `RoutinesApiPage` 的状态标签输出 `occurrence.status`，包括 `DUE`、`AWAITING_CONFIRMATION`、`NEEDS_FAMILY_REVIEW`、`CONFIRMED`、`EXPIRED`。同卡片的时间调用 `toLocaleString("zh-CN")`，没有传 `timeZone`。[提醒卡片](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/pages/product/RoutinesApiPage.tsx:672)
- **最近动态直接显示三种编码。** 正文已有服务端提供的中文 `title` / `summary`，但附属行直接输出 `sourceType · type`，标签直接输出 `severity`；`occurredAt` 格式化同样没有时区参数。[动态卡片](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/pages/product/RoutinesApiPage.tsx:734)
- **不是整个产品都缺少时区实现。** 今日照护明确使用响应中的 `timezone`；家庭待办传入当前长者时区并显式格式化。因此家属设备和长者时区不同时，历史卡片与已有卡片会使用不同时间基准；此结论来自代码路径，尚未跨时区运行验证。[今日照护](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/components/TodayCareCard.tsx:56)、[家庭待办格式化](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/components/FamilyTaskPanel.tsx:40)、[长者时区传入](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/pages/product/RoutinesApiPage.tsx:638)
- “日程实例”“正在加载日程实例”“暂无近期实例”“正在加载事件”等是实现术语，可在本区域统一为“提醒记录”“正在加载提醒记录…”“暂无提醒记录”“正在加载动态…”，不需要增加说明段落。[区域标题与空态](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/pages/product/RoutinesApiPage.tsx:643)

### Android

- **不是所有状态都未翻译。** `OccurrenceCard` 已调用 `occurrenceStatusLabel`，动态严重程度已调用 `severityLabel`。缺口是动态仍直接拼接 `sourceType` 和 `type`；未知状态／级别还会回退为原始编码。[动态卡片](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/ui/FamilyManagementScreen.kt:1443)、[已有状态映射](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/ui/FamilyManagementScreen.kt:2564)
- **记录时间使用手机时区。** 提醒与动态均调用 `formatInstant`，其共享 formatter 固定使用 `ZoneId.systemDefault()`，并没有接收长者时区。相邻家庭待办已有 `state.selectedRecipient.timezone`；今日照护也使用服务端时区。[提醒时间](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/ui/FamilyManagementScreen.kt:1722)、[共用 formatter](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/ui/FamilyManagementScreen.kt:2616)、[家庭待办时区](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/ui/FamilyManagementScreen.kt:1413)、[今日照护](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/ui/TodayCareCard.kt:75)
- Android 区域标题目前为“近期日程实例”“照护事件”，可与 Web 对齐为“提醒记录”“最近动态”。不应顺带全局替换 `formatInstant`，它还服务其他页面，超出本候选范围。[区域入口](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/ui/FamilyManagementScreen.kt:1423)

### Server 契约与不能越过的语义

1. `OccurrenceView` 已返回绝对时刻 `scheduledAtUtc`、计划当地日期、状态等；`CareEventView` 已返回绝对时刻 `occurredAt`、来源、类型、级别、中文标题和摘要。两者查询都执行 `VIEW_EVENTS` 授权，事件列表按发生时间排序。显示优化不要求改变响应结构、排序、鉴权或持久数据。[提醒查询](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/care-workflow.application.service.ts:506)、[动态查询](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/care-workflow.application.service.ts:826)、[输出投影](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/care-workflow.application.service.ts:1579)
2. `DUE` 在实例预生成时写入，也可能在调度处理前保留；`AWAITING_CONFIRMATION` 是到时后的状态转换，不能据此声称设备已经播放提醒或本人已经听到。`NEEDS_FAMILY_REVIEW` 表示需要家属核验，不等于已经确认未完成。[预生成和到时筛选](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/occurrence-scheduler.application.ts:96)、[状态推进](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/occurrence-scheduler.application.ts:197)
3. `EXPIRED` 至少覆盖两条不同路径：日程／规则停用后关闭，以及家属明确核验未完成。仅凭这个枚举不能一律写成“已完成”，也不能一律断言“长者未完成”。候选标签用“已关闭”，明确核验结果仍以对应动态标题／摘要为准。`CONFIRMED` 使用“已确认”，不扩写为医疗事实。[停用关闭](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/occurrence-scheduler.application.ts:172)、[家属核验结果](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/care-workflow.application.service.ts:1049)、[确认动态](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/care-workflow.application.service.ts:1104)
4. 本次在生产写入路径确认的动态类型为 `ROUTINE_CONFIRMED`、`ROUTINE_NOT_CONFIRMED`、`ROUTINE_CONFIRMATION_MISSING`、`RECIPIENT_REQUESTED_FAMILY_CONTACT`；来源为 `FAMILY`、`RECIPIENT`、`ROUTINE_SCHEDULER`、`COMPANION_DEVICE`，这些路径产生 `INFO` / `ATTENTION`。这不是数据库全量值审计，契约及数据库列均允许字符串。[请求联系家人](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/care-workflow.application.service.ts:738)、[未收到确认](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/occurrence-scheduler.application.ts:224)、[事件模型](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/prisma/schema.prisma:811)
5. **`USER / FAMILY_REQUESTED` 要单独看待。** 这组组合在本地 `today-care-harness` 的合成事件中明确存在；本次未找到生产 care-event 写入路径使用它们。Web 陪伴状态机也有同名 `FAMILY_REQUESTED` 动作，但它不是证明数据库事件业务含义的依据。不能因本地预览显示这组值就声称线上也一定存在，更不能把 `USER` 自动认定为家属或长者。[本地种子](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/test/support/today-care-harness.ts:264)、[独立的前端状态机动作](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/domain/types.ts:165)

## 3. 最小展示候选

建议只在“提醒记录／最近动态”补齐展示映射与显式时区，不做新看板。候选标签如下，最终需以现有业务契约为准：

| 字段 | 已核对的值 | 建议显示 | 不能暗示 |
| --- | --- | --- | --- |
| 提醒状态 | `DUE` | 待提醒 | 已经播放、已经到达本人 |
| 提醒状态 | `AWAITING_CONFIRMATION` | 待本人确认 | 已完成、已被听到 |
| 提醒状态 | `NEEDS_FAMILY_REVIEW` | 待家属核验 | 已知未完成或发生危险 |
| 提醒状态 | `CONFIRMED` | 已确认 | 医疗判断或模型客观确认 |
| 提醒状态 | `EXPIRED` | 已关闭 | 所有情况都已完成／未完成 |
| 动态来源 | `FAMILY` / `RECIPIENT` | 家属 / 本人 | 未提供的具体姓名 |
| 动态来源 | `ROUTINE_SCHEDULER` / `COMPANION_DEVICE` | 日程提醒 / 陪伴设备 | 设备发出记录等于本人操作 |
| 动态类型 | `ROUTINE_CONFIRMED` / `ROUTINE_NOT_CONFIRMED` | 日程确认 / 未完成核验 | 家属待办已全部结束 |
| 动态类型 | `ROUTINE_CONFIRMATION_MISSING` / `RECIPIENT_REQUESTED_FAMILY_CONTACT` | 待核验提醒 / 联系家人请求 | 自动判断紧急情况 |
| 动态级别 | `INFO` / `ATTENTION` | 一般记录 / 需关注 | 新增医疗紧急分级 |

- 主要内容继续使用原有中文标题／摘要；附属信息只展示简短中文来源、类型、时间。不要为了本轮改写或迁移历史事件正文，也不要根据 `payload` 拼接推断性描述。
- 未知值使用中性中文降级，例如“状态未知”“其他动态”“来源待确认”；未知来源不是“系统”、未知级别不是“一般”。原始码如确有排障需要，可放进默认折叠的“记录详情”，不把长编码塞回主卡片。详情只涉及已有非敏感元数据，不增加 `payload` 或原文展示权限。
- 时间候选基准为**当前所选长者档案时区**，与既有今日照护／家庭待办一致；区域标题旁仅标注一次“长者时区：Asia/Shanghai”等短标签。时间包含年份、月日和时分，避免跨年记录只剩月日；Web 用语义化 `<time dateTime>`，Android 使用可读文本。
- 这是将同一 UTC 时刻按选定时区展示，不能重新解释日期字符串、修改提醒触发时刻，或拿 `scheduledLocalDate` 拼出新的绝对时刻。若有效时区／日期缺失，显示明确降级，不悄悄改用浏览器或手机当地时间。

## 4. 最小验收候选与可行性

1. Web、Android 的上述两个区域均无已知枚举裸露；同一状态的文案一致，未知枚举可安全展示且不开放新操作。不影响原有核验按钮、权限及幂等行为。
2. 使用与长者不同的设备时区检查同一绝对时刻；“今日照护”“家庭待办”和记录区域在声明的长者时区下日期／时间一致。覆盖跨午夜、跨年和有夏令时的时区；切换长者后更新时区，不残留上一位长者记录。
3. `EXPIRED` 两种关闭来源均不能呈现成功色或“已完成”；`NEEDS_FAMILY_REVIEW` 仍可按现有权限核验，`CLAIMED` 家庭待办不会被记录展示逻辑重新解释为完成。状态标签只读，不改变服务端状态机。
4. Web 纯映射／时间格式化单测与真实区域渲染测试；Android 对应映射单测、真实卡片与实际 App 检查；保留加载、失败、空记录、长标题、小屏和辅助阅读可用性。以上均是后续验收建议，本调研未执行。

**无需新增 API 或数据库迁移的前提明确。** 两端已有长者时区，记录已有 UTC 时间与枚举；Android DTO 已解析这些字段。因此本候选可以通过两端小型展示函数及区域文案完成，服务端只需以现有契约／状态测试作为语义依据，不应为“对齐三端”制造无必要后端改动。[Android 解析](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/data/FamilyApiContract.kt:321)、[Web 契约](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/api/types.ts:159)

限制：当前 occurrence 接口不直接返回“该次记录创建时的时区快照”；事件也没有原始时区字段。若要求历史记录始终按**当时的日程时区**显示，而非当前长者档案时区，不能假装现有字段足以严格还原，应另立需求核对历史 schedule 关联及契约。本轮不预设该扩展。[现有日期字段](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/prisma/schema.prisma:740)

## 5. 建议默认、方向性选择与非目标

按本候选范围，没有必须阻塞实施的新授权或重大产品选择。建议沿用已有今日照护／家庭待办基准，统一按**当前长者时区**展示并短标签标识；未知元数据先采用中性中文降级，不新增折叠详情页。两项均可作为最小实现默认，不需要为细小文案反复询问用户。

真正会改变实现方向的是用户是否要求“按记录发生／日程创建时的原始时区还原历史”。这与统一按当前长者时区浏览不是同一能力；只有提出该要求时才需停下确认契约与历史数据方案，不能默默把它纳入本轮。

非目标：重写历史中文事件正文、重算日程、改变完成判定、修改提醒／待办状态机、为家属增加操作权限、新增通知通道、医疗风险判断、搜索导出、全站日期格式重构、生产清理及部署。`USER / FAMILY_REQUESTED` 合成种子可以用于未知值降级验收，但本轮不把它升级成未经定义的生产业务类型。

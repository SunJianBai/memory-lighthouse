# 006 候选调研：家庭待办释放与交接恢复

调研日期：2026-09-20；代码基线：`4452c25`。使用 research 技能核对官方文档与 Server / Web / 原生 Android 源码；未登录体验竞品、运行测试、操作浏览器／模拟器或读写业务数据。本文是下一轮候选依据，不是实施计划、已批准权限规则或完成报告。

## 用户需要与一手证据

候选场景：成员已认领一件照护待办，后来无法继续处理或退出家庭；其他家属需要知道“这件事仍未完成，谁能继续接手”。不能用“完成／不再处理”伪装交接，否则会把未完成事项移入已结束。

- Microsoft To Do 官方说明：共享列表内可以指定任何参与成员（含本人）负责；“Assigned to you”集中展示本人任务。此证据支持明确责任归属，不说明成员退出后的回收规则。[Microsoft 官方：共享列表分配任务](https://support.microsoft.com/en-us/todo/assign-tasks-in-shared-lists)
- Apple Reminders 官方说明：共享 iCloud 列表的提醒可以重新分配给其他参与者，也可以移除分配、恢复为无人负责。此证据支持“责任可变化”和“取消分配不等于完成”，不构成本产品 OWNER 强制接管的授权依据。[Apple 官方：分配、重新分配与移除分配](https://support.apple.com/guide/reminders/assign-shared-reminders-remnf1ce7672/mac)

由此推导的产品假设：补齐交接出口可能减少无人能继续处理的任务；未做用户访谈或线上指标分析，不能声称已证明降低遗漏率。优先验证下面已从代码确认的断点，不直接照搬完整派单系统。

## 当前已实现与实际缺口

- **不是缺少任务模型或认领。** `FamilyTask` 已有可空负责人、状态、版本与来源事件；`FamilyTaskAction` 已有动作、操作者、时间、前后状态、加密备注及幂等键。现有写入有版本校验、幂等回执和事务。[数据模型](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/prisma/schema.prisma:854)、[任务命令](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/care-workflow.application.service.ts:1251)
- **退出后责任没有回收出口。** `removeMember` 把成员置为 LEFT，撤销角色与对象授权等，但不修改其任务负责人。认领仅接受 OPEN；结束已认领任务必须是原负责人，OWNER 没有例外。退出成员又无法通过活跃成员鉴权。因此“CLAIMED 后成员被移除”在现有家庭任务命令中无后续处理路径；这是静态推导，尚未运行端到端复现。[移除成员](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/household/household.application.service.ts:399)、[状态机](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/domain/family-task-state-machine.ts:4)、[任务写入校验](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/care-workflow.application.service.ts:1299)、[成员／对象鉴权](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/household/domain/household-access.policy.ts:65)
- **三端缺口一致，不能仅补按钮。** Server 家庭任务公开命令只有 claim / resolve / dismiss。看板对已认领的他人任务返回不可认领、不可结束；Web 和 Android 显示“由负责人处理”，没有释放／交接入口。已退出负责人的任务仍在“全部未完成”，不会进入“待认领”。[HTTP 入口](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/http/family-tasks.controller.ts:24)、[看板](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/family-task-board.service.ts:91)、[Web 卡片](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-web/src/components/FamilyTaskPanel.tsx:122)、[Android 卡片](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/client-android/app/src/main/java/com/sun/minicpmo_android/lighthouse/ui/FamilyManagementScreen.kt:1612)
- **姓名降级不是退出证据。** “原家庭成员”还可能来自账号不活跃、姓名为空或无法匹配；不能按这段展示文字直接开放回收。名称查询仅返回当前家庭活跃成员对应的活跃账号姓名，也未在这里检查该负责人是否仍有此长者的任务权限。[姓名投影](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/household/household.application.service.ts:291)、[降级与能力字段](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/apps/server-api/src/modules/care-workflow/family-task-board.service.ts:121)

[002 迭代](D:/Codes/AI/OpenBMB/projects/memory-lighthouse/docs/iterations/002-task-collaboration.md:16)已明确将历史任务交接留作独立需求。此次缺口不是要求撤销原有安全边界。现有模型足以作为可行性起点；是否补充记录字段或命令契约应在规则明确后论证，本调研不预设新表、数据库迁移或重建任务 API。

## 建议的最小候选范围与验收（待确认）

建议先做“释放后重新认领”，暂不做直接指定他人。以下四项均为候选要求：

1. **本人主动释放。** 仍有该长者权限的当前负责人，对自己的未完成任务可确认“交回待认领”，取消不变更。释放后保留同一任务、来源、截止时间与未完成语义，其他有权成员沿用现有认领；不能写入完成结果或生成重复任务。
2. **已退出负责人任务的人工回收。** 若产品确认授予 OWNER 此能力，服务端核实负责人确已退出当前家庭后，允许 OWNER 确认交回待认领；不自动分配给任何人，不允许越家庭／长者回收，不顺便赋予“替任何活跃成员完成”的能力。不能仅凭逾期、离线、姓名占位或客户端判断开放入口。
3. **交接结果与过程可信。** 释放／回收保留可追溯的操作者、时间及责任变化，语义区别于完成／忽略；过期版本、同时完成／回收、重复提交不得静默覆盖或重复记账。已结束任务不得借此重开；原负责人退出后不能继续操作。复用现有版本、幂等与事务基础，不把前端按钮作为权限边界。
4. **Web / Android 同一可验证体验。** 在现有家庭待办卡片提供与服务端能力一致的中文入口、确认和取消；操作后重新读取看板，正确更新“我负责／待认领”计数。冲突刷新并解释、失败不假装成功；切换用户／家庭／长者后旧响应不得写回。保留原认领、处理结果、筛选与隐私降级，覆盖两端真实页面行为和服务端拒绝案例后才可宣称完成。

## 非目标与待判断事项

非目标：自动按逾期／在线状态转派、批量交接、直接强制指定他人、接单审批链、推送催办、任务聊天、已结束任务重开、医疗紧急升级，以及修改现有成员移除／敏感操作规则。无生产数据操作、推送或部署。

实施前需要产品判断：

- 是否批准新增“OWNER 回收已退出成员的未完成任务”权限？已有成员管理权不能自动推导为这项业务权力；若未确认，仅考虑本人主动释放，不暗中加入强制接管。
- “负责人已退出”的首轮边界是否仅限明确 LEFT？账号停用、被撤回 VIEW_EVENTS、角色变更及长期未响应是不同情形；建议先不合并为一个“不可用”标签，更不依据姓名降级推断。
- 释放后由别人主动认领是否足够？若必须直接转交给指定成员，需另行确定候选人资格、接收方是否同意，以及责任何时正式转移；这些不能从竞品按钮推导为已确定规则。

建议选择：优先确认前两项边界，再决定是否进入 006 实施；本文件不替代该确认，也没有执行任何交接变更。

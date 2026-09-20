# 持续产品迭代

目标：按使用场景和公开竞品资料识别需求，每轮完成调研、需求与页面设计、代码可行性分析、开发计划、Server/Web/Android 实现及兼容性验证，再提交 Git 并进入下一轮。

每轮验收：真实 API 行为、权限与边界测试、Web 构建与界面检查、Android 构建和本地模拟器运行；不以静态展示或仅通过编译代替完整验证。保留失败证据和未完成项。不自动操作生产家庭数据。

| 轮次 | 主题 | 状态 | 文档 |
| --- | --- | --- | --- |
| 001 | 今日照护概览 | 三端验收及审查收尾完成，本地提交 09c2347、d71cd16 | [需求、设计与验收](001-today-care.md) |
| 002 | 家庭待办协作 | 三端验收及双轴审查完成，本地提交 81416b2、b4b8390 | [需求与验收](002-task-collaboration.md) · [调研](002-task-collaboration-research.md) |
| 003 | 提醒周期与日期范围 | 三端验收及双轴审查完成，本地提交 e45d1ca、3e8da32 | [需求与验收](003-routine-schedules.md) · [调研](003-routine-schedules-research.md) |
| 004 | 陪伴启动检查 | 三端实现与双轴审查完成，本地提交 81531c5、64be4c4；模拟器回归批次异常见验收记录 | [需求与验收](004-companion-readiness.md) · [调研](004-companion-readiness-research.md) |
| 005 | 设备激活结果与恢复 | 三端验证及双轴审查完成，提交 4452c25、ddb471e；陪伴页 375px 追加验证通过，其余限制见记录 | [需求与验收](005-activation-recovery.md) · [调研](005-activation-recovery-research.md) |
| 006 | 家庭待办主动释放 | 三端验收及双轴审查完成，提交 b632ffb、a0d2809、f77e94b；OWNER 回收未纳入 | [需求与验收](006-task-handoff.md) · [候选调研](006-task-handoff-research.md) |
| 007 | 照护记录可读性与时区一致性 | 两端展示及服务端兼容验证、实际 Web／模拟器与双轴审查完成；提交 ba7d5bf、3772907 | [需求与验收](007-care-history-readability.md) · [候选调研](007-care-history-readability-research.md) |
| 008 | 照护记录筛选与历史查询 | 三端实现、隔离 MySQL／真实 Web／Android MainActivity 联调及双轴审查闭环完成；提交 7211dd5、a7e0507、5b95e5c，保留两项P3维护建议 | [需求与验收](008-care-history-navigation.md) · [候选调研](008-care-history-navigation-research.md) |
| 009 | 日程暂停与恢复 | 已有三端草案；隔离 MySQL 行锁原型验证通过（原型分支 5fae0cc）。产品暂停语义及当前会话生效范围待确认，未改业务行为 | [实施草案与实测](009-routine-pause.md) · [候选调研](009-routine-pause-research.md) · [会话可行性](009-routine-pause-runtime-research.md) |

## 后续候选

- 历史任务的负责人交接与成员退出后的处理。
- 日程周视图或更复杂的重复规则；单次与指定星期已在 003 实现。

候选必须在对应轮次重新核对用户价值、现有实现和竞品证据后确定，不代表全部承诺实现。

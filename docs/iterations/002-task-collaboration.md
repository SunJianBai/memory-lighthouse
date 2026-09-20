# 002 · 家庭待办协作

日期：2026-09-20。研究依据见 [竞品调研](002-task-collaboration-research.md)。用户价值假设：家属需要知道谁在处理，以及自己承诺的事项是否还未结束；竞品能力不等同于已验证本产品收益。

## 1. 需求与页面

在 Web“日程与待办”和 Android“照护”的家庭待办区域增加：

- 四个可切换筛选：全部未完成、待认领、我负责、已结束，显示各组数量。未完成包括 OPEN/CLAIMED；我负责仅指当前成员负责的未完成任务；已结束包括 RESOLVED/DISMISSED。已认领不等于已完成。
- 卡片展示实际事件标题、摘要、中文优先级与状态、负责人（本人显示“我负责”）、截止时间；结束事项显示处理结果和已有备注。不显示内部事件或成员 ID。
- 无人认领的任务可以认领，也保留原有直接完成/忽略入口；本人认领后可以完成/忽略；其他成员负责的任务仅展示“由负责人处理”，不展示注定被服务端拒绝的按钮。
- 点击认领/完成后重新读取任务看板，不能用缺少负责人信息的旧写接口响应覆盖卡片。失败或版本冲突同样重新读取，并保留可理解的错误提示。
- 切换家庭、长者或用户后清空旧任务并重置筛选；迟到响应不得覆盖新范围。加载失败不是“暂无待办”。刷新后仍停留所选筛选。
- 手机筛选按钮可换行且不截断，操作按钮至少 44px / 48dp；复用现有颜色与卡片风格。保留原有日程、核验和事件功能。

负责人退出、账号停用或无法匹配时显示“原家庭成员”，不泄露其邮箱或跨家庭姓名，不绕过既有“只能本人结束已认领任务”规则。本轮不加入自动指派、强制转交、推送催办、医疗判断；历史任务交接是后续独立需求。

## 2. 代码可行性

当前已有 `FamilyTask` 状态、负责人、版本、处理记录和来源事件；写接口已实现授权、幂等和版本冲突，不需要迁移数据库或重新实现认领。问题是 Web 只显示事件 ID，Android 依赖最多 30 条事件列表拼接，且两端未展示负责人。

新增只读 GET `/households/:householdId/care-recipients/:recipientId/family-task-board`，返回家庭/长者范围和全部授权任务。任务字段兼容旧 `FamilyTaskView`，附加 `sourceTitle`、`sourceSummary`、`assigneeDisplayName`、`assignedToMe`、`canClaim`、`canFinish`。

- 在同一个 RepeatableRead 事务中，先通过现有 `VIEW_EVENTS` 校验，再按 householdId + recipientId 查询任务与来源事件；来源事件也核对同一范围后才解密。
- 负责人没有 Prisma 关系，按当前家庭和任务涉及的成员 ID 一次批量查询活跃成员，选择 displayName，不加载邮箱/登录身份。旧成员安全降级。
- 新读接口不生成任务、不标记完成；旧列表与三个写接口保持响应和行为兼容。
- 客户端基于完整返回列表计算筛选计数；不以截断预览计算总数。沿用现有全量任务列表，不在本轮引入有不同计数语义的分页。
- Web 页面沿用已有 scope/epoch 和请求序号保护；Android 沿用家庭操作范围与重同步机制，修改成功后重新加载看板。

## 3. 开发顺序

1. 收尾 001 审查问题并提交，保留独立提交边界。
2. Server 看板投影、权限/数据范围/负责人/解密单测与真实 MySQL HTTP 验证。
3. Web 筛选、可读卡片、操作后刷新与冲突提示，覆盖新旧功能。
4. Android 字段解析、筛选、卡片和刷新，运行单元测试及本地模拟器真实 API 操作。
5. 浏览器和模拟器核对操作效果、切换隔离及旧日程入口，记录事实与未验项，提交本地 Git；不自动推送或部署。

### 实测补充：Web 账号切换隔离

浏览器验收发现：已登录时直接打开登录页并登录另一位用户，工作区仍可能保留前一用户的家庭。`WorkspaceProvider` 仅监听认证状态，而两次状态都是 `authenticated`，因此没有重新加载。这属于本轮“切换用户清空旧任务”的既定验收范围。

修复与验证计划：按认证状态与用户 ID 隔离工作区实例；本地记住的选择仅在服务端列表确认有权访问后恢复；家庭切换等待期间清空旧长者与设备；注销或卸载时使在途加载失效。补充真实 React 挂载测试（jsdom 仅为开发依赖），覆盖账号直接切换、旧响应迟到、未验证的本地选择与家庭切换，再复测浏览器原始场景。不得放宽服务端鉴权。

### 实测补充：独立模块的权限与加载结果

仅有 `VIEW_EVENTS` 的照护成员可以读写待办，却可能没有 `MANAGE_ROUTINE` 等其他模块权限。旧 Web `Promise.all` 和 Android 并发聚合会使一个模块失败连带隐藏全部结果。

两端改为逐项保留成功结果、清空失败模块的旧数据，提示具体失败模块；待办具有独立错误状态。Web 使用 `Promise.allSettled`，Android 捕获每项读取结果但不吞掉协程取消或登出信号。两端分别新增回归用例，先证明“日程被拒绝隐藏待办”和“待办失败隐藏日程”失败，再修复。新增低权限照护成员的真实 API 模拟器测试；不改变权限规则。

## 4. 验收清单

- [x] owner / caregiver / outsider、撤回 VIEW_EVENTS、家庭和对象隔离；缺少权限时没有姓名与解密数据。
- [x] OPEN、本人 CLAIMED、他人 CLAIMED、RESOLVED、DISMISSED，包含早期来源事件和已退出负责人。
- [x] 认领→我负责→完成→已结束；他人认领产生冲突后刷新；旧写接口幂等/版本检查仍通过。
- [x] Web 手机布局、筛选空态、错误态、切换对象和旧提醒核验兼容。
- [x] Android DTO 单测、UI 筛选/按钮测试、模拟器连接真实本地 API 完成操作。
- [x] Server/Web 构建与回归、Android 构建与回归，记录测试命令及实际结果。

## 5. 验收记录

2026-09-20，本地 MySQL 8.4.9（隔离端口 13306）、NestJS API（13100）、Web（4310），Android 使用 `Medium_Phone_API_35` 和 `.iterationtest` 包名；未清空已安装正式应用的数据，未操作生产。

| 检查 | 命令/证据 | 结果 |
| --- | --- | --- |
| Server 回归 | `npm run test --workspace @memory-lighthouse/server-api` | 82 组、464 项通过 |
| Server 静态检查与构建 | 同工作区 `lint`、`build` | 通过 |
| 真实 MySQL HTTP | 在 server-api 执行 `./scripts/today-care-local.ps1 -Mode Check` | 4 组、16 项通过，包含新看板 5 项和旧今日照护、授权及核验流程 |
| Web 回归与构建 | `npm run test --workspace @memory-lighthouse/client-web`、同工作区 `build` | 37 组、204 项通过；构建通过，保留现有实时媒体大分包提示 |
| Android 单测 | `:app:testDebugUnitTest -PisolatedTestApp=true` | 45 组、236 项，无失败或跳过 |
| Android 真机型模拟器 | `:app:connectedDebugAndroidTest -PisolatedTestApp=true`，传入下述真实 API 夹具参数 | 15 项通过，0 跳过；最后一轮在全部 Android 修改后执行 |

### 实际效果

- Web 两个成员会话：照护成员认领后，“待认领”变为 0，“我负责”变为 1；完成后移入“已结束”。所有者从旧页面重复认领时收到冲突提示，随后显示真实负责人并移除操作按钮。
- Web 对象切换清空旧卡片并重置筛选；切换到无授权关系的另一账号后只显示其家庭，无前一账号数据。对应挂载测试覆盖迟到响应及本地存储的未验证选择。
- Web 低权限照护成员在日程请求被拒绝时仍能查看、认领和处理授权待办；错误不再连带清空全部模块。
- Web“不再处理”使用卡片内确认，取消后状态不变且焦点返回触发按钮；确认后归档。375px 下没有横向溢出，确认和取消按钮均为 44px 高，已查看实际截图。
- Android 实际 MainActivity 完成登录、明确选择甲长者、读取今日提醒、切换乙长者空态、返回甲、进入照护、认领、筛选、填写处理备注、完成及退出。Web 能读取同一条处理备注。
- Android 仅有事件权限的照护成员仍能读取待办；他人负责卡片没有完成/忽略按钮。日程、提醒记录及动态的失败状态持续显示，不把失败当作“暂无数据”。
- Android 截图位于 `apps/client-android/app/build/outputs/connected_android_test_additional_output/debugAndroidTest/connected/Medium_Phone_API_35(AVD) - 15/`：`family-task-app.png` 与 `family-task-caregiver.png`，已查看排版；仅含隔离测试数据。

### 失败证据与修正

1. 概览测试曾等待“早餐后饮水”超时。失败时的 Compose 语义树显示选中乙长者、提醒数为 0，并非登录失败。夹具不保证同时间创建的对象排序；测试改为显式选中甲，保留全部原有断言，随后 12 项完整模拟器测试通过。
2. 低权限成员的截图曾把被拒绝的日程显示为“暂无日程”。新增模拟器断言先失败，再补充独立持久错误状态和加载状态，针对性与全量测试均通过。
3. 原生 `window.confirm` 在内嵌浏览器验收中阻塞交互，改为可取消的卡片内确认。挂载测试先证明点击会直接调用动作，再验证取消不发请求、确认仅发一次；浏览器复测取消和确认归档。
4. 隔离数据库重启后的首次预览曾报 Prisma `P2028` 事务启动超时。检查数据库连接及进程后，重新启动成功，16 项真实接口测试通过；未确定该瞬时问题的根因，没有修改生产超时或放宽校验。

### 复现

先按 [001 本地复现](001-today-care.md#6-本地复现) 启动隔离 MySQL 和预览。预览输出 owner、caregiver、outsider 测试用户名与家庭/对象 ID。每轮会变；不要使用生产账号。完整模拟器测试会改变 OPEN 夹具的状态，重跑时需新一轮夹具。

```powershell
adb -s emulator-5554 reverse tcp:13100 tcp:13100
./gradlew.bat :app:testDebugUnitTest :app:connectedDebugAndroidTest -PisolatedTestApp=true `
  '-Pandroid.testInstrumentationRunnerArguments.careApiBase=http://127.0.0.1:13100/openBMB/api/v1' `
  '-Pandroid.testInstrumentationRunnerArguments.careUsername=<username>' `
  '-Pandroid.testInstrumentationRunnerArguments.caregiverUsername=<caregiverUsername>' `
  '-Pandroid.testInstrumentationRunnerArguments.careHouseholdId=<householdId>' `
  '-Pandroid.testInstrumentationRunnerArguments.careRecipientId=<recipientId>'
```

预览进程在 Windows 中断后不能据此声称已清理；隔离库可能有历史测试数据，未对其执行批量删除。jsdom 仅用于 Web 开发测试；安装时报告的依赖审计问题没有在本轮擅自升级处理。

## 6. 双轴审查与收尾

用户确认固定点 `d71cd16`；功能提交 `81416b2`。审查使用 `git diff d71cd16...HEAD`，修正后分别定点复审；没有操作生产或推送。

### Standards

- P2 模块边界：看板直接读取家庭成员及账号姓名。已改为 Household 的授权批量姓名查询，再经 Identity 读取活跃、未删除账号姓名；沿用内部事务协作参数，返回标签 Map 而非 Prisma 模型。授权、成员与账号查询共用调用方 RepeatableRead 快照。新增单测验证授权先行、过滤与事务传递，真实 MySQL 接口回归通过。
- P2 状态误导：Android 独立加载时，授权或记忆读取失败会被当作空列表。已增加独立持久错误，错误时不展示授权决定或动作，缺项显示“授权状态待刷新”；成功刷新、切换对象均重置。真实 ViewModel 测试及模拟器 UI 断言先失败后通过。
- P3 判断性代码异味：看板与旧工作流的部分解密、序列化逻辑重复。本轮保留，避免把功能收尾扩大为加密格式重构；后续合并时必须保留格式校验、对象范围检查及旧接口兼容性。这不是已证实的运行故障。

本轴 3 项：2 项 P2 已修复并通过定点复审，1 项 P3 明确延后。

### Spec

- P2 同范围旧刷新覆盖：认领、完成曾关闭成功后的重同步。操作请求等待期间刷新，待办先读到旧值、其他模块较慢，操作成功后旧刷新会把状态恢复为 OPEN。新增真实 ViewModel 的两项 Deferred 测试均复现；恢复现有成功重同步使旧读取 generation 失效，两项测试及旧归属回归通过。
- P2 缺少具体处理结果：Web/Android 已结束卡片补充中文结果，区分“家属核验为完成”“家属核验为未完成”“无需继续处理”等；无备注也显示结果。历史空码与未知码不推断为完成。Web 挂载、Android 模拟器断言先失败后通过；实际页面及截图已核对。
- 定点复审新增 P2：Web 普通对象索引遇到 `__proto__`、`constructor`、`toString` 会返回非文本，导致页面崩溃或空白。三项挂载测试复现，改用 Map.get；同文件状态与优先级映射同步采用 Map。全部测试通过，复审实际 helper 与 React 渲染确认关闭。

本轴累计 3 项，均已修复并通过定点复审，无遗留需求缺口。

当前状态：本轮三端实现、回归与双轴审查完成，验收表为修正后的结果。下一轮调研另存 003 文档，不将候选需求描述为已实现。

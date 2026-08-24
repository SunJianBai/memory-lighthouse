# Android 家庭切换乱序响应保护

- 基线提交：`50b12cd32bdcb0474747191380de52a8686c87d1`
- 创建日期：2026-08-25
- 状态：DONE

## 问题

家属端快速从家庭 A 切换到家庭 B 时，两次详情请求会并发执行。当前实现会无条件写回后完成的响应，因此 A 的旧响应可能覆盖已经显示的 B 的长者、设备和成员；旧请求失败也可能覆盖 B 的成功状态。

## 范围

1. 为家庭列表、详情和长者资源 GET 链生成递增作用域，只有最新作用域可以写入状态、显示错误或拥有 loading 状态。
2. 同时覆盖手动选择家庭和刷新后自动选择家庭两个入口。
3. 保留现有三类详情并行加载与长者资源作用域检查。
4. 协程取消必须继续抛出，不得作为普通错误展示。

不修改服务器 API、数据库、Compose 页面结构和家庭权限语义。

## 验收标准

1. A 先发起、B 后发起、B 先成功、A 后成功时，A 被标记为 stale，最终只能应用 B。
2. B 成功后 A 才失败时，A 的错误被标记为 stale，不得展示。
3. ViewModel 在写入家庭详情、继续加载默认长者资源、显示错误和清除 loading 前校验请求作用域。
4. `CancellationException` 不进入普通错误处理。
5. Android 目标测试以及 `testDebugUnitTest lintDebug assembleDebug` 全部通过。

## 实现步骤

1. 新增可独立测试的最新家庭加载作用域与结果模型。
2. 先加入乱序成功、乱序失败和 ViewModel 接线约束测试并证明当前实现失败。
3. 将作用域接入 `LighthouseViewModel` 的家庭选择与刷新链路。
4. 执行目标测试和完整 Android 验收，复查 diff 后提交。

## STOP 条件

- 无法用确定性测试证明旧请求会被拒绝。
- 修复需要改变服务器协议或扩大为整个 ViewModel 依赖重构。
- Android 既有验收门出现无法归因于本阶段改动的新失败。

## Execution notes

- `LatestFamilyWorkspaceLoad` 从刷新或家庭选择发起时建立统一 generation，覆盖家庭列表、详情和默认长者资源；旧成功与旧失败均归类为 stale。
- `ActionBusyTracker` 只统计仍拥有结果的 latest-wins 请求，同时保留独立登录/设备初始化操作的 loading，避免旧请求提前清除或长期占用忙碌状态。
- 退出登录、切到陪伴模式、进入家属重新认证及服务端签出都会使家庭 GET 作用域失效。
- 回归测试覆盖乱序成功、乱序失败、当前失败、显式失效、协程取消、busy lease 和 ViewModel 接线约束。
- 验收：`testDebugUnitTest lintDebug assembleDebug` 全部通过，`git diff --check` 无错误；独立并发复查无阻断项。
- 后续阶段：家庭创建、长者创建及记忆/日程等 mutation 的 latest-wins 需要单独设计；并发登录的凭据原子提交也单独处理，不纳入本 GET 修复。

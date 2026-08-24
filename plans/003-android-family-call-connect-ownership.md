# Android 家属远程通话连接归属保护

- 基线提交：`0536840330aae481d23ed96ac2becc433ce08530`
- 创建日期：2026-08-25
- 状态：DONE

## 问题

家属端请求 LiveKit Join Ticket 后会直接建立媒体连接。若请求期间原通话已经结束、取消，或新的通话已经成为当前会话，旧 Ticket 仍会调用 `connectFamily`。底层重连会先断开现有连接，因此旧通话 A 的迟到结果可能拆掉当前通话 B，或在 A 已挂断后重新打开媒体连接。

## 本阶段范围

1. 为家属侧媒体连接请求绑定不可变的远程会话身份。
2. Join Ticket 返回后再次确认当前角色和当前远程会话仍属于原请求。
3. A 已结束、取消或被 B 替换时，A 的迟到 Ticket 不得触发媒体连接。
4. 当前会话的正常连接路径保持不变。

## 明确排除

- 服务端远程通话状态机和数据库。
- 陪伴侧接听、拒绝和 discovery reconciliation。
- LiveKit Room 迟到 callback 的 generation 隔离。
- 家属侧 request/end/cancel/poll 的完整生命周期 owner；后续单独阶段处理。
- 设备激活、AI 会话和 Web 轮询。

## 验收标准

1. Join Ticket A 等待期间结束或取消 A，A 返回后 `connectFamily(A)` 不被调用。
2. Join Ticket A 等待期间 B 成为当前会话，A 返回后不能断开或覆盖 B。
3. 当前会话 Ticket 返回后仍会且只会连接一次。
4. Android 目标回归、完整单元测试、lint 与 debug APK 构建通过。

## 实现步骤

1. 先增加可控 Deferred 的 ViewModel 回归测试并确认基线失败。
2. 在 ViewModel 家属连接入口增加 suspend 前后的 session owner 校验。
3. 执行目标测试及 Android 完整门禁。
4. 更新计划状态，提交本阶段并发布新的 Android 版本。

## STOP 条件

- 修复需要改变服务端 API 或远程通话协议。
- 无法用现有 MockK/coroutines-test seam 确定性复现。
- Android 既有门禁出现无法归因于本阶段的新失败。

## Execution notes

- 修复前的 4 个确定性测试中，挂断中、取消中和 B 已成为当前会话三种场景均稳定观察到旧 A Ticket 调用 `connectFamily(A)`；当前会话正向路径通过。
- 连接请求现在捕获 generation、用户、角色、家庭和会话身份，并在 Join Ticket 返回后再次校验；服务端返回不匹配的 session ID 同样会被拒绝。
- 挂断与取消在启动异步服务器请求前同步递增 generation，旧 Ticket 即使先于挂断/取消响应返回也不能重开媒体。
- 新回归 4/4 通过，并与既有通话安全测试联合通过。
- `testDebugUnitTest lintDebug assembleDebug` 完整 Android 门禁通过，debug APK 成功生成；`git diff --check` 通过。
- 独立只读复审无阻断项。完整 request/end/cancel/poll owner、陪伴侧 reconciliation 和 LiveKit callback generation 仍按范围保留为后续阶段。

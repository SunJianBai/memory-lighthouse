# Android 设备激活展示权与持久恢复隔离

- 基线提交：`6f71942dacba58850941b090e9a720e7d519cbe0`
- 创建日期：2026-08-25
- 状态：DONE

## 问题

Android 的二维码和动态码认领使用无条件拥有结果的通用 `action`。请求在途时若用户退出并重新登录，旧成功仍可把新家属会话切到陪伴端，旧失败仍可写入新页面，旧 busy lease 也会让新会话持续显示忙碌。与此同时，Repository 会在网络返回后先把待激活记录或设备凭据写入安全存储；这些设备级副作用不能因页面已失效而回滚。

## 本阶段范围

1. 新增无依赖、可测试的激活展示 epoch；登录、注册、退出、角色切换、家属重新认证和锁定陪伴模式都会使旧展示票据失效。
2. 二维码和动态码认领的 busy、成功提示、错误和角色切换只属于发起时的展示票据。
3. 认领成功后无论展示票据是否仍有效，都保留 Repository 已落盘的 pending，并继续设备级轮询恢复。
4. 轮询绑定明确的 challenge 与 generation；旧 terminal/失败不得污染当前页面，真正落盘的 device credential 仍是全局权威状态并进入锁定陪伴模式。
5. 同一进程只允许一个认领请求在途，且存在 pending 时不允许覆盖为另一个 challenge，避免 ViewModel 内部制造待激活记录竞态。
6. 保持取消轮询时的 pending，不把协程取消当成激活失败。

## 明确排除

- 服务端 claim/exchange 协议、幂等键和响应丢失恢复。
- 跨进程或多安装实例同时认领同一 challenge 的服务端仲裁。
- 待激活 secret 的存储格式迁移。
- 通用登录请求、邮箱验证及其他 ViewModel action 的所有权重构。
- 激活页面视觉重构。

## 验收标准

1. 旧二维码成功在退出并重新登录后，不得切换新会话角色、发布旧 pending/提示/错误或保持 busy。
2. 旧动态码失败在退出并重新登录后不得污染新会话。
3. 当前二维码和动态码认领的既有成功行为保持不变。
4. 旧展示对应的轮询终态/失败不得写入新展示；若 exchange 已落盘设备凭据，则仍只执行一次锁定陪伴模式收敛。
5. 认领在途或已有 pending 时，第二次认领不得到达 Repository。
6. 取消轮询不调用 `abandonPendingDeviceActivation()`。
7. Android 目标单测、完整单测、lint、debug 构建和 `git diff --check` 全部通过。

## 实现步骤

1. 增加确定性的 ViewModel 回归，先证明旧认领会劫持新登录页面。
2. 新增展示 epoch seam 和纯 Kotlin 单测。
3. 接入认领、生命周期失效和 busy owner。
4. 将轮询绑定 challenge/generation，并区分可抑制的页面结果与不可忽略的设备凭据。
5. 执行目标门禁、完整 Android 门禁和独立复审。

## STOP 条件

- 修复必须修改服务端 API、数据库或设备凭据协议。
- 无法在不删除已落盘 pending/credential 的前提下隔离页面结果。
- Android 既有门禁出现无法归因于本阶段的新失败。

## 执行记录

- RED：先增加 3 项可控 Deferred 回归，基线全部按预期失败，分别证明旧成功仍持有新登录 busy/展示、旧失败会污染新会话、第二个认领会并发进入 Repository。
- GREEN：新增激活展示 epoch，将认领 busy、成功、失败、二维码角色切换与登录/退出/角色生命周期绑定；Repository 已落盘的 pending 与 credential 保持设备级恢复语义。
- 轮询隔离：轮询固定捕获 challenge 与 generation；旧 terminal/失败不再写入新页面，取消不清 pending；任何轮询只要确认 credential 已落盘，都会收敛到锁定陪伴模式。
- 持久恢复：凭据与 pending 同时存在时由凭据胜出并清除 durable pending；退出与非可取消 exchange 竞态会在退出完成前重新检查凭据，不会被空白登出状态覆盖。
- 防重复：认领在途、已有 pending 或已有 device credential 时，新的二维码/动态码认领不会进入 Repository。
- 回归覆盖：展示 epoch 2 项；ViewModel 激活 12 项，覆盖 dynamic/QR 正反向、跨登录成功/失败、重复认领、stale terminal、真正 stale Activated、取消、退出竞态与启动崩溃窗口。
- 最终 Android 门禁：35 个测试文件、168 项全部通过；`lintDebug` 与 `assembleDebug` 通过；`git diff --check` 通过。
- 独立复审先发现并验证关闭“已激活设备仍可重复认领”和“credential+pending 崩溃窗口未清理”两项 P1；最终复审无阻止提交的 P0/P1/P2。

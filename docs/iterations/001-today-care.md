# 001 · 今日照护概览

日期：2026-09-20。起点：ac674a9，另有本任务前几轮尚未提交的图标、Web 文案和使用指南改动。

## 1. 调研与需求依据

- [Caring Village 官方功能页](https://caringvillage.com/app/)：家庭看板整合共享日历、待办和照护更新。
- [ElliQ 官方家属端](https://elliq.com/pages/caregivers)：家属可设置提醒、查看近期活动和发起通话。
- [Lotsa Helping Hands 官方说明](https://lotsahelpinghands.com/how-it-works)：通过共享日历安排并认领帮助事项。

以上是产品能力证据，不证明本产品用户已经表达了需求。本轮假设：家属每天打开应用时，比起重新配置设备，更需要先知道当天安排和未处理事项。

代码证据：Web OverviewPage 以配置摘要和快捷操作为主；Android OverviewSection 展示全量记忆/日程/待办数量，没有统一的当天口径。服务端已保存 RoutineOccurrence 和 FamilyTask，可直接聚合，无需新增数据库表。

## 2. 需求与页面设计

家属选中长者后，在家庭概览顶部显示“今日照护”卡片：

1. 长者当地日期、时区、最近更新时间和刷新按钮。
2. 当天提醒总数、已确认、待核验；“已确认”仅代表记录状态，不能推断实际服药/健康情况。
3. 待处理日程优先展示：待核验优先，其余按时间；最多五条，每条包含家属填写的标题、当地时间和明确状态。
4. 全部未处理家庭待办数量，包含以前日期遗留事项；点击进入现有日程/待办页面。
5. 无提醒时提供添加日程入口；无权限或读取失败显示原因与重试，不显示为零。切换长者/家庭立即隔离旧数据。

移动端使用纵向卡片与可换行统计块，按钮不小于 48dp；Web 在窄屏上单列。标题采用功能名称，无宣传句。保留陪伴端既有话术。

## 3. 可行性与接口

新增 GET `/households/:householdId/care-recipients/:recipientId/today-care`。

- 使用既有 UserAccessGuard 和 HouseholdAccessPolicy 的 VIEW_EVENTS，所有查询绑定当前家庭和长者。
- 服务端以 CareRecipient.timezone 决定当天 UTC 半开区间；适配夏令时，不能直接用 UTC 日期或固定 24 小时。
- 返回 snapshot：householdId、recipientId、localDate、timezone、generatedAt、counts、最多五条待处理提醒、未处理任务总数。
- 统计查询覆盖全部当天记录，不从截断列表推导总数；不把未来提醒标成逾期；EXPIRED 与 CONFIRMED 分开。
- 接口只读，不自动生成提醒或写入确认记录；未生成的提醒不能冒充已生成。旧接口保持兼容。
- Web 新卡片独立加载；Android 新卡片也独立加载，失败不会阻断其他家庭功能。

## 4. 开发计划

1. 实现日期区间、服务端授权汇总和测试。
2. Web 今日卡片接入接口、刷新和防止跨长者旧响应覆盖。
3. Android DTO、Repository、独立加载状态、概览卡片与跳转。
4. 运行权限/时区/统计/旧功能回归；本地 MySQL API 联调；Android 模拟器验证新卡片与切换。
5. 记录证据；图标独立提交，已确认的 Web 文案与指南随本轮三端功能一起提交，避免拆分相互依赖的概览和样式。

## 5. 验收记录

2026-09-20 本地验收通过，尚未推送或部署生产。

| 检查 | 结果与覆盖 |
| --- | --- |
| Server 单元测试 | `npm run test:server`：81 组、455 项通过；新增时区边界和聚合服务测试共 10 项 |
| Server lint / build | `npm run lint`、`npm run build`（server-api 目录）通过 |
| 真实 MySQL HTTP | `scripts/today-care-local.ps1 -Mode Check`：3 组、11 项通过，其中新接口 5 项；真实登录身份、授权、Prisma、MySQL，不替换这些边界 |
| Web 单元测试 / 构建 | `npm run test`：32 组、174 项通过；`npm run build` 通过；原有 LiveKit 分包体积警告保留 |
| Web 实际运行 | 本地 4310 → API 13100；真实登录显示总数 10、已确认 2、待核验 2、未处理待办 2；切换空长者显示零且无前一长者内容；切回、刷新、进入原日程页正常，控制台无错误 |
| Web 窄屏 | 375px 浏览器检查；统计块为 2×2、列表可读、页面无横向溢出 |
| Android 单元测试 | `:app:testDebugUnitTest -PisolatedTestApp=true`：44 组、223 项通过 |
| Android 模拟器 | Medium_Phone_API_35 / Android 15：8 项通过，0 失败、0 跳过；独立包名与原应用并存，不卸载原应用 |
| Android 实际 App | MainActivity 登录表单 → 家庭概览真实取数 → 甲/乙切换 → 照护页 → 退出登录；同时验证失败重试、空状态和迟到响应隔离 |

Android 截图：实际 App 与独立卡片测试分别保存在 `apps/client-android/app/build/outputs/connected_android_test_additional_output/debugAndroidTest/connected/Medium_Phone_API_35(AVD) - 15/today-care-app.png`、同目录 `today-care-mysql.png`。截图仅为隔离测试家庭数据；已人工查看排版。

### 测试发现与修复

- 首次真实集成测试缺少 LiveKit/S3 构造配置，随后测试夹具漏填 `RecipientMember.accessLevel`；补齐专用测试启动脚本和夹具字段后，实际 SQL/HTTP 断言才开始执行并通过。不能将这些启动失败算作产品接口失败或通过。
- 模拟器原应用签名与当前调试签名不同。增加显式 `-PisolatedTestApp=true`，仅调试时使用 `.iterationtest` 后缀，正常包名和发布签名不变。
- 完整 App 运行发现旧更新模块在 Activity 销毁时于主线程清理 TLS 连接池，产生 `NetworkOnMainThreadException`。先用 `UpdateHttpClientCloserTest` 复现相同线程错误，再将取消请求和连接清理放到独立 IO 协程，不持有 Activity；223 项单测及完整模拟器流程复验通过。
- Web 增加响应字段校验；无效日期、时区、负数统计与错误家庭范围进入可重试错误状态，不在渲染时崩溃。未来提醒按真实时间比较，不按时间字符串比较。

### 验证范围

本轮是照护概览读操作与原页面兼容性验证，不代表重新实测所有摄像头、模型推理、远程通话或邮件投递链路。媒体租约在夹具中替换为内存实现，LiveKit/S3 未启动，不用于照护接口断言。未接触线上家庭数据。

## 6. 本地复现

使用独立 MySQL：`127.0.0.1:13306/lighthouse_iteration_test`，先应用既有 Prisma migrations。不要使用生产库或系统已有的 3306 实例。

1. 设置 `TODAY_CARE_MYSQL_TEST_URL` 为该专用数据库连接串。脚本和夹具都会拒绝其他地址。
2. 在 server-api 目录运行 `./scripts/today-care-local.ps1 -Mode Check` 执行集成检查。
3. 运行 `./scripts/today-care-local.ps1 -Mode Preview`，取得当次临时账号、家庭和长者 ID。预览只监听本地 13100，固定照护时钟为 2026-09-20 12:00 上海时间。
4. 启动 Web 开发服务（4310），使用输出的临时账号检查家庭概览。
5. `adb -s emulator-5554 reverse tcp:13100 tcp:13100`，在 client-android 目录执行：

```powershell
./gradlew.bat :app:testDebugUnitTest :app:connectedDebugAndroidTest -PisolatedTestApp=true `
  '-Pandroid.testInstrumentationRunnerArguments.careApiBase=http://127.0.0.1:13100/openBMB/api/v1' `
  '-Pandroid.testInstrumentationRunnerArguments.careUsername=<预览输出的用户名>' `
  '-Pandroid.testInstrumentationRunnerArguments.careHouseholdId=<预览输出的家庭 ID>' `
  '-Pandroid.testInstrumentationRunnerArguments.careRecipientId=<预览输出的甲长者 ID>'
```

未提供本地 API 参数时，两项真实 API / 完整 App 测试会跳过；这不算完成真实联调。正常退出预览会清理本次生成的测试账号和家庭；异常中断可能遗留隔离测试数据，不影响生产。

## 7. 提交与审查收尾

- 功能提交：`09c2347`；Android 更新连接清理独立提交 `64e7087`，图标独立提交 `4515681`，均为本地提交。
- Standards 轴：未发现文档规范违规；采纳可选增强，为 Android 今日卡片增加状态白名单、最多五条与空标题校验，防止未知状态被当作待确认。
- Spec 轴：修复首页固定“设备尚未激活”冒充实际状态的问题，改为中性“陪伴设备配置”。增加首页回归测试。
- 收尾验证：Web 33 组、175 项测试及构建通过；Android 44 组、225 项单元测试通过。模拟器 8 项真实运行证据为上节记录，本次解析边界增强没有冒充新一轮模拟器运行。
- 指南在中等宽度下绑定流程改为纵向，375px、812px、1440px 浏览器检查及构建通过。未推送、未部署生产。

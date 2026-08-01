# 验收记录

核对时间：2026-08-01（Asia/Shanghai）。

## 自动化

| 检查 | 结果 |
| --- | --- |
| Client Web / Demo | 10 个测试文件、51 个测试、类型检查和生产构建全部通过 |
| Server | 56 个测试套件、208 个单元/集成测试、Prisma validate/generate、ESLint 与生产构建通过；另有 5 个真实 HTTP E2E |
| Admin Web | 3 个测试文件、8 个测试、类型检查、普通生产构建与开发检查模式构建全部通过 |
| API / Event Contracts | 两个契约包 `tsc --noEmit` 均通过 |
| 生产交付静态门禁 | 全部 Shell 语法、Compose 模型、回环端口、生产内容检查硬关闭及两份 GitHub Actions 工作流 `actionlint` 通过 |
| 原子备份故障注入 | 在 TX4H4G 隔离 PATH/假 Docker 下通过 6 类测试：成功、MinIO 中断、API 重启失败、健康失败、部署保持停机、stop 后 SIGTERM；另验证 MinIO 中名为 `SHA256SUMS`/`.openbmb-backup-complete` 的真实对象仍进入清单。夹具和测试备份已清理 |
| 真实基础设施冒烟与 HTTP E2E | MySQL 8.4、双 Redis、MinIO、LiveKit 启动并达到 healthy，MinIO 初始化与迁移成功；5 个 HTTP E2E 覆盖健康、安全头、404 与 Redis 限流，不冒充对象存储数据流或双端媒体 E2E |
| Android | `testDebugUnitTest lintDebug assembleDebug` 通过并上传 Debug APK |
| 智能体状态机 | 开始、提醒、确认、未确认转家属均覆盖 |
| 安全 Prompt | 不识别药片、不推断危险、画面不清不猜测均有断言 |
| 日程调度 | 宽限窗口、跨工作日、单日键和家属自动通知超时均覆盖 |
| 数据包校验 | 每类数组元素和必填字段均校验，畸形对象被拒绝 |
| 语音命令 | 明确完成、重复、联系家属及否定/疑问/条件表达均覆盖 |
| 任务事件关闭 | 本人/家属完成后同一日程的 open 事件全部关闭，其他日程不受影响 |

上述新增隐私通知功能已在本地完成全量复核；推送后由 [main 分支 CI](https://github.com/SunJianBai/memory-lighthouse/actions/workflows/ci.yml?query=branch%3Amain) 重复同一组门禁，具体交付只以目标提交对应的绿色运行结果为准。

## 早期 Demo 浏览器端到端（持续保留）

本节记录原比赛 Demo 的浏览器验收，不等同于当前完整账号、家庭、设备、管理员和 Android 公网端到端验收。

使用 Chrome/Playwright 检查：

- 欢迎页、演示台、家属端、记忆中心、设置页和四步引导均正常渲染。
- 1440px 桌面端所有页面无横向溢出。
- 375×812 手机端无横向溢出，底部主导航可用。
- 回放模式可以开始会话、触发日程、标签纠正、打断提示、调用眼镜记忆并生成家属待办。
- 提前确认被禁用；真实/回放提醒送达后才允许确认；家属可复核并关闭待办，系统新增来源为“家属”的回执。
- ModelBest 模式明确提示官方协议不返回用户转写；自然语音仍用于全双工对话，业务确认使用按钮，不伪造语音留痕。
- 撤回敏感记忆授权后图片、药物和人物关系文本均被阻止；关闭本地持久化后数据包立即从 `localStorage` 移除。
- 约 6MB、结构合法但超出浏览器配额的数据包会显示容量错误，既不切换内存状态，也不提示恢复成功。
- 真实 Provider 在麦克风未授权时不会启动，且不会写入会话开始事件。
- 页面运行无 JavaScript 异常；补齐 favicon 后不再有静态资源 404。

视觉截图保存在本地临时验收目录 `tmp/visual/`，不进入正式产物。

## 模型与网络

| 检查 | 结果 |
| --- | --- |
| ModelBest `/health` | HTTP 200 |
| ModelBest `/api/config/eta` | HTTP 200 |
| ModelBest Realtime | 按官方 `queue_done → session.init → session.created` 进入音频 full-duplex live |
| ModelBest 日程动作 | 携带完整安全 Prompt 的官方 Chat 模式收到 `response.done` 后返回真实提醒，状态才由 reminding 进入 awaiting_confirmation |
| 无头浏览器摄像头 | 系统 Chrome 无虚拟视频设备，未完成真实视频帧验证 |
| 本地 vLLM `18099` | 当前工作站端口不可达 |
| TX4H4G SSH 与生产预检 | SSH 已连通；系统、CampusHub、Docker、Caddy、资源和生产配置审计完成，不可变发布候选已通过静态与结构预检 |

当前已跑通原 Demo 回放闭环、ModelBest 公网音频 Realtime、Server 真实基础设施启动/健康冒烟与 HTTP E2E，以及 Android JVM 单测、Lint 和 Debug APK 构建。仍未完成真实 MinIO 资产数据流、真实摄像头、Android 真机/界面运行、双公网设备 LiveKit 媒体、真实 SMTP 邮件和公网切流后的浏览器验收；这些项目不得写成已通过。

## 比赛设备最终清单

1. 本地 `/health` 与 `/v1/models` 返回成功。
2. 真实摄像头显示“画面已接入”，视频帧指标持续增长。
3. 真实麦克风可打断模型输出，播放队列停止后恢复监听。
4. 运行五步主线和两个可选场景，并在家属端看到来源明确的对应事件。
5. 结束会话后浏览器摄像头和麦克风占用指示消失。
6. 使用真实邮箱完成注册验证和密码重置。
7. 家属端与陪伴端处于不同公网网络时完成 LiveKit 双向音视频、拒接、挂断和 AI/远程接管切换。
8. 验证公网 `/openBMB/`、`/openBMB/admin/`、`/openBMB/api/v1/health/live` 与 `/openBMB/api/v1/health/ready`；`/rtc/v1` 使用 LiveKit SDK 完成 WSS 握手，同时确认 CampusHub 其他路径正常。

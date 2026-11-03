# 日程暂停与恢复

## 家属端

- 日程列表 `GET /households/:householdId/care-recipients/:recipientId/routines?includePaused=true` 返回启用及暂停日程；不传参数保持旧客户端仅启用行为。`includePaused` 仅接受 `true` 或 `false`。
- `POST /households/:householdId/routines/:routineId/pause` 和 `/resume`：请求体 `{ "version": 0 }`，必须提供 `Idempotency-Key`；成功为 HTTP 200、返回 `RoutineView`。
- 命令需要当前家庭／长者管理日程权限。重试沿用相同键和相同原请求；同键不同请求、旧版本冲突不会覆盖较新状态。撤销权限后不能重放。
- 暂停状态仍可通过原 PATCH 编辑或 DELETE 删除。编辑不会隐式恢复。删除不能恢复；已成功命令收据的重放不复活删除项。

## 提醒记录

暂停原子地将 DUE 和 AWAITING_CONFIRMATION 关闭为 EXPIRED，版本递增，`closureReason=ROUTINE_PAUSED`，不写完成时间。NEEDS_FAMILY_REVIEW、确认历史及家庭待办保留。

恢复建立新的 schedule ID 和 `effectiveFromUtc`，只生成严格晚于该时间的提醒。旧代不再启用，也不补发暂停期间或恢复所在分钟已经过去的提醒。没有后续匹配时间返回 `ROUTINE_NO_FUTURE_OCCURRENCE`，先编辑日期／星期，再恢复。

新字段均可空，旧数据不回填、不改写历史。未知关闭原因不当作暂停；界面仍显示“已关闭”，不暗示完成。

## 正在陪伴的设备

创建陪伴会话时，在读取照护快照之前保存当前长者所有日程的 ID、版本、状态摘要。配置发生变化后，下一次认证心跳返回 `STOP / ROUTINES_CHANGED`，结束旧会话并释放其媒体占用；Web 和 Android 提示重新开始陪伴。旧版会话没有摘要时也要求重新开始。

Web 每次客户端显式提醒／重复日程先读取当前实例并验证会话；变更后不再次发送包含旧日程的完整提示词。会话停止或被替换后，迟到结果不再派发。客户端读取与独立模型发送不在同一事务，心跳也有网络延迟；已发送、生成或播放内容不承诺撤回，不保证零迟到。Android 继续使用已有双工模型，不新增本地定时派发器。

恢复之后请在设备上重新开始陪伴，取得新快照。不会因家属操作自动打开摄像头或麦克风。

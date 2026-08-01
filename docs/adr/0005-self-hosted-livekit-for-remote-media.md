---
status: accepted
---

# 远程陪伴媒体采用自托管 LiveKit

采用 NestJS 控制平面加自托管 LiveKit 媒体平面：NestJS 判断家庭权限、签发短时房间资格并保存审计，LiveKit 负责 Web/Android WebRTC 信令、SFU、重连和 TURN。相比自行实现裸 WebRTC P2P、coturn、ICE 重启与两端重连，这增加一个部署进程和媒体中转流量，但显著降低跨端通话的实现与稳定性风险。产品方已于 2026-08-01 确认允许部署自托管 LiveKit。

自托管 LiveKit 的参与者移除接口只断开当前连接，不能撤销客户端已取得的刷新令牌。为使终态会话不能被旧令牌重建，NestJS 在现场接听并再次确认持久状态后，只在首张票前显式创建一次最多 2 人的随机命名房间。第一个短 SERIALIZABLE 事务锁定会话行并选出唯一 session-wide `PROVISIONING` owner；其他并发签票返回忙且不得调用 CreateRoom。owner 在事务外调用 LiveKit，成功后由第二个短事务原子提交 `room_provisioned_at` 与参与者 `ROOM_READY`，提交前不签发任何 Join Ticket；失败或超时则终止整个会话，绝不把建房权交给另一个并发请求。后续家属端与陪伴端签票看到该标记后直接复用房间，不再调用 CreateRoom。这样，首次建房即使在客户端超时后迟到完成，也不能与任何已交付票据组合；一旦有票据可交付，又不存在后续迟到建房请求。LiveKit 在所有环境关闭 `room.auto_create`，终态优先删除房间，只有删除失败时才降级移除参与者并重试删除。其他建房失败均安全终止会话且不返回 Token。无人入会的显式房间在 60 秒后自动失败关闭，与初始 Join Ticket 窗口对齐，但不代替终态删除。[LiveKit Tokens & grants](https://docs.livekit.io/frontends/reference/tokens-grants/)

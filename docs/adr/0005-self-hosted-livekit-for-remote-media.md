---
status: accepted
---

# 远程陪伴媒体采用自托管 LiveKit

采用 NestJS 控制平面加自托管 LiveKit 媒体平面：NestJS 判断家庭权限、签发短时房间资格并保存审计，LiveKit 负责 Web/Android WebRTC 信令、SFU、重连和 TURN。相比自行实现裸 WebRTC P2P、coturn、ICE 重启与两端重连，这增加一个部署进程和媒体中转流量，但显著降低跨端通话的实现与稳定性风险。产品方已于 2026-08-01 确认允许部署自托管 LiveKit。

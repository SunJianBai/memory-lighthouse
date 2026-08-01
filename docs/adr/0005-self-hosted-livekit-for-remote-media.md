---
status: proposed
---

# 远程陪伴媒体采用自托管 LiveKit

拟采用 NestJS 控制平面加自托管 LiveKit 媒体平面：NestJS 判断家庭权限、签发短时房间资格并保存审计，LiveKit 负责 Web/Android WebRTC 信令、SFU、重连和 TURN。相比自行实现裸 WebRTC P2P、coturn、ICE 重启与两端重连，这增加一个部署进程和媒体中转流量，但显著降低跨端通话的实现与稳定性风险；该决定待产品方确认可以增加 LiveKit 进程后转为 accepted。


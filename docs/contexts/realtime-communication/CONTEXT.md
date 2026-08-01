# Realtime Communication

管理家属与陪伴设备之间有授权、强提示、可立即结束的实时音视频沟通。系统使用“远程陪伴”，不把隐蔽开启摄像头或麦克风称为正常的“接管”。

## Language

**Remote Assistance Session**:
一名获授权家属与一个 Companion Endpoint 之间开始和结束明确的实时音视频会话。
_Avoid_: Takeover, Monitoring, Model Session

**Initiator**:
发起 Remote Assistance Session 的 Household Member。
_Avoid_: Caller Account, Administrator

**Remote Media Grant**:
针对一个 Care Recipient 和一个 Initiator，允许远程音频、视频或自动接听的可撤回授权。
_Avoid_: Camera Permission, Household Role

**Join Ticket**:
只允许加入某一次 Remote Assistance Session、短时有效且不可复用的资格。
_Avoid_: Access Token, Meeting Password

**Media Presence Indicator**:
陪伴端在远程摄像头或麦克风工作期间持续呈现的视觉与听觉状态。
_Avoid_: Toast, Audit Log

**Session Outcome**:
Remote Assistance Session 的终态事实，例如拒绝、取消、已结束、超时或连接失败。
_Avoid_: Call State, Error Message


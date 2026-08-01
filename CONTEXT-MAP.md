# Context Map

“守忆灯塔”同时处理账号权限、家庭照护资料、全模态陪伴、远程音视频和平台运营。它们具有不同的授权范围和生命周期，因此分别建模，避免把“用户”“长者”“设备”和“会话”混成一个对象。

## Contexts

- [Identity & Access](./docs/contexts/identity-access/CONTEXT.md) — 识别人和设备，并签发具有明确范围的访问资格
- [Household Care](./docs/contexts/household-care/CONTEXT.md) — 管理家庭、陪伴对象、可信资料、日程和家属闭环
- [Companion Session](./docs/contexts/companion-session/CONTEXT.md) — 组织一次全模态陪伴过程及其确定性业务动作
- [Realtime Communication](./docs/contexts/realtime-communication/CONTEXT.md) — 管理家属与陪伴设备之间可见、可撤销的实时音视频会话
- [Platform Operations](./docs/contexts/platform-operations/CONTEXT.md) — 管理平台运维、开发期内容检查、通知和审计

## Relationships

- **Identity & Access → Household Care**：提供 `UserId`；Household Care 决定用户在某个家庭中的成员身份和权限。
- **Identity & Access → Companion Session**：提供范围受限的 `DeviceIdentity`；设备身份不继承激活者的完整家属权限。
- **Household Care → Companion Session**：发布陪伴对象、有效授权、可信记忆、日程和联系人快照。
- **Companion Session → Household Care**：提交来源明确的陪伴事件和本人确认，不直接改写日程定义。
- **Household Care → Realtime Communication**：提供允许发起远程陪伴的成员关系和陪伴对象授权。
- **Identity & Access → Realtime Communication**：提供短时会话资格；长期登录凭证不会交给媒体通道。
- **Realtime Communication → Household Care**：记录远程会话开始、结束、拒绝和失败等事实事件。
- **Platform Operations ← All Contexts**：接收最小必要的运行指标和不可变审计记录；开发期查看内容也必须经过显式检查授权。


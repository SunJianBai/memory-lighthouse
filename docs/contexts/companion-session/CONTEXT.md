# Companion Session

组织一次开始和结束明确的全模态陪伴过程，并将生成式交互限制在确定性业务规则之内。

## Language

**Companion Endpoint**:
以陪伴模式运行、绑定到一个 Care Recipient 的 Web 或 Android 客户端。
_Avoid_: Elder Account, Camera Device

**Companion Session**:
Care Recipient 主动开始或已授权设备启动的一段连续陪伴过程。
_Avoid_: Login Session, Model Session, Remote Assistance Session

**Model Session**:
Companion Session 为全模态理解与表达而建立的一次模型连接。
_Avoid_: Companion Session, Conversation

**Care Snapshot**:
在一次 Companion Session 开始时取得的最小必要可信资料和授权版本集合。
_Avoid_: Full Profile, Prompt

**Agent Action**:
确定性规则层要求模型表达或要求客户端执行的有类型动作。
_Avoid_: Model Reply, Tool Call

**Observation**:
陪伴过程中由用户输入、设备状态或模型输出形成，但尚未成为业务事实的信息。
_Avoid_: Care Event, Diagnosis

**Conversation Turn**:
一次来源明确的用户或模型文本表达；它不包含隐藏推理。
_Avoid_: Thought, Care Event


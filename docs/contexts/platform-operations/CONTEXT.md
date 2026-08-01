# Platform Operations

支持平台运行、开发期内容检查和问题追踪，同时确保运营人员的访问本身也可解释、可追责。

## Language

**Operator**:
拥有 Platform Role、负责平台运行或开发验证的 User。
_Avoid_: Family Member, Super User

**Inspection Grant**:
允许 Operator 在限定家庭、内容类型和时间范围内查看原文的显式资格。
_Avoid_: Admin Role, Debug Mode

**Content Inspection**:
Operator 基于 Inspection Grant 查看可信记忆或对话原文的行为。
_Avoid_: Normal Read, Database Query

**Audit Entry**:
对敏感操作的主体、对象、目的、结果和时间所作的不可变记录。
_Avoid_: Application Log, Care Event

**Retention Rule**:
规定某类数据保留、匿名化或删除时间的规则。
_Avoid_: Cleanup Job, Consent Grant

**Delivery Attempt**:
系统通过一种通知渠道发送某条通知的一次结果记录。
_Avoid_: Notification, Family Task


# Household Care

表达家庭范围内的照护资料、可信事实、日程和协同闭环。Household 是此上下文的数据与授权边界。

## Language

### People and scope

**Household**:
共享一个或多个陪伴对象资料和照护工作的家庭协作空间。
_Avoid_: Tenant, Family Account

**Household Member**:
一个 User 在某个 Household 中的成员身份及作用范围。
_Avoid_: User Role, Family Account

**Care Recipient**:
接受陪伴的个人档案；它可以没有 User，也不等同于登录陪伴设备的人。
_Avoid_: Elder Account, Patient, Device User

**Trusted Contact**:
陪伴对象允许系统在特定情况下展示或联系的人。
_Avoid_: Household Member, Emergency Contact

**Care Authority**:
Household Member 针对一个 Care Recipient 获得的具体照护权限集合。
_Avoid_: Global Role, Ownership

### Consent and trusted facts

**Consent Grant**:
陪伴对象或其授权家属对一种数据处理目的作出的有版本、有期限、可撤回许可。
_Avoid_: Setting, Checkbox

**Trusted Memory**:
由有权限的家属维护、可向陪伴过程提供的事实资料。
_Avoid_: Model Memory, Chat History

**Medication Record**:
家属录入的药盒标签、称呼、位置和操作要求，不代表处方或医学判断。
_Avoid_: Prescription, Pill Recognition

### Work and evidence

**Routine**:
描述重复任务及其触发规则的长期定义。
_Avoid_: Reminder, Task Instance

**Routine Occurrence**:
Routine 在某个计划时刻产生的一次独立执行机会。
_Avoid_: Routine, Reminder

**Care Event**:
对已经发生的陪伴或协作事实所作的来源明确、不可静默改写的记录。
_Avoid_: Alert, Diagnosis, Model Thought

**Confirmation**:
长者本人或有权限家属针对某个 Routine Occurrence 作出的明确回执。
_Avoid_: Model Inference, Silence

**Family Task**:
因缺少明确确认或需要人工处理而交给家属的工作项。
_Avoid_: Emergency Alert, Care Event


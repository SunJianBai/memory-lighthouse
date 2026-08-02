# Identity & Access

识别人和设备，表达它们可以代表谁、在多长时间内执行什么操作。它不定义家庭内的照护关系。

## Language

**User**:
能够使用邮箱或用户名登录守忆灯塔的人类账号。
_Avoid_: Account, Family, Elder

**Login Identity**:
与一个 User 关联、经过规范化且全局唯一的邮箱或用户名。
_Avoid_: Username field, Credential

**Credential**:
用于证明某个 Login Identity 所属关系的秘密材料。
_Avoid_: Token, Identity

**User Session**:
User 在一个客户端上的可撤销登录状态。
_Avoid_: Login, Device Session

**Admin Session**:
Operator 仅在管理员入口中使用的可撤销登录状态；它与 User Session 具有不同的令牌受众、刷新凭据用途和 Cookie 作用域，不能互换。
_Avoid_: User Session, Platform Role

**Device Identity**:
陪伴设备完成激活后取得的独立身份，只拥有指定陪伴对象和用途的权限。
_Avoid_: Family Session, Shared Login

**Device Key Protection Capability**:
官方客户端在安装登记时显式声明的密钥算法与不可导出保护协议版本；算法为 `ED25519` 或 `ECDSA_P256_SHA256`，保护值为 `NON_EXPORTABLE_V1`。服务端严格校验算法和公钥类型，但保护值仍是客户端版本门槛，不是硬件远程证明。
_Avoid_: Attestation, Hardware Proof

**Activation Challenge**:
由家属发起、短时有效且只能成功使用一次的设备激活邀请。
_Avoid_: Permanent Code, Pairing Password

**Platform Role**:
User 在整个平台范围内承担的运营身份，例如开发检查员或平台管理员。
_Avoid_: Household Role, Permission Group

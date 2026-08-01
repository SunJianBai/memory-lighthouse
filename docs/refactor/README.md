# 守忆灯塔完整重构设计

本目录定义“守忆灯塔”从单机比赛 Demo 演进为多账号、跨设备、可远程协作系统的目标架构。文档以 2026-08-01 已确认的产品选择为基线；已经确认的安全决策和仍需外部凭据的事项集中记录在[决策确认记录](./11-open-questions.md)。

## 已确认的架构基线

- 服务器采用 NestJS + Prisma + MySQL。
- Redis 保存短时状态、限流数据和任务队列；MinIO 保存图片、音频等对象，MySQL 保存元数据。
- 用户侧采用一个 Web 和一个原生 Android App，登录后按家庭权限及设备模式显示家属或陪伴页面。
- 管理员 Web 独立部署，基于 Art Design Clean 改造。
- 家属使用邮箱或用户名加密码登录。
- 陪伴设备由家属账号发起二维码或动态激活码绑定；激活成功后改用范围受限的设备身份。
- 家属可向陪伴设备发起远程音视频会话。
- 开发阶段允许管理员查看家庭记忆和对话原文，但每次访问必须授权和审计，生产环境默认关闭。

## 文档导航

1. [产品范围与角色](./01-product-scope.md)
2. [总体架构](./02-system-architecture.md)
3. [服务器 Module 设计](./03-module-design.md)
4. [数据库与 ER 设计](./04-data-model.md)
5. [接口与实时协议](./05-interface-contracts.md)
6. [远程陪伴音视频](./06-remote-assistance.md)
7. [安全、权限与隐私](./07-security-and-privacy.md)
8. [部署与运维](./08-deployment-and-operations.md)
9. [旧 Demo 迁移方案](./09-migration-plan.md)
10. [开发计划与验收](./10-development-roadmap.md)
11. [决策确认记录与外部依赖](./11-open-questions.md)
12. [数据字典](./database/data-dictionary.md)
13. [Prisma 目标模型草案](./database/schema.prisma)
14. [Prisma 7 配置草案](./database/prisma.config.ts)
15. [实施状态](./IMPLEMENTATION_STATUS.md)

## 图表

- [系统架构图源文件](./diagrams/system-architecture.mmd)
- [核心 ER 图源文件](./diagrams/er-core.mmd)
- [照护业务 ER 图源文件](./diagrams/er-care.mmd)
- [会话与运维 ER 图源文件](./diagrams/er-session-ops.mmd)
- [设备激活时序图源文件](./diagrams/device-activation-sequence.mmd)
- [远程陪伴时序图源文件](./diagrams/remote-assistance-sequence.mmd)

## 文档约束

- `CONTEXT-MAP.md` 与各 `CONTEXT.md` 只定义统一语言，不记录技术实现。
- 本目录描述目标架构和迁移路线，不代表当前单机 Demo 已经实现这些能力。
- 数据库模型是实现基线；生成首个 Prisma migration 前仍须经过一次迁移演练和权限审查。

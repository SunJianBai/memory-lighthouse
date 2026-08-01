# 部署与运维

## 1. 环境拓扑

### 1.1 本地开发

```text
Docker Compose
├─ mysql
├─ redis
├─ minio
├─ minio-init
├─ livekit
├─ server-api
├─ server-worker
├─ admin-web
├─ client-web
└─ reverse-proxy
```

Android 真机通过局域网 HTTPS 开发域名访问；摄像头、麦克风、WebCrypto 和 WebRTC 不应依赖明文 HTTP。开发证书需导入测试设备，不能通过关闭 TLS 校验解决。

### 1.2 测试/演示

建议域名：

```text
app.demo.example.com      用户 Web
admin.demo.example.com    管理员 Web
api.demo.example.com      NestJS HTTPS/WSS
rtc.demo.example.com      LiveKit WSS
turn.demo.example.com     TURN/TLS
objects.demo.example.com  MinIO 受控入口
```

LiveKit 自托管需要公网可达地址、可信证书和 UDP/TCP 端口；TURN/TLS 443 用于严格网络兜底。部署要求以 [LiveKit 官方自托管说明](https://docs.livekit.io/transport/self-hosting/deployment/)为准。

### 1.3 生产

首版仍可单区域部署，但应将以下进程分开：

- 无状态 `server-api`，至少两个实例。
- `server-worker`，处理 Outbox、日程、通知、清理和保留任务。
- LiveKit 媒体节点。
- MySQL 主实例及备份目标。
- Redis；NestJS 与 LiveKit 至少使用不同账号、DB/Key Prefix。
- MinIO，启用版本化、服务端加密和生命周期规则。
- 静态 Web 由反向代理或对象 CDN 提供。

## 2. 环境隔离

开发、测试和生产不得共享：

- MySQL 实例、用户或备份。
- Redis 实例/账号和 Key Prefix。
- MinIO Bucket、访问密钥和加密密钥。
- JWT、Cookie、设备凭据和数据加密主密钥。
- LiveKit API Key/Secret、TURN Secret 和房间域名。
- Android 包名、签名证书、Deep Link 和 Push 项目。
- 管理员身份、模型配置、日志和监控项目。

令牌包含 `environment`，跨环境立即拒绝。

## 3. 配置类别

### 3.1 server-api

```text
APP_ENV
PUBLIC_API_ORIGIN
DATABASE_URL
REDIS_URL
MINIO_ENDPOINT / MINIO_BUCKET / MINIO_ACCESS_KEY / MINIO_SECRET_KEY
SESSION_SIGNING_KEY / DEVICE_SIGNING_KEY
DATA_KEY_PROVIDER / DATA_KEY_ID
LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET
MODEL_PROVIDER / MODEL_REALTIME_URL / MODEL_CHAT_URL
EMAIL_PROVIDER / EMAIL_FROM
ADMIN_CONTENT_INSPECTION_ENABLED
OTEL_EXPORTER_OTLP_ENDPOINT
```

生产环境检测到 `ADMIN_CONTENT_INSPECTION_ENABLED=true` 时默认拒绝启动。

### 3.2 Android

- API 和 RTC 基础地址由 Build Variant 注入。
- 不在 APK 中放服务器、MinIO、LiveKit 或模型管理密钥。
- 开发、测试、生产使用不同 application ID suffix 和签名。
- Network Security Config 禁止生产明文流量。

### 3.3 Web

- 构建时只包含公开地址和非秘密功能开关。
- 管理员 Web 与用户 Web 使用不同 Origin 和 Cookie 名称。
- CSP 限定 API、RTC、对象和模型端点。

## 4. Prisma 迁移

Prisma 7 将连接 URL 放在 `prisma.config.ts`，不再写入 schema datasource。参考配置见 [prisma.config.ts](./database/prisma.config.ts)，依据 [Prisma 官方配置说明](https://docs.prisma.io/docs/orm/reference/prisma-config-reference)。

迁移流程：

```text
开发：prisma migrate dev
评审：检查生成 SQL、索引、外键、CHECK 和锁表风险
CI：对空库 migrate deploy，再运行集成测试
演练：从上一发布快照迁移并执行回滚/前滚验证
生产：备份 → prisma migrate deploy → 冒烟测试
```

对生成列、当前绑定唯一约束、`FOR UPDATE SKIP LOCKED` 等 Prisma 无法完整表达的能力，使用 `--create-only` 后评审并编辑迁移 SQL；不得在生产使用 `db push`。

## 5. MySQL 运维

- 字符集使用 `utf8mb4`，登录规范化列采用确定性大小写策略。
- 所有连接使用 TLS；应用账号无 DDL 权限。
- 每日全量备份加连续增量/日志备份，至少每季度做一次恢复演练。
- 监控连接池、慢查询、死锁、复制延迟、磁盘和备份新鲜度。
- Outbox、日程物化和清理任务采用短事务及固定加锁顺序。
- 审计表与业务表使用不同保留策略，普通管理员无 UPDATE/DELETE 权限。

目标建议：业务数据库 RPO 不超过 15 分钟，RTO 不超过 2 小时；比赛环境至少准备启动前快照和一键重建脚本。

## 6. Redis 运维

Redis 保存：

- 登录/激活/呼叫限流。
- 设备在线状态和最后心跳 TTL。
- `media-owner:{bindingId}` 排他租约。
- BullMQ 作业和 Outbox 投递状态。
- 短时会话辅助数据；不保存唯一业务事实。

Redis 清空后系统允许在线状态短暂丢失，但不能造成授权恢复、任务完成或历史删除。

## 7. MinIO 运维

- Bucket 按环境隔离，不按家庭创建海量 Bucket。
- Object Key 使用随机 ID，不含姓名、邮箱、家庭名称或原文件路径。
- 上传意图限制 MIME、大小、哈希和单次操作。
- 上传完成后先进入 `PENDING_SCAN`，扫描通过才允许进入模型上下文。
- 开启服务端加密、版本化和生命周期规则。
- 数据库标记删除后由 Worker 删除对象；失败持续重试并告警。
- 备份必须同时包含 MySQL 元数据和对象版本，恢复后执行引用一致性扫描。

## 8. LiveKit 运维

- NestJS 是创建业务会话和签发 Join Ticket 的唯一入口。
- 房间名不可猜测，Token 短 TTL，结束时移除参与者或删除房间。
- Webhook 验签并幂等处理；Webhook 迟到不能复活终态会话。
- 监控房间数、参与者数、加入耗时、丢包、TURN 占比、出入带宽和异常结束。
- 不启用 Egress，除非未来增加独立录制需求和授权。
- 网络故障时优先保证双方明确看到“已断开”，而不是维持假在线状态。

## 9. 模型 Provider

Provider 作为可替换 Adapter：

```text
ModelBest 公网
Ascend 本地 MiniCPM-o
Replay/Fake（测试和演示保底）
```

- Provider 配置由服务器下发，不由普通客户端任意修改。
- 公网处理必须有有效 Consent。
- 当前会话使用的 Care Snapshot 和 Prompt Version 记录哈希。
- 模型不可用时保留确定性业务状态，不把失败请求标记为已提醒。
- Ascend 复现材料固定镜像、驱动、模型、入口、启动命令和健康检查。

## 10. 可观测性

建议统一 OpenTelemetry Trace、结构化日志和指标：

- HTTP 延迟、错误码、数据库耗时。
- WebSocket 连接数、断线和补同步次数。
- 日程生成延迟、Outbox 堆积和通知失败。
- 激活成功率、过期率和失败次数。
- 模型排队、首响、会话时长、错误类型。
- 远程呼叫建立时间、拒绝/超时、TURN 比例和异常断开。
- MinIO 上传、扫描和删除失败。
- 管理员内容检查次数和异常访问模式。

日志只保存 ID 和非敏感指标，不保存正文、Prompt、音视频、凭据或签名 URL。

## 11. 启动与健康检查

```text
/health/live    进程存活，不访问远程依赖
/health/ready   MySQL、Redis、迁移版本和关键配置可用
/health/detail  仅管理员可见的 MinIO、LiveKit、模型和队列状态
```

启动顺序：基础设施 → migration job → server-api/worker → Web；模型或通知暂时不可用不应阻止读取家庭资料，但必须使相关能力明确降级。

## 12. 备份与事故处置

至少准备以下 Runbook：

1. 数据库恢复和迁移失败前滚。
2. Device Credential 或签名密钥泄露后的批量撤销。
3. MinIO 对象误删和孤儿对象扫描。
4. LiveKit/TURN 故障切换和全局结束会话。
5. Model Provider 故障切回 Replay 或本地 Ascend。
6. 管理员原文权限误开后的启动阻断、审计查询和通知。
7. 家庭账号被盗后的会话、设备和远程权限一键撤销。


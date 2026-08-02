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
RATE_LIMIT_KEY_SECRET
MINIO_ENDPOINT / MINIO_BUCKET / MINIO_ACCESS_KEY / MINIO_SECRET_KEY
SESSION_SIGNING_KEY / DEVICE_SIGNING_KEY
AUTH_ADMIN_ACCESS_TOKEN_SECRET
DATA_KEY_PROVIDER / DATA_KEY_ID
LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET
MODEL_PROVIDER / MODEL_REALTIME_URL / MODEL_CHAT_URL
EMAIL_PROVIDER / EMAIL_FROM
ENABLE_DEVELOPMENT_CONTENT_INSPECTION
ASSET_LIFECYCLE_WORKER_ENABLED / ASSET_LIFECYCLE_LEASE_MS
CLAMAV_HOST / CLAMAV_PORT / CLAMAV_SCAN_TIMEOUT_MS
OTEL_EXPORTER_OTLP_ENDPOINT
```

生产环境检测到 `ENABLE_DEVELOPMENT_CONTENT_INSPECTION=true` 时拒绝启动；无论开关值为何，生产模块都不注册内容检查授权和原文读取 HTTP 控制器，因此相关路径返回 404。`RATE_LIMIT_KEY_SECRET` 必须是至少 32 字节随机值的 canonical base64url，并通过独立 HMAC 域同时用于限流键和审计 IP 伪名。

TX4H4G 的生产 `CLAMAV_HOST/PORT` 固定为 `127.0.0.1:13310`：clamd 在同机独立
容器运行，只有 FreshClam 专用网络可出站更新签名，3310 映射端口不进入任何公网
安全组。签名 named volume 是可重建缓存，不是家庭业务备份的一部分。由于标准签名
引擎内存与上传量无关，生产资产 Worker 并发固定为 1，并禁止并发数据库重载。

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
- 可重建的 Worker 唤醒/调度提示；如后续引入 BullMQ，也不得承载资产扫描、永久删除等唯一任务事实。
- 短时会话辅助数据；不保存唯一业务事实。

Redis 清空后系统允许在线状态短暂丢失，但不能造成授权恢复、任务完成或历史删除。
隐私关键资产任务以 MySQL `outbox_events` 的租约、尝试次数和发布时间为持久事实；Worker 直接安全认领并周期补偿，Redis 只可加速唤醒。这样上传完成事务成功后，即使 Redis 整库丢失，扫描与删除仍会继续重试。

## 7. MinIO 运维

- Bucket 按环境隔离，不按家庭创建海量 Bucket。
- Object Key 使用随机 ID，不含姓名、邮箱、家庭名称或原文件路径。
- 上传意图限制 MIME、大小、哈希和单次操作，并要求 `If-None-Match: *`，使同一预签名 URL 不能覆盖已存在对象。
- 上传完成后保持 `PENDING`，同事务写扫描 Outbox；Worker 也按状态周期补偿发现，扫描通过才允许下载或进入模型上下文。
- 扫描器必须消费对象真实字节并使用 ClamAV `INSTREAM`；仅检查 HEAD/Metadata 不算恶意内容扫描。clamd 不可用时写 `FAILED`、继续拒绝访问并退避重试。
- 生产发布先校验 ClamAV 的不可变镜像，再在任何发布指针、备份或迁移变更前等待签名加载，并同时通过 `PING` 和空内容 `INSTREAM`；仅 TCP 端口可连接不能视为扫描器健康。systemd watchdog 还会周期检查 FreshClam 子进程、72 小时内的 daily 文件，并用 clamd `VERSION` 交叉核对引擎实际加载版本；官方容器 PID 1 不随后台子进程退出，因此不能只依赖 Docker restart policy。正常签名 reload 有界宽限后仍不能证明新鲜时，watchdog 按当前 release 强制重建；恢复失败会停止 clamd 并执行一小时重建冷却，使资产继续失败而不是由陈旧引擎判为 CLEAN。
- 开启 SSE-S3、版本化和生命周期规则；客户端 PUT 显式要求 `AES256`，完成上传时再次从 HEAD 验证。
- 数据库标记删除后由带租约 Worker 等待上传 URL 过期，再永久删除该 Key 的全部对象版本与 Delete Marker；二次列举和 HEAD 都确认无内容后写 `DELETED`，失败保留 `PENDING_DELETE` 持续重试并告警。
- 备份必须同时包含 MySQL 元数据和对象版本，恢复后执行引用一致性扫描。

## 8. LiveKit 运维

- NestJS 是创建业务会话和签发 Join Ticket 的唯一入口。
- 房间名不可猜测，Token 短 TTL，结束时移除参与者或删除房间。
- Webhook 验签并幂等处理；Webhook 迟到不能复活终态会话。
- 自托管 LiveKit 的参与者移除/权限更新不提供 LiveKit Cloud 的 Token 撤销语义；连接中的客户端还可能收到刷新 Token，其有效期为 10 分钟或原 Token 剩余有效期（取更长者）。以 [LiveKit 官方 Token 与 grants 说明](https://docs.livekit.io/frontends/reference/tokens-grants/)为准，不能把 `RemoveParticipant`、等待 60 秒或清空 Redis 当作全局凭据撤销。
- 涉及全量设备凭据失效的迁移必须在 API 与 LiveKit 同时停机时执行；停机核实后先持久化 `security-boundary.pending`，再原子轮换 `LIVEKIT_API_SECRET`，旧密钥不得备份或在失败/回滚中恢复。随后清除应用 Redis 的媒体租约和专用 LiveKit Redis 的临时房间状态，迁移成功后才使用新密钥重新启动 LiveKit 与 API。
- 每个 release 声明单调递增的 security epoch。新应用健康后按 `current-app` → `minimum-security-epoch` → 清除 pending 的顺序持久化；pending 存在或应用 epoch 低于 floor 时，systemd start/reload 和应用回滚一律拒绝。跨 epoch 失败只能用相同或更高 epoch 前滚；同 epoch 也不能代表 schema 向后兼容，只有迁移尚未开始且不是续跑既有 pending 时，才可在旧应用与 LiveKit 重新健康后自动恢复，否则必须前滚。
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

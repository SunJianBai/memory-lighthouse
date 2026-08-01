# TX4H4G 生产部署方案

此目录是 TX4H4G 的可审阅部署产物。目标主机为 Ubuntu 24.04（SSH 别名
`TX4H4G`，公网 IP `124.220.81.104`），并保证现有
CampusHub 后端 `127.0.0.1:8080`、数据库 `127.0.0.1:33306` 和数据卷不被复用或
修改。已确认当前 `campushub_frontend` 独占 `0.0.0.0:80`；主机没有正在运行的
Caddy/nginx。

本目录是 TX4H4G 生产部署的权威版本；早期的 `infra/caddy/Caddyfile.tx4h4g` 与
`infra/tx4h4g/README.md` 仍是开发阶段的 rtc/assets 子域草案，集成提交时应删除
或明确标为 deprecated，不能与本手册混用。

## 最终拓扑

| 公网入口 | 本机上游 | 暴露方式 |
| --- | --- | --- |
| `https://sun227454.online/openBMB/` | `127.0.0.1:14173` | Caddy → 家属/陪伴 Web |
| `https://sun227454.online/openBMB/admin/` | `127.0.0.1:14174` | Caddy → 管理 Web |
| `https://sun227454.online/openBMB/api/v1/*` | `127.0.0.1:13100` | Caddy → NestJS |
| `wss://sun227454.online`（SDK 使用 `/rtc/v1`） | `127.0.0.1:17880` | Caddy → LiveKit 信令 |
| `https://sun227454.online/openbmb-assets/*` | `127.0.0.1:19000` | Caddy → 私有 MinIO S3 API |
| 其他 `sun227454.online` 路径 | `127.0.0.1:18080` | Caddy → 原 CampusHub 前端 |

LiveKit 媒体不经过 Caddy，直接使用 `7881/TCP`、`7882/UDP`、`3478/UDP`。
MySQL `13306`、应用 Redis `16379`、LiveKit Redis `16380`、MinIO `19000/19001`
均只绑定 `127.0.0.1`。管理控制台 `19001` 永不反向代理。

API 和 LiveKit 在 Linux 上使用 host network，但 API 强制监听 `127.0.0.1`，
LiveKit 信令也强制监听 `127.0.0.1`。这样 Caddy 是应用所信任的唯一回环代理，
不会把所有请求错误地识别为 Docker 网桥地址。LiveKit 只有配置中明确的媒体端口
对外监听。

MinIO 使用 S3 path-style URL，bucket 名本身就是首段
`/openbmb-assets/<object-key>`。Caddy 只精确转发这个固定 bucket 路径且不改写 URI，
所以 SigV4 的 Host 与路径保持一致，无需额外 DNS。预签名查询串包含临时签名，
Caddy 对该路由禁用 access log；MinIO 控制台仍不对外。

## 4 GB 主机资源预算

OpenBMB 长期运行容器上限约 2.2 GiB：数据/媒体基础设施约 1.64 GiB，API 448
MiB，两个静态站各 48 MiB。TX4H4G 已确认有 3.6 GiB RAM、约 1.2 GiB 当前
可用 RAM、1.9 GiB swap（约 1.1 GiB 空闲）、15 GiB 空闲磁盘，现有 CampusHub
容器约 374 MiB。`minio-init` 和迁移器是短时任务。部署前检查
`free -h`、`df -h /opt`、`docker stats --no-stream` 和
`journalctl -k | grep -i oom`。如果 CampusHub 加 OpenBMB 持续触发 OOM，应升级
主机，不应简单删除内存上限。

clamd 不部署在 TX4H4G：ClamAV 官方对标准签名库建议约 3 GiB RAM 和额外 5 GiB
磁盘，同机运行会破坏上述预算。生产使用独立私网扫描节点，建议固定官方
`clamav/clamav-debian:1.4.5`，将 `StreamMaxLength` 配置为至少 100 MiB，并在网络
侧只允许 TX4H4G 访问 3310/TCP。clamd TCP 协议本身没有认证或 TLS，绝不能暴露到
公网。参考 [ClamAV 系统要求](https://docs.clamav.net/) 与
[ClamD INSTREAM 协议](https://docs.clamav.net/manual/Usage/ClamdProtocol.html)。

首次镜像构建最吃资源：构建脚本强制按 API → 迁移器 → 家属/陪伴 Web → 管理
Web 串行执行，并把 TypeScript/Node 构建堆限制为 768/640 MiB；后续目标复用
BuildKit cache。预检要求至少 768 MiB 即时可用 RAM、RAM+空闲 swap 至少 2 GiB，
以及 `/opt` 下至少 10 GiB 空间；构建后若不足 3 GiB，会在任何数据变更前中止。
不要并行执行另一次 Gradle/npm 镜像构建。

## 目录与主机文件

推荐不可变发布布局：

```text
/opt/openbmb/
  current -> /opt/openbmb/releases/<release-id>
  releases/<release-id>/...
/etc/openbmb/infra.env
/etc/openbmb/api.env
/etc/caddy/Caddyfile
/etc/caddy/openbmb.env
/var/backups/openbmb/<UTC-stamp>/
```

`release-id` 只允许字母、数字、点、下划线和短横线，例如
`20260801T213000Z-a423a6c`。至少保留当前和上一个发布目录及其 Docker 镜像。

## 部署前仍需外部提供/完成

这些条件无法由仓库静态配置代替：

1. 提供真实 SMTP 主机、端口、账号、密码和发件地址。生产 API 会在启动时验证
   TLS SMTP；不可用时 readiness 保持失败。
2. 根域必须继续指向 `124.220.81.104`。LiveKit 标准 `/rtc/v1` 信令和 MinIO
   的 `/openbmb-assets/*` path-style S3 URL 都复用根域，不再要求新增 `rtc.*` 或
   `assets.*` DNS。
3. 腾讯云安全组和 UFW 同时允许 `80/TCP`、`443/TCP`、`7881/TCP`、
   `7882/UDP`、`3478/UDP`；保留 SSH 规则。不要放行 13100、13306、14173、
   14174、16379、16380、17880、19000、19001。
4. 当前 ModelBest MiniCPM-o 实时端点不要求 API key。若启用独立 ASR，还需在
   本机 `127.0.0.1:18082` 提供服务；远程家属通话本身不接入 ASR。
5. 提供独立私网 clamd 的主机和端口；防火墙只允许 TX4H4G 访问。生产 preflight
   会真实执行 `PING` 和空内容 `INSTREAM`，缺配置、签名库未加载或扫描不可用都会
   阻断部署。扫描失败时资产保持不可下载并由 Outbox Worker 退避重试。
6. 两台不同网络设备完成一次真实 LiveKit 音视频测试。HTTP/WSS 健康检查不能
   证明云安全组和 NAT 下的 UDP 媒体可达。

## 1. 静态审阅与校验

开发机/服务器有 Docker Compose v2.40 时，在仓库根执行：

```bash
bash infra/production/scripts/validate-static.sh
```

它检查所有 shell 语法、合并后的 Compose 模型、回环端口和生产内容检查硬关闭，
不会启动或重启容器。正式主机填好 secret 文件后再运行：

```bash
sudo OPENBMB_INFRA_ENV_FILE=/etc/openbmb/infra.env \
  OPENBMB_API_ENV_FILE=/etc/openbmb/api.env \
  bash /opt/openbmb/releases/<release-id>/infra/production/scripts/preflight.sh
```

## 2. 安装 secrets

```bash
sudo groupadd --system openbmb 2>/dev/null || true
sudo install -d -o root -g openbmb -m 0750 \
  /opt/openbmb /opt/openbmb/releases /etc/openbmb
sudo install -o root -g openbmb -m 0640 \
  infra/production/env/infra.env.example /etc/openbmb/infra.env
sudo install -o root -g openbmb -m 0640 \
  infra/production/env/api.env.example /etc/openbmb/api.env
```

`/opt/openbmb` 是 security floor、pending 和两个发布指针的状态根，必须是
`root:openbmb` 拥有的真实目录，且组/其他用户不可写；不能由部署账号拥有，也不能是
符号链接。生产工作流会在传输发布前用 `sudo -n` 复核该条件，不满足就停止。上面的
`install -d` 可安全修正现有目录的属主和权限，不会删除其中的发布。

编辑两个文件，替换全部 `CHANGE_ME`。基础设施 secret 使用彼此独立的 base64url
值：

```bash
openssl rand -base64 36 | tr '+/' '-_' | tr -d '=\n'; printf '\n'
```

`DATA_ENCRYPTION_KEY_BASE64` 必须是恰好 32 字节的标准 Base64：

```bash
openssl rand -base64 32 | tr -d '\n'; printf '\n'
```

`MINIO_KMS_SECRET_KEY` 使用独立的 SSE-S3 静态主密钥，格式是
`<key-name>:<恰好 32 字节的标准 Base64>`：

```bash
printf 'openbmb-sse:'; openssl rand -base64 32 | tr -d '\n'; printf '\n'
```

该值丢失会使现有加密卷不可读，必须进入独立 Secret 备份和恢复演练，但不能写入
数据库、发布目录或仓库。MinIO 同时设置 Bucket 默认 SSE-S3；应用的预签名 PUT
仍显式要求 `AES256` 与 `If-None-Match: *`，并在完成上传的 HEAD 中复核。版本化
Bucket 的普通 DELETE 只创建 Delete Marker，因此应用身份同时仅获
`ListBucketVersions`/`DeleteObjectVersion` 权限；删除 Worker 会等待上传签名过期，
再按版本 ID 永久清除并复核。实现依据
[MinIO 静态 KMS 设置](https://docs.min.io/aistor/reference/aistor-server/settings/server-side-encryption/)、
[MinIO Bucket SSE-S3](https://docs.min.io/aistor/reference/cli/mc-encrypt/mc-encrypt-set/) 和
[AWS SSE-S3 请求/HEAD 约定](https://docs.aws.amazon.com/AmazonS3/latest/userguide/specifying-s3-encryption.html)、
[AWS 版本化对象删除](https://docs.aws.amazon.com/AmazonS3/latest/userguide/DeletingObjectVersions.html)和
[AWS 条件写入](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)。

不要把 secret 放入发布目录、Git、shell 历史或工单。Compose 只把运行所需的
数据库用户密码传给 API，不会把 MySQL/MinIO root 凭据传给 API。`api.env` 使用
Compose raw 格式读取，SMTP 密码中的 `$` 等字符不会被插值。

## 3. 发布应用（尚不切换公网）

### 推荐：GitHub Runner 构建并经 SSH 传送

TX4H4G 所在网络不能可靠访问 Docker Hub，因此仓库的
`.github/workflows/production-delivery.yml` 在已通过 CI 的 GitHub Runner 上构建
四个应用镜像、拉取本文件锁定的基础设施镜像，再把九个精确镜像作为私有、按发布号
隔离的传输 tag 推送到 GHCR。TX4H4G 通过固定主机密钥的 SSH 接收本次工作流短期
Token，从 GHCR 按摘要拉取后写入 Compose 使用的 release-scoped 本地 tag；Token 只进入 `docker login`
标准输入并使用临时 `DOCKER_CONFIG`，完成后立即注销和清理。服务器不会从第三方
公共加速器或 Docker Hub 拉取镜像。

仓库的 `production` Environment 需要两个 Base64 编码的 Actions Secret：
`TX4H4G_SSH_PRIVATE_KEY_BASE64` 和 `TX4H4G_KNOWN_HOSTS_BASE64`。仓库变量
`PRODUCTION_DEPLOY_ENABLED` 默认必须保持 `false`。手工运行工作流在任何情况下都
只会预装并验证精确提交的源码和镜像，不提供生产激活参数。首次部署、
真实 SMTP 和 Caddy 切流全部验证后，再把该变量改为 `true`，后续 `main` 的 CI
成功运行才会自动激活。PR、非 `main` 手工运行和被取消/失败的 CI 都不能触发生产
部署。

工作流使用确定性的 `git-<12位提交哈希>` 发布号，并在发布目录写入完整提交哈希、
源码归档 SHA-256、GHCR transport digest 清单和服务器本地镜像 ID 清单。发布树由 `root` 拥有且不可被组或其他用户
写入；容器必须读取的 Redis/LiveKit 配置只获得只读例外。新发布先传送镜像，再在
临时目录核对 Compose 实际引用的全部 9 个镜像 ID 和四个应用镜像的 OCI revision，
通过后才原子落盘。同一提交重跑时会先验证并复用已有不可变发布，防止重建镜像覆盖
已有 tag。`deploy-release.sh` 强制要求
`OPENBMB_SKIP_IMAGE_BUILD=true` 且上述完整校验通过；TX4H4G 不提供主机本地生产构建回退。所有生产
`compose up/run` 都使用 `--pull never`，不会在主机上回退访问 Docker Hub。

发布脚本依次执行：严格预检 → 校验已预装的 release tag 与两份摘要清单 → 对普通新部署做 MySQL
和 MinIO 备份（续跑 pending 时禁止重复备份）→ 先原子持久化 `current` 栈指针 → 同时停止并核实 API 与 LiveKit → 原子写入
`/opt/openbmb/security-boundary.pending` → 原子轮换 `/etc/openbmb/infra.env` 中的
`LIVEKIT_API_SECRET` → 启动/核对数据服务 → 定向清空应用媒体租约和专用 LiveKit Redis
临时状态 → `prisma migrate deploy` → 启动并核对 LiveKit → 启动三个应用容器 → 本机
liveness/readiness → 原子切换 `current-app` → 原子提升
`/opt/openbmb/minimum-security-epoch` → 最后清除 pending。两个状态文件都由 root 持久化；
release 自带的 `infra/production/compatibility/security-epoch` 是只读兼容性声明。

`current-app`、minimum epoch 和 pending 的顺序构成持久化安全栅栏。pending 存在时，
systemd 的 start/reload 和手工应用回滚都拒绝启动应用；即使断电发生在 floor 已提升、
pending 尚未清除之间，也不会启动低 epoch 镜像。同 epoch 只有在新的不可逆边界尚未开始
（即此次运行还没有进入 LiveKit 密钥轮换）且不是续跑既有 pending 时，才可在旧应用和
LiveKit 都重新健康后自动恢复。一旦即将轮换密钥，本次进程先把恢复策略切成 fail-closed；
即使密钥文件的原子替换已完成但目录 `fsync` 报错，也不会恢复旧应用或清除 pending。
此后无论 schema 迁移是否已经开始，失败都必须保留 pending、停止应用并前滚。跨 epoch
失败同样保留新栈和 pending，只尝试以已经轮换的新密钥恢复并核对 LiveKit，必须用相同或
更高 epoch 的修复发布前滚。
旧 LiveKit 密钥不写备份、不会在失败处理或回滚中恢复。脚本不运行 `prisma migrate dev`，
也不删除卷或猜测如何回滚 schema。

自托管 LiveKit 的参与者移除/权限更新不会像 LiveKit Cloud 那样撤销已经签发的 Token；
连接中的客户端还可能收到刷新 Token，其有效期为 10 分钟或原 Token 剩余有效期（取更长者），详见
[LiveKit 官方 Token 与 grants 说明](https://docs.livekit.io/frontends/reference/tokens-grants/)。因此只等待
60 秒或清空 Redis 不足以建立凭据失效边界；每次生产激活都必须在 API 与 LiveKit 同时
停机后轮换签名密钥，再用新密钥重建 LiveKit 和 API 容器。

部署、备份、应用回滚以及公网切换共用
`/run/lock/openbmb-operation.lock`。计划备份最多等待 30 分钟，其他互斥操作在锁被
占用时以退出码 75 快速失败，避免迁移、备份和路由切换相互穿插。systemd 的启动、
重载与停止同样通过 `service-control.sh` 持有整段操作锁；健康检查不会与部署或回退交叉。

### Prisma P3009 安全迁移恢复

`20260802150000_invalidate_legacy_exportable_device_credentials` 和
`20260802151000_require_non_exportable_device_key_protection` 失败时，不得凭“看起来已经执行”
直接运行 `prisma migrate resolve`。保持 pending、API 与 LiveKit 停止，先审阅失败记录：

```bash
security_migration=20260802150000_invalidate_legacy_exportable_device_credentials
sudo bash /opt/openbmb/current/infra/production/scripts/compose.sh exec -T mysql sh -ceu '
  MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --protocol=socket --user=root \
    --table "$MYSQL_DATABASE" -e "
      SELECT migration_name, checksum, started_at, finished_at, rolled_back_at, logs
      FROM _prisma_migrations
      WHERE finished_at IS NULL AND rolled_back_at IS NULL
      ORDER BY started_at DESC;"
'
sudo bash /opt/openbmb/current/infra/production/scripts/audit-security-migration-recovery.sh \
  "$security_migration"
```

审计器只读，要求恰好一条尚未 resolve 的失败记录、release 中的 SQL checksum 完全匹配、
pending 存在且 API/LiveKit 已停止。`150000` 的所有数据写入在一个 InnoDB 事务中：最终
失效条件全部成立时只给出 `--applied` 候选；仍有未失效对象且没有迁移专用终态标记时只
给出 `--rolled-back` 候选；混合状态拒绝自动判断。`151000` 只有一个原子
`ALTER TABLE`：两列及三个强制 CHECK 全部满足时给出 `--applied`，全部不存在时给出
`--rolled-back`，任何半完成形态都拒绝。该策略对应
[MySQL 原子 DDL](https://dev.mysql.com/doc/refman/8.4/en/atomic-ddl.html) 和
[Prisma 生产失败迁移恢复](https://docs.prisma.io/docs/orm/prisma-migrate/workflows/patching-and-hotfixing)。

人工复核 `logs` 与审计结果后，只执行审计器打印的那一个候选命令。例如确认为完整回滚时：

```bash
sudo bash /opt/openbmb/current/infra/production/scripts/compose.sh \
  --profile tools run --rm --pull never migrate \
  ../../node_modules/.bin/prisma migrate resolve --rolled-back \
  20260802150000_invalidate_legacy_exportable_device_credentials
```

若审计结果是 `--applied`，只把上例改为审计器给出的 `--applied <完整迁移名>`。resolve
后重新运行同 epoch 或更高 epoch 的完整部署，让 `prisma migrate deploy` 继续并最终由健康
检查提升 floor、清除 pending；不要单独启动应用，也不要手工删除 `_prisma_migrations` 行。

## 4. 安装 Caddy（先校验，不启动）

使用 Caddy 2.10.2 或更高版本（配置已用 2.10.2 实际校验）并从官方 Ubuntu
仓库安装。软件包安装过程可能尝试启动默认服务，
而 80 此时仍由 `campushub_frontend` 占用；安装完成后先明确停用，再写配置：

```bash
sudo systemctl disable --now caddy || true
sudo install -o root -g root -m 0644 \
  infra/production/caddy/Caddyfile /etc/caddy/Caddyfile
sudo install -o root -g caddy -m 0640 \
  infra/production/caddy/openbmb.env.example /etc/caddy/openbmb.env
sudo install -d -o root -g root -m 0755 /etc/systemd/system/caddy.service.d
sudo install -o root -g root -m 0644 \
  infra/production/systemd/caddy-openbmb.conf \
  /etc/systemd/system/caddy.service.d/openbmb.conf
sudoedit /etc/caddy/openbmb.env
sudo systemctl daemon-reload
sudo -u caddy caddy validate \
  --config /etc/caddy/Caddyfile \
  --adapter caddyfile \
  --envfile /etc/caddy/openbmb.env
```

此时不要启动 Caddy，因为 CampusHub 仍占用 80。

## 5. CampusHub 端口交接与一次性切流

先确认真实文件和服务名：

```bash
cd /path/to/CampusHub
docker compose config --services
docker compose ps
```

服务器上已确认 CampusHub 位于 `/home/ubuntu/CampusHub`，生产 Compose 是
`docker-compose.prod.yml`，环境文件是 `.env.prod`，服务名为 `frontend`。复制 override
并查看合并结果，确认旧的 `0.0.0.0:80` 已被 `127.0.0.1:18080` **替换而非
追加**：

```bash
sudo install -o ubuntu -g ubuntu -m 0644 \
  /opt/openbmb/current/infra/production/campus/CampusHub.compose.override.yml \
  /home/ubuntu/CampusHub/openbmb-caddy.override.yml
cd /home/ubuntu/CampusHub
docker compose --env-file .env.prod \
  -f docker-compose.prod.yml -f openbmb-caddy.override.yml config

sudo bash /opt/openbmb/current/infra/production/scripts/cutover-caddy.sh \
  /home/ubuntu/CampusHub \
  docker-compose.prod.yml \
  .env.prod \
  openbmb-caddy.override.yml \
  frontend
```

脚本把交接前后解析配置写入 `/var/lib/openbmb/cutover/<stamp>`（0700），不会备份
或修改 CampusHub 后端/数据库。它在切流前后都断言 `127.0.0.1:8080` 与
`127.0.0.1:33306` 仍在监听，并且只用 `--no-deps` 重建前端服务。

## 6. systemd 与备份

首次发布和切流健康后再安装：

```bash
sudo install -o root -g root -m 0644 infra/production/systemd/openbmb.service /etc/systemd/system/
sudo install -o root -g root -m 0644 infra/production/systemd/openbmb-backup.service /etc/systemd/system/
sudo install -o root -g root -m 0644 infra/production/systemd/openbmb-backup.timer /etc/systemd/system/
sudo install -d -o root -g root -m 0700 /var/backups/openbmb
sudo systemctl daemon-reload
sudo systemctl enable openbmb.service
sudo systemctl enable --now openbmb-backup.timer
```

普通备份在 pending 存在时立即拒绝，不会把安全边界中途状态冒充成恢复点；续跑部署也
不会再次创建 pre-migration 备份。备份会短暂停止 API，使用事务快照导出 MySQL，并镜像 MinIO 的当前对象状态；
静态 Web 和 CampusHub 不停。脚本先写隐藏的 `.partial-*` 目录，校验临时 SHA-256
清单后原子发布目录，并把当时的 `/opt/openbmb/minimum-security-epoch` 作为
`minimum-security-epoch` 纳入同一清单，最后写入绑定清单摘要的
`.openbmb-backup-complete` 标记；API
恢复和本机健康检查失败会令备份单元失败，停止备份服务时最多预留 10 分钟完成恢复与
partial 清理；systemd 的 `ExecStopPost` 还会在脚本被强制终止后按当前两个版本指针
再次拉起并检查应用。结果为 0700/0600，包含个人敏感信息。必须加密复制
到异机，并按 `RESTORE.md` 在隔离环境验证。脚本不会自动删除旧备份，防止路径或
保留策略错误造成误删；需根据磁盘和离线副本制定人工保留策略。

## 回滚

### 仅回滚应用镜像

先确认当前 schema 与目标版本兼容：

```bash
sudo ROLLBACK_SCHEMA_COMPATIBLE=yes \
  bash /opt/openbmb/current/infra/production/scripts/rollback-release.sh \
  <previous-release-id>
```

这只切换 API/两个 Web 镜像和独立的 `current-app` 指针；基础设施与配置继续使用
`current` 指向的 stack release，不回滚数据库、不删除卷。systemd 重启后仍会读取
`current-app`，不会悄悄恢复成较新的应用，也不会降级 MySQL、Redis、MinIO 或 LiveKit。
回滚脚本同时要求不存在 pending，且目标 release 的 security epoch 不低于持久化 floor；
因此跨安全边界后的旧镜像即使 schema 仍兼容，也不能重新启动。同 epoch 回滚仍然允许。

### 立即撤销公网代理，恢复 CampusHub 直占 80

```bash
sudo bash /opt/openbmb/current/infra/production/scripts/rollback-public.sh \
  /home/ubuntu/CampusHub docker-compose.prod.yml .env.prod frontend
```

它停止 Caddy，仅用 CampusHub 原 Compose 强制重建前端并验证
`http://127.0.0.1/`。OpenBMB 容器和数据保留，可离线排查。不要运行任何项目的
`docker compose down -v`。

### 数据恢复

数据恢复不是普通发布回滚。只有确认数据损坏后，按 `RESTORE.md` 先恢复到新库/
新 bucket 验证；本目录有意不提供会直接清空正式库的一键命令。

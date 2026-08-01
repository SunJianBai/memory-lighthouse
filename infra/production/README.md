# TX4H4G 生产部署方案

此目录是可审阅的部署产物，**当前没有连接、修改或重启 TX4H4G**。目标主机为
Ubuntu 24.04（SSH 别名 `TX4H4G`，公网 IP `124.220.81.104`），并保证现有
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
5. 两台不同网络设备完成一次真实 LiveKit 音视频测试。HTTP/WSS 健康检查不能
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
sudo install -d -o root -g openbmb -m 0750 /etc/openbmb
sudo install -o root -g openbmb -m 0640 \
  infra/production/env/infra.env.example /etc/openbmb/infra.env
sudo install -o root -g openbmb -m 0640 \
  infra/production/env/api.env.example /etc/openbmb/api.env
```

编辑两个文件，替换全部 `CHANGE_ME`。基础设施 secret 使用彼此独立的 base64url
值：

```bash
openssl rand -base64 36 | tr '+/' '-_' | tr -d '=\n'; printf '\n'
```

`DATA_ENCRYPTION_KEY_BASE64` 必须是恰好 32 字节的标准 Base64：

```bash
openssl rand -base64 32 | tr -d '\n'; printf '\n'
```

不要把 secret 放入发布目录、Git、shell 历史或工单。Compose 只把运行所需的
数据库用户密码传给 API，不会把 MySQL/MinIO root 凭据传给 API。`api.env` 使用
Compose raw 格式读取，SMTP 密码中的 `$` 等字符不会被插值。

## 3. 发布应用（尚不切换公网）

把干净源码放到新发布目录，排除 `.git`、`node_modules`、`dist` 和所有 `.env`：

```bash
release_id="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD)"
sudo install -d -o "$USER" -g openbmb -m 0750 "/opt/openbmb/releases/$release_id"
rsync -a --delete \
  --exclude .git --exclude node_modules --exclude dist --exclude '.env*' \
  ./ "/opt/openbmb/releases/$release_id/"
sudo OPENBMB_INFRA_ENV_FILE=/etc/openbmb/infra.env \
  OPENBMB_API_ENV_FILE=/etc/openbmb/api.env \
  bash "/opt/openbmb/releases/$release_id/infra/production/scripts/deploy-release.sh"
```

发布脚本依次执行：严格预检 → 构建带 release tag 的镜像 → 对已有系统做 MySQL
和 MinIO 备份 → 保持 API 停机 → 启动/核对数据与 LiveKit →
`prisma migrate deploy` → 启动三个
应用容器 → 本机 liveness/readiness → 原子切换 `current` 符号链接。它不运行
`prisma migrate dev`，也不删除卷。

所有迁移应保持至少一个发布窗口的向后兼容。脚本失败会尝试恢复上一个应用镜像，
但不会猜测如何回滚 schema。

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

备份会短暂停止 API，使用事务快照导出 MySQL，并镜像 MinIO 的当前对象状态；
静态 Web 和 CampusHub 不停。结果为 0700/0600，包含个人敏感信息。必须加密复制
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

这只切换 API/两个 Web 镜像和 `current`，不回滚数据库、不删除卷。

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

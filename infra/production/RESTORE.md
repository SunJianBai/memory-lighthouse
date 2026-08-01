# 恢复说明（破坏性操作，默认只作为人工运行手册）

发布回滚与数据恢复是两件不同的事。Caddy 或应用镜像故障时，先使用
`rollback-public.sh` 或 `rollback-release.sh`；它们不会改动 MySQL/MinIO 数据。
只有确认数据损坏、误删或迁移与旧应用不兼容时，才恢复备份。

## 恢复前提

1. 只接受非 `.partial-*` 目录且存在 `.openbmb-backup-complete` 的备份。先确认完成标记
   的 64 位摘要与 `sha256sum SHA256SUMS` 一致，再将备份完整复制到另一台机器并执行
   `sha256sum -c SHA256SUMS`；缺少完成标记、摘要不匹配或清单校验失败都视为无效备份。

   ```bash
   openbmb_backup_dir=/var/backups/openbmb/<stamp>
   test -f "$openbmb_backup_dir/.openbmb-backup-complete"
   test "$(cat "$openbmb_backup_dir/.openbmb-backup-complete")" = \
     "$(sha256sum "$openbmb_backup_dir/SHA256SUMS" | awk '{ print $1 }')"
   (cd "$openbmb_backup_dir" && sha256sum --check SHA256SUMS)
   ```
2. 记录当前 `/opt/openbmb/current`、镜像 ID 和卷名，并再做一次现状备份。
3. 停止 API，避免恢复过程中产生新写入：

   ```bash
   sudo systemctl stop openbmb
   ```

4. 以单独 Compose project/新卷做演练；验证数据库行数、登录、资源下载后，
   才能考虑覆盖正式卷。

## MySQL 演练恢复

不要先删除正式数据库。创建隔离数据库容器或隔离数据库 `openbmb_restore_test`，
再导入：

```bash
gzip -t /var/backups/openbmb/<stamp>/mysql.sql.gz
gzip -dc /var/backups/openbmb/<stamp>/mysql.sql.gz \
  | docker exec -i <isolated-mysql-container> \
      sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot openbmb_restore_test'
```

导入正式库通常需要清空/替换当前 schema，属于不可逆动作，本仓库故意不提供
一键脚本。执行前必须再次确认备份时间、目标容器和停机窗口。

## MinIO 演练恢复

`backup.sh` 保存的是当时的当前对象状态，不是所有历史版本。把 `minio/` 镜像到
一个独立 bucket，不能直接覆盖正式 bucket：

```bash
docker run --rm --network openbmb_private \
  --env-file /etc/openbmb/infra.env \
  -v /var/backups/openbmb/<stamp>/minio:/backup:ro \
  --entrypoint /bin/sh minio/mc:RELEASE.2025-04-08T15-39-49Z -ceu '
    mc alias set target http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
    mc mb --ignore-existing target/openbmb-restore-test
    mc mirror /backup target/openbmb-restore-test
  '
```

检查对象数量、校验和与 API 下载流程后，再制定正式 bucket 的逐对象恢复方案。

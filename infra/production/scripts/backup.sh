#!/usr/bin/env bash
set -Eeuo pipefail
umask 0077

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
case "${OPENBMB_OPERATION_LOCK_HELD:-false}" in
  false)
    exec flock --exclusive --wait 1800 --conflict-exit-code 75 \
      /run/lock/openbmb-operation.lock \
      env OPENBMB_OPERATION_LOCK_HELD=true bash "$script_dir/backup.sh" "$@"
    ;;
  true) ;;
  *) printf 'OPENBMB_OPERATION_LOCK_HELD must be true or false\n' >&2; exit 1 ;;
esac
infra_env="${OPENBMB_INFRA_ENV_FILE:-/etc/openbmb/infra.env}"
backup_root="${OPENBMB_BACKUP_ROOT:-/var/backups/openbmb}"

case "$backup_root" in
  /var/backups/openbmb|/var/backups/openbmb/*) ;;
  *) printf 'OPENBMB_BACKUP_ROOT must stay under /var/backups/openbmb\n' >&2; exit 1 ;;
esac

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p -- "$backup_root"
chmod 0700 -- "$backup_root"
backup_dir="$(mktemp -d -- "$backup_root/${stamp}.XXXXXX")"
mkdir -p -- "$backup_dir/minio"
chmod 0700 -- "$backup_dir" "$backup_dir/minio"

api_was_running=false
if [[ "$(docker inspect --format '{{.State.Running}}' openbmb-api 2>/dev/null || true)" == true ]]; then
  api_was_running=true
  "$script_dir/compose.sh" stop --timeout 30 api
fi

restart_api() {
  if [[ "$api_was_running" == true && "${OPENBMB_BACKUP_LEAVE_API_STOPPED:-false}" != true ]]; then
    "$script_dir/compose.sh" start api >/dev/null || true
  fi
}
trap restart_api EXIT

printf 'Creating MySQL snapshot in %s\n' "$backup_dir"
"$script_dir/compose.sh" exec -T mysql sh -ceu '
  MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump \
    --user=root \
    --host=127.0.0.1 \
    --single-transaction \
    --routines \
    --events \
    --triggers \
    --hex-blob \
    --set-gtid-purged=OFF \
    "$MYSQL_DATABASE"
' | gzip -9 > "$backup_dir/mysql.sql.gz"
gzip -t "$backup_dir/mysql.sql.gz"

printf 'Creating current-object MinIO snapshot\n'
"$script_dir/compose.sh" run --rm --pull never --no-deps \
  --volume "$backup_dir/minio:/backup" \
  --entrypoint /bin/sh \
  minio-init -ceu '
    mc alias set source http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
    mc mirror --overwrite --preserve "source/$MINIO_BUCKET" /backup
  '

find "$backup_dir/minio" -type d -exec chmod 0700 {} +
find "$backup_dir/minio" -type f -exec chmod 0600 {} +
"$script_dir/compose.sh" images --format json > "$backup_dir/images.json"
"$script_dir/compose.sh" ps --format json > "$backup_dir/containers.json"
chmod 0600 "$backup_dir/mysql.sql.gz" "$backup_dir/images.json" "$backup_dir/containers.json"
(
  cd "$backup_dir"
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
)
chmod 0600 "$backup_dir/SHA256SUMS"

printf 'Backup completed: %s\n' "$backup_dir"
printf 'Copy it off-host and test restoration before treating it as recoverable.\n'

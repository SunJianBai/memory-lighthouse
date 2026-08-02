#!/usr/bin/env bash
set -Eeuo pipefail
umask 0077

case "${OPENBMB_OPERATION_LOCK_HELD:-false}" in
  false)
    current_link="${OPENBMB_CURRENT_LINK:-/opt/openbmb/current}"
    active_entry="$current_link/infra/production/scripts/backup.sh"
    exec flock --exclusive --wait 1800 --conflict-exit-code 75 \
      /run/lock/openbmb-operation.lock \
      env OPENBMB_OPERATION_LOCK_HELD=true bash "$active_entry" "$@"
    ;;
  true) ;;
  *) printf 'OPENBMB_OPERATION_LOCK_HELD must be true or false\n' >&2; exit 1 ;;
esac
script_path="$(readlink -f -- "${BASH_SOURCE[0]}")"
script_dir="$(CDPATH= cd -- "$(dirname -- "$script_path")" && pwd -P)"
security_epoch_script="$script_dir/security-epoch.sh"
backup_root="${OPENBMB_BACKUP_ROOT:-/var/backups/openbmb}"
backup_root="$(readlink -m -- "$backup_root")"

if bash "$security_epoch_script" pending-exists; then
  printf 'Refusing an ordinary backup while a security boundary is pending. Resume or repair that deployment first.\n' >&2
  exit 1
else
  pending_probe_status=$?
  [[ "$pending_probe_status" -eq 3 ]] || exit "$pending_probe_status"
fi

case "$backup_root" in
  /var/backups/openbmb|/var/backups/openbmb/*) ;;
  *) printf 'OPENBMB_BACKUP_ROOT must stay under /var/backups/openbmb\n' >&2; exit 1 ;;
esac

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
partial_dir=''
published_dir=''
published_by_run=false
backup_complete=false
api_restore_pending=false

remove_generated_directory() {
  local candidate="$1"
  local candidate_name
  [[ -n "$candidate" && "$(dirname -- "$candidate")" == "$backup_root" ]] || return 1
  candidate_name="$(basename -- "$candidate")"
  case "$candidate_name" in
    ".partial-$stamp."*|"$stamp."*) ;;
    *) return 1 ;;
  esac
  if [[ -e "$candidate" || -L "$candidate" ]]; then
    [[ -d "$candidate" && ! -L "$candidate" ]] || return 1
    rm -rf -- "$candidate"
  fi
}

cleanup_incomplete_backup() {
  local cleanup_status=0
  [[ "$backup_complete" == false ]] || return 0
  if [[ -n "$partial_dir" ]]; then
    remove_generated_directory "$partial_dir" || cleanup_status=1
  fi
  if [[ "$published_by_run" == true ]]; then
    remove_generated_directory "$published_dir" || cleanup_status=1
  fi
  return "$cleanup_status"
}

restore_api() {
  [[ "$api_restore_pending" == true ]] || return 0
  if [[ "${OPENBMB_BACKUP_LEAVE_API_STOPPED:-false}" == true ]]; then
    api_restore_pending=false
    return 0
  fi
  printf 'Restoring the API after backup.\n'
  if ! bash "$script_dir/verify-clamav.sh" --once; then
    return 1
  fi
  if ! "$script_dir/compose.sh" start api; then
    return 1
  fi
  if ! bash "$script_dir/health-check.sh" --local; then
    return 1
  fi
  api_restore_pending=false
}

finish_with_status() {
  local status="$1"
  trap - EXIT
  trap '' HUP INT TERM
  if ! restore_api; then
    printf 'Backup failed and the API did not recover to a healthy state.\n' >&2
    [[ "$status" -ne 0 ]] || status=1
  fi
  if ! cleanup_incomplete_backup; then
    printf 'Backup failed and its incomplete working directory could not be removed safely.\n' >&2
    [[ "$status" -ne 0 ]] || status=1
  fi
  exit "$status"
}
finish_on_exit() {
  local status=$?
  finish_with_status "$status"
}
finish_on_signal() {
  finish_with_status "$1"
}
trap finish_on_exit EXIT
trap 'finish_on_signal 129' HUP
trap 'finish_on_signal 130' INT
trap 'finish_on_signal 143' TERM

mkdir -p -- "$backup_root"
chmod 0700 -- "$backup_root"
partial_dir="$(mktemp -d -- "$backup_root/.partial-${stamp}.XXXXXX")"
suffix="${partial_dir##*.}"
[[ "$suffix" =~ ^[A-Za-z0-9]+$ ]] || {
  printf 'unexpected backup working-directory suffix\n' >&2
  exit 1
}
published_dir="$backup_root/${stamp}.${suffix}"
[[ ! -e "$published_dir" && ! -L "$published_dir" ]] || {
  printf 'backup publication target already exists\n' >&2
  exit 1
}
mkdir -p -- "$partial_dir/minio"
chmod 0700 -- "$partial_dir" "$partial_dir/minio"
bash "$security_epoch_script" minimum >"$partial_dir/minimum-security-epoch"
chmod 0600 -- "$partial_dir/minimum-security-epoch"

api_state="$(docker inspect --format '{{.State.Running}}' openbmb-api)"
[[ "$api_state" == true || "$api_state" == false ]] || {
  printf 'unexpected API container state: %s\n' "$api_state" >&2
  exit 1
}
if [[ "$api_state" == true ]]; then
  api_restore_pending=true
  "$script_dir/compose.sh" stop --timeout 30 api
  api_state="$(docker inspect --format '{{.State.Running}}' openbmb-api)"
  [[ "$api_state" == false ]] || {
    printf 'API remained running; refusing to create a live-write backup.\n' >&2
    exit 1
  }
fi

printf 'Creating MySQL snapshot in %s\n' "$partial_dir"
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
' | gzip -9 > "$partial_dir/mysql.sql.gz"
gzip -t "$partial_dir/mysql.sql.gz"

printf 'Creating current-object MinIO snapshot\n'
"$script_dir/compose.sh" run --rm --pull never --no-deps \
  --volume "$partial_dir/minio:/backup" \
  --entrypoint /bin/sh \
  minio-init -ceu '
    mc alias set source http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
    mc mirror --overwrite --preserve "source/$MINIO_BUCKET" /backup
  '

find "$partial_dir/minio" -type d -exec chmod 0700 {} +
find "$partial_dir/minio" -type f -exec chmod 0600 {} +
"$script_dir/compose.sh" images --format json > "$partial_dir/images.json"
"$script_dir/compose.sh" ps --format json > "$partial_dir/containers.json"
for required_file in mysql.sql.gz images.json containers.json minimum-security-epoch; do
  [[ -s "$partial_dir/$required_file" ]] || {
    printf 'required backup artifact is empty: %s\n' "$required_file" >&2
    exit 1
  }
done
chmod 0600 \
  "$partial_dir/mysql.sql.gz" \
  "$partial_dir/images.json" \
  "$partial_dir/containers.json" \
  "$partial_dir/minimum-security-epoch"
(
  cd "$partial_dir"
  find . -type f \
    ! -path ./SHA256SUMS \
    ! -path ./SHA256SUMS.tmp \
    ! -path ./.openbmb-backup-complete \
    ! -path ./.openbmb-backup-complete.tmp \
    -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS.tmp
  [[ -s SHA256SUMS.tmp ]]
  sha256sum --check SHA256SUMS.tmp
  mv -- SHA256SUMS.tmp SHA256SUMS
)
chmod 0600 "$partial_dir/SHA256SUMS"
sync -f "$partial_dir/SHA256SUMS"

mv -T -- "$partial_dir" "$published_dir"
published_by_run=true
partial_dir=''
manifest_digest="$(sha256sum "$published_dir/SHA256SUMS" | awk '{ print $1 }')"
[[ "$manifest_digest" =~ ^[0-9a-f]{64}$ ]]
completion_tmp="$published_dir/.openbmb-backup-complete.tmp"
printf '%s\n' "$manifest_digest" > "$completion_tmp"
chmod 0600 "$completion_tmp"
mv -- "$completion_tmp" "$published_dir/.openbmb-backup-complete"
sync -f "$published_dir/.openbmb-backup-complete"
sync -f "$backup_root"
backup_complete=true

if ! restore_api; then
  trap - EXIT HUP INT TERM
  printf 'Backup data is complete, but the API did not recover to a healthy state.\n' >&2
  exit 1
fi
trap - EXIT HUP INT TERM

printf 'Backup completed: %s\n' "$published_dir"
printf 'Copy it off-host and test restoration before treating it as recoverable.\n'

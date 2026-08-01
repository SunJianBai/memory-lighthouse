#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
case "${OPENBMB_OPERATION_LOCK_HELD:-false}" in
  false)
    exec flock --exclusive --wait 0 --conflict-exit-code 75 \
      /run/lock/openbmb-operation.lock \
      env OPENBMB_OPERATION_LOCK_HELD=true bash "$script_dir/deploy-release.sh" "$@"
    ;;
  true) ;;
  *) printf 'OPENBMB_OPERATION_LOCK_HELD must be true or false\n' >&2; exit 1 ;;
esac
production_dir="$(CDPATH= cd -- "$script_dir/.." && pwd -P)"
release_root="$(CDPATH= cd -- "$production_dir/../.." && pwd -P)"
release_id="$(basename -- "$release_root")"
releases_root="${OPENBMB_RELEASES_ROOT:-/opt/openbmb/releases}"
current_link="${OPENBMB_CURRENT_LINK:-/opt/openbmb/current}"

case "$release_root" in
  "$releases_root"/*) ;;
  *) printf 'release must be staged directly below %s\n' "$releases_root" >&2; exit 1 ;;
esac
[[ "$release_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || {
  printf 'unsafe release directory name: %s\n' "$release_id" >&2
  exit 1
}

export OPENBMB_RELEASE="$release_id"

old_release=''
if [[ -L "$current_link" ]]; then
  old_release="$(readlink -f -- "$current_link")"
fi

deployment_complete=false
rollback_on_exit() {
  status=$?
  trap - EXIT
  if [[ "$deployment_complete" == true ]]; then
    return
  fi
  printf 'Deployment failed; attempting application-image rollback.\n' >&2
  if [[ -n "$old_release" && -f "$old_release/infra/production/scripts/compose.sh" ]]; then
    old_id="$(basename -- "$old_release")"
    OPENBMB_RELEASE="$old_id" \
      bash "$old_release/infra/production/scripts/compose.sh" \
      up -d --pull never --no-build api client-web admin-web || true
  else
    bash "$script_dir/compose.sh" stop api client-web admin-web || true
  fi
  exit "$status"
}
trap rollback_on_exit EXIT

bash "$script_dir/preflight.sh"

skip_image_build="${OPENBMB_SKIP_IMAGE_BUILD:-false}"
case "$skip_image_build" in
  true)
    printf 'Using preloaded immutable release images: %s\n' "$release_id"
    bash "$script_dir/verify-release-images.sh"
    ;;
  false)
    printf 'Building immutable release images: %s\n' "$release_id"
    # Keep BuildKit from compiling multiple TypeScript applications
    # concurrently on the 3.6 GiB host. Later targets reuse the cache from
    # earlier ones.
    bash "$script_dir/compose.sh" build api
    bash "$script_dir/compose.sh" --profile tools build migrate
    bash "$script_dir/compose.sh" build client-web
    bash "$script_dir/compose.sh" build admin-web
    ;;
  *)
    printf 'OPENBMB_SKIP_IMAGE_BUILD must be true or false\n' >&2
    exit 1
    ;;
esac
post_build_disk_kib="$(df -Pk /opt | awk 'NR == 2 { print $4 }')"
[[ "${post_build_disk_kib:-0}" -ge 3145728 ]] || {
  printf 'less than 3 GiB remains after image build; aborting before data changes\n' >&2
  exit 1
}

if [[ -n "$old_release" && "$old_release" != "$release_root" ]]; then
  printf 'Taking a pre-migration backup with the current release.\n'
  old_id="$(basename -- "$old_release")"
  OPENBMB_RELEASE="$old_id" OPENBMB_BACKUP_LEAVE_API_STOPPED=true \
    bash "$old_release/infra/production/scripts/backup.sh"
fi

printf 'Keeping the API stopped across infrastructure reconciliation and schema migration.\n'
bash "$script_dir/compose.sh" stop --timeout 30 api || true

printf 'Starting or reconciling data and media services.\n'
bash "$script_dir/compose.sh" up -d \
  --pull never \
  mysql redis redis-livekit minio livekit
bash "$script_dir/compose.sh" up -d --pull never --force-recreate minio-init

for service in mysql redis redis-livekit minio livekit; do
  for _attempt in $(seq 1 30); do
    health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "openbmb-$service" 2>/dev/null || true)"
    [[ "$health" == healthy ]] && break
    sleep 2
  done
  [[ "$health" == healthy ]] || {
    printf 'service did not become healthy: %s (%s)\n' "$service" "$health" >&2
    exit 1
  }
done

init_status=''
init_exit='1'
for _attempt in $(seq 1 30); do
  init_status="$(docker inspect --format '{{.State.Status}}' openbmb-minio-init 2>/dev/null || true)"
  init_exit="$(docker inspect --format '{{.State.ExitCode}}' openbmb-minio-init 2>/dev/null || printf 1)"
  [[ "$init_status" == exited ]] && break
  sleep 2
done
[[ "$init_status" == exited && "$init_exit" == 0 ]] || {
  printf 'MinIO initialization failed or timed out (status=%s exit=%s)\n' "$init_status" "$init_exit" >&2
  exit 1
}

printf 'Applying committed Prisma migrations.\n'
bash "$script_dir/compose.sh" --profile tools run --rm --pull never migrate

printf 'Starting release application containers.\n'
bash "$script_dir/compose.sh" up -d --pull never --no-build api client-web admin-web
bash "$script_dir/health-check.sh" --local

mkdir -p -- "$(dirname -- "$current_link")"
temporary_link="${current_link}.new"
ln -sfn -- "$release_root" "$temporary_link"
mv -Tf -- "$temporary_link" "$current_link"

deployment_complete=true
trap - EXIT
printf 'Release %s is healthy and is now current.\n' "$release_id"
printf 'Public traffic is unchanged until Caddy is installed/reloaded.\n'

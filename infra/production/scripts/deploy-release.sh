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
application_link="${OPENBMB_APPLICATION_LINK:-/opt/openbmb/current-app}"
security_epoch_script="$script_dir/security-epoch.sh"

case "$release_root" in
  "$releases_root"/*) ;;
  *) printf 'release must be staged directly below %s\n' "$releases_root" >&2; exit 1 ;;
esac
[[ "$release_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || {
  printf 'unsafe release directory name: %s\n' "$release_id" >&2
  exit 1
}
[[ "$(dirname -- "$application_link")" == "$(dirname -- "$current_link")" ]] || {
  printf 'application and stack links must share one state directory\n' >&2
  exit 1
}
if [[ -e "$current_link" || -L "$current_link" ]]; then
  [[ -L "$current_link" ]] || {
    printf 'current stack path must be a symbolic link\n' >&2
    exit 1
  }
fi
if [[ -e "$application_link" || -L "$application_link" ]]; then
  [[ -L "$application_link" ]] || {
    printf 'current application path must be a symbolic link\n' >&2
    exit 1
  }
fi

export OPENBMB_RELEASE="$release_id"
export OPENBMB_APPLICATION_RELEASE="$release_id"
export OPENBMB_INFRASTRUCTURE_RELEASE="$release_id"

old_release=''
if [[ -L "$current_link" ]]; then
  old_release="$(readlink -f -- "$current_link")"
  case "$old_release" in
    "$releases_root"/*) ;;
    *) printf 'current stack release escaped the release root\n' >&2; exit 1 ;;
  esac
  [[ "$(dirname -- "$old_release")" == "$releases_root" ]] || {
    printf 'current stack release must be directly below the release root\n' >&2
    exit 1
  }
fi
old_application_release=''
old_application_target=''
if [[ -L "$application_link" ]]; then
  old_application_target="$(readlink -f -- "$application_link")"
  case "$old_application_target" in
    "$releases_root"/*) ;;
    *) printf 'current application release escaped the release root\n' >&2; exit 1 ;;
  esac
  [[ "$(dirname -- "$old_application_target")" == "$releases_root" ]] || {
    printf 'current application release must be directly below the release root\n' >&2
    exit 1
  }
  old_application_release="$(basename -- "$old_application_target")"
elif [[ -n "$old_release" ]]; then
  old_release_epoch="$(bash "$security_epoch_script" release-epoch "$old_release")"
  if [[ "$old_release_epoch" == 0 ]]; then
    # Before the split stack/application pointer protocol, current was the only
    # application pointer. Epoch-aware releases must never be guessed active:
    # a missing current-app can instead mean their activation was interrupted.
    old_application_target="$old_release"
    old_application_release="$(basename -- "$old_release")"
  else
    printf 'No current-app pointer exists; refusing to infer an epoch-aware stack release as the active application.\n' >&2
  fi
fi

deployment_complete=false
deployment_mutated=false
deployment_resumed=false
irreversible_boundary_started=false
if bash "$security_epoch_script" pending-exists; then
  # A resumed pending boundary may already have rotated credentials or changed
  # schema. Without a durable phase proof, recovery must assume it did.
  deployment_resumed=true
  irreversible_boundary_started=true
else
  pending_probe_status=$?
  [[ "$pending_probe_status" -eq 3 ]] || exit "$pending_probe_status"
fi
wait_for_recovery_livekit() {
  local recovery_livekit_health=''
  local _attempt

  for _attempt in $(seq 1 30); do
    recovery_livekit_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' openbmb-livekit 2>/dev/null || true)"
    [[ "$recovery_livekit_health" == healthy ]] && return 0
    sleep 2
  done
  printf 'Recovery LiveKit did not become healthy (%s).\n' "$recovery_livekit_health" >&2
  return 1
}

rollback_with_status() {
  local status="$1"
  trap - EXIT
  trap '' HUP INT TERM
  if [[ "$deployment_complete" == true || "$deployment_mutated" == false ]]; then
    exit "$status"
  fi

  recovery_stack=''
  active_stack="$(readlink -f -- "$current_link" 2>/dev/null || true)"
  if [[ "$active_stack" == "$release_root" ]]; then
    recovery_stack="$release_root"
  elif [[ -n "$old_release" ]]; then
    recovery_stack="$old_release"
  fi

  printf 'Deployment failed; preserving the activated stack and restoring the drained LiveKit service.\n' >&2
  if [[ -z "$recovery_stack" || \
        ! -f "$recovery_stack/infra/production/scripts/compose.sh" ]]; then
    bash "$script_dir/compose.sh" stop api client-web admin-web || true
    exit "$status"
  fi

  recovery_id="$(basename -- "$recovery_stack")"
  recovery_application_release="$release_id"
  old_application_is_safe=false
  if [[ "$irreversible_boundary_started" == false && -n "$old_application_target" ]] && \
     bash "$security_epoch_script" can-recover "$old_application_target" >/dev/null 2>&1; then
    old_application_is_safe=true
    recovery_application_release="$old_application_release"
  fi

  OPENBMB_RELEASE="$recovery_id" \
    OPENBMB_APPLICATION_RELEASE="$recovery_application_release" \
    OPENBMB_INFRASTRUCTURE_RELEASE="$recovery_id" \
    bash "$recovery_stack/infra/production/scripts/compose.sh" \
    stop --timeout 30 api client-web admin-web || true

  realtime_recovered=false
  if OPENBMB_RELEASE="$recovery_id" \
       OPENBMB_APPLICATION_RELEASE="$recovery_application_release" \
       OPENBMB_INFRASTRUCTURE_RELEASE="$recovery_id" \
       bash "$recovery_stack/infra/production/scripts/compose.sh" \
       up -d --pull never --no-build mysql redis redis-livekit minio livekit && \
     wait_for_recovery_livekit; then
    realtime_recovered=true
    printf 'Recovery LiveKit is healthy with the current, non-restored signing secret.\n' >&2
  fi

  application_recovered=false
  if [[ "$old_application_is_safe" == true && "$realtime_recovered" == true ]]; then
    ln -sfn -- "$old_application_target" "${application_link}.restore"
    mv -Tf -- "${application_link}.restore" "$application_link"
    if OPENBMB_RELEASE="$recovery_id" \
         OPENBMB_APPLICATION_RELEASE="$old_application_release" \
         OPENBMB_INFRASTRUCTURE_RELEASE="$recovery_id" \
         bash "$recovery_stack/infra/production/scripts/compose.sh" \
         up -d --pull never --no-build --no-deps api client-web admin-web && \
       OPENBMB_RELEASE="$recovery_id" \
         OPENBMB_APPLICATION_RELEASE="$old_application_release" \
         OPENBMB_INFRASTRUCTURE_RELEASE="$recovery_id" \
         bash "$recovery_stack/infra/production/scripts/health-check.sh" --local && \
       bash "$security_epoch_script" complete-recovery "$old_application_target"; then
      application_recovered=true
      printf 'The previous same-epoch application is healthy; pending deployment state was cleared.\n' >&2
    fi
  fi

  if [[ "$application_recovered" != true ]]; then
    OPENBMB_RELEASE="$recovery_id" \
      OPENBMB_APPLICATION_RELEASE="$recovery_application_release" \
      OPENBMB_INFRASTRUCTURE_RELEASE="$recovery_id" \
      bash "$recovery_stack/infra/production/scripts/compose.sh" \
      stop --timeout 30 api client-web admin-web || true
    printf 'Application recovery is blocked; the durable pending boundary remains fail-closed.\n' >&2
  fi
  exit "$status"
}
rollback_on_exit() {
  local status=$?
  rollback_with_status "$status"
}
rollback_on_signal() {
  rollback_with_status "$1"
}
trap rollback_on_exit EXIT
trap 'rollback_on_signal 129' HUP
trap 'rollback_on_signal 130' INT
trap 'rollback_on_signal 143' TERM

bash "$script_dir/preflight.sh"
bash "$security_epoch_script" assert-deploy "$release_root"

skip_image_build="${OPENBMB_SKIP_IMAGE_BUILD:-false}"
case "$skip_image_build" in
  true)
    printf 'Using preloaded immutable release images: %s\n' "$release_id"
    bash "$script_dir/verify-release-images.sh"
    ;;
  false)
    printf 'Host-local production builds are disabled; preload and verify the digest-pinned release images first.\n' >&2
    exit 1
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

if [[ -n "$old_application_target" && ! -L "$application_link" ]]; then
  deployment_mutated=true
  mkdir -p -- "$(dirname -- "$application_link")"
  ln -s -- "$old_application_target" "$application_link"
fi

if [[ "$deployment_resumed" == true && -n "$old_release" && "$old_release" != "$release_root" ]]; then
  printf 'Skipping the ordinary backup because this deployment is resuming a pending security boundary.\n'
elif [[ -n "$old_release" && "$old_release" != "$release_root" ]]; then
  deployment_mutated=true
  printf 'Taking a pre-migration backup with the current release.\n'
  old_id="$(basename -- "$old_release")"
  OPENBMB_RELEASE="$old_id" \
    OPENBMB_APPLICATION_RELEASE="$old_application_release" \
    OPENBMB_INFRASTRUCTURE_RELEASE="$old_id" \
    OPENBMB_BACKUP_LEAVE_API_STOPPED=true \
    bash "$old_release/infra/production/scripts/backup.sh"
fi

deployment_mutated=true
mkdir -p -- "$(dirname -- "$current_link")"
temporary_link="${current_link}.new"
ln -sfn -- "$release_root" "$temporary_link"
mv -Tf -- "$temporary_link" "$current_link"
printf 'Stack release %s is now durable before infrastructure reconciliation.\n' "$release_id"

printf 'Keeping the API and LiveKit stopped across reconciliation and schema migration.\n'
bash "$script_dir/compose.sh" stop --timeout 30 api livekit
api_container_ids="$(
  docker container ls --all --format '{{.ID}} {{.Names}}' |
    awk '$2 == "openbmb-api" { print $1 }'
)"
if [[ -n "$api_container_ids" ]]; then
  [[ "$api_container_ids" != *$'\n'* ]] || {
    printf 'multiple containers unexpectedly use the openbmb-api name\n' >&2
    exit 1
  }
  api_running="$(docker inspect --format '{{.State.Running}}' "$api_container_ids")"
  [[ "$api_running" == false ]] || {
    printf 'API remained running; refusing infrastructure reconciliation and migration.\n' >&2
    exit 1
  }
fi
livekit_container_ids="$(
  docker container ls --all --format '{{.ID}} {{.Names}}' |
    awk '$2 == "openbmb-livekit" { print $1 }'
)"
if [[ -n "$livekit_container_ids" ]]; then
  [[ "$livekit_container_ids" != *$'\n'* ]] || {
    printf 'multiple containers unexpectedly use the openbmb-livekit name\n' >&2
    exit 1
  }
  livekit_running="$(docker inspect --format '{{.State.Running}}' "$livekit_container_ids")"
  [[ "$livekit_running" == false ]] || {
    printf 'LiveKit remained running; refusing media drain and migration.\n' >&2
    exit 1
  }
fi

printf 'Persisting the security boundary before realtime state or schema changes.\n'
bash "$security_epoch_script" begin "$release_root"
irreversible_boundary_started=true # Credential rotation starts after this fail-closed boundary.
printf 'Rotating the LiveKit signing secret while both token issuers and verifiers are stopped.\n'
bash "$script_dir/rotate-livekit-secret.sh"

printf 'Starting or reconciling data services while realtime media remains drained.\n'
bash "$script_dir/compose.sh" up -d \
  --pull never \
  mysql redis redis-livekit minio
bash "$script_dir/compose.sh" up -d --pull never --force-recreate minio-init

for service in mysql redis redis-livekit minio; do
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

printf 'Draining application media leases and LiveKit realtime state.\n'
bash "$script_dir/drain-realtime.sh"

printf 'Applying committed Prisma migrations.\n'
bash "$script_dir/compose.sh" --profile tools run --rm --pull never migrate

printf 'Starting the drained LiveKit service after schema migration.\n'
bash "$script_dir/compose.sh" up -d --pull never livekit
for _attempt in $(seq 1 30); do
  livekit_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' openbmb-livekit 2>/dev/null || true)"
  [[ "$livekit_health" == healthy ]] && break
  sleep 2
done
[[ "$livekit_health" == healthy ]] || {
  printf 'service did not become healthy: livekit (%s)\n' "$livekit_health" >&2
  exit 1
}

printf 'Starting release application containers.\n'
bash "$script_dir/compose.sh" up -d --pull never --no-build api client-web admin-web
bash "$script_dir/health-check.sh" --local

application_temporary_link="${application_link}.new"
ln -sfn -- "$release_root" "$application_temporary_link"
mv -Tf -- "$application_temporary_link" "$application_link"
bash "$security_epoch_script" finish "$release_root"

deployment_complete=true
trap - EXIT HUP INT TERM
printf 'Release %s is healthy and is now current.\n' "$release_id"
printf 'Public traffic is unchanged until Caddy is installed/reloaded.\n'

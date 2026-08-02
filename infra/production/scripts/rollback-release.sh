#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
case "${OPENBMB_OPERATION_LOCK_HELD:-false}" in
  false)
    exec flock --exclusive --wait 0 --conflict-exit-code 75 \
      /run/lock/openbmb-operation.lock \
      env OPENBMB_OPERATION_LOCK_HELD=true bash "$script_dir/rollback-release.sh" "$@"
    ;;
  true) ;;
  *) printf 'OPENBMB_OPERATION_LOCK_HELD must be true or false\n' >&2; exit 1 ;;
esac

if [[ $# -ne 1 ]]; then
  printf 'usage: %s <release-id>\n' "${BASH_SOURCE[0]}" >&2
  exit 2
fi
if [[ "${ROLLBACK_SCHEMA_COMPATIBLE:-}" != yes ]]; then
  printf 'Set ROLLBACK_SCHEMA_COMPATIBLE=yes only after confirming the target app is compatible with the current schema.\n' >&2
  exit 1
fi

release_id="$1"
[[ "$release_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || {
  printf 'unsafe release id\n' >&2
  exit 1
}

releases_root="${OPENBMB_RELEASES_ROOT:-/opt/openbmb/releases}"
current_link="${OPENBMB_CURRENT_LINK:-/opt/openbmb/current}"
application_link="${OPENBMB_APPLICATION_LINK:-/opt/openbmb/current-app}"
security_epoch_script="$script_dir/security-epoch.sh"
[[ -L "$current_link" ]] || {
  printf 'current stack release link is missing\n' >&2
  exit 1
}
[[ "$(dirname -- "$application_link")" == "$(dirname -- "$current_link")" ]] || {
  printf 'application and stack links must share one state directory\n' >&2
  exit 1
}
current_stack="$(readlink -f -- "$current_link")"
case "$current_stack" in
  "$releases_root"/*) ;;
  *) printf 'current stack release escaped the release root\n' >&2; exit 1 ;;
esac
[[ "$(dirname -- "$current_stack")" == "$releases_root" ]] || {
  printf 'current stack release must be directly below the release root\n' >&2
  exit 1
}
stack_release_id="$(basename -- "$current_stack")"
if [[ -L "$application_link" ]]; then
  old_application_target="$(readlink -f -- "$application_link")"
else
  current_stack_epoch="$(bash "$security_epoch_script" release-epoch "$current_stack")"
  [[ "$current_stack_epoch" == 0 ]] || {
    printf 'current application release link is missing; refusing to infer an epoch-aware stack as active\n' >&2
    exit 1
  }
  old_application_target="$current_stack"
fi
case "$old_application_target" in
  "$releases_root"/*) ;;
  *) printf 'current application release escaped the release root\n' >&2; exit 1 ;;
esac
[[ "$(dirname -- "$old_application_target")" == "$releases_root" ]] || {
  printf 'current application release must be directly below the release root\n' >&2
  exit 1
}
old_application_release="$(basename -- "$old_application_target")"

target_path="$releases_root/$release_id"
[[ -d "$target_path" && ! -L "$target_path" ]] || {
  printf 'rollback target must be a real release directory\n' >&2
  exit 1
}
target="$(readlink -f -- "$target_path")"
case "$target" in
  "$releases_root"/*) ;;
  *) printf 'rollback target escaped the release root\n' >&2; exit 1 ;;
esac
[[ "$(dirname -- "$target")" == "$releases_root" ]] || {
  printf 'rollback target must be directly below the release root\n' >&2
  exit 1
}
[[ "$(basename -- "$target")" == "$release_id" ]] || {
  printf 'rollback target directory differs from the requested release\n' >&2
  exit 1
}
[[ -f "$target/infra/production/scripts/compose.sh" ]] || {
  printf 'target is not a complete release: %s\n' "$target" >&2
  exit 1
}

bash "$security_epoch_script" assert-rollback "$target"
bash "$security_epoch_script" assert-start "$old_application_target"

OPENBMB_OPERATION_LOCK_HELD=true \
  bash "$target/infra/production/scripts/verify-release-images.sh"

rollback_complete=false
application_link_mutation_started=false
restore_with_status() {
  local status="$1"
  local application_state_directory
  local restore_temporary_link
  local application_pointer_safe=true

  application_state_directory="$(dirname -- "$application_link")"
  trap - EXIT
  trap '' HUP INT TERM
  if [[ "$rollback_complete" == true ]]; then
    exit "$status"
  fi
  if [[ "$application_link_mutation_started" == true ]]; then
    application_pointer_safe=false
    restore_temporary_link="${application_link}.restore"
    if ln -sfn -- "$old_application_target" "$restore_temporary_link" &&
       mv -Tf -- "$restore_temporary_link" "$application_link" &&
       sync -f -- "$application_state_directory"; then
      application_pointer_safe=true
      printf 'Restored the previous durable application pointer after rollback publication failed.\n' >&2
    else
      rm -f -- "$restore_temporary_link" || true
      printf 'Could not durably restore the previous application pointer; keep the service stopped until the state directory is repaired.\n' >&2
    fi
  fi
  if [[ "$application_pointer_safe" == true ]]; then
    printf 'Application rollback failed; restoring the previous application images.\n' >&2
    if bash "$current_stack/infra/production/scripts/verify-clamav.sh" --once; then
      OPENBMB_RELEASE="$stack_release_id" \
        OPENBMB_INFRASTRUCTURE_RELEASE="$stack_release_id" \
        OPENBMB_APPLICATION_RELEASE="$old_application_release" \
        bash "$current_stack/infra/production/scripts/compose.sh" \
          up -d --pull never --no-build --no-deps api client-web admin-web || true
    else
      printf 'ClamAV is unavailable; refusing to restore application containers.\n' >&2
      OPENBMB_RELEASE="$stack_release_id" \
        OPENBMB_INFRASTRUCTURE_RELEASE="$stack_release_id" \
        OPENBMB_APPLICATION_RELEASE="$old_application_release" \
        bash "$current_stack/infra/production/scripts/compose.sh" \
          stop --timeout 30 api client-web admin-web || true
    fi
  else
    OPENBMB_RELEASE="$stack_release_id" \
      OPENBMB_INFRASTRUCTURE_RELEASE="$stack_release_id" \
      OPENBMB_APPLICATION_RELEASE="$old_application_release" \
      bash "$current_stack/infra/production/scripts/compose.sh" \
        stop --timeout 30 api client-web admin-web || true
  fi
  exit "$status"
}
restore_on_exit() {
  local status=$?
  restore_with_status "$status"
}
restore_on_signal() {
  restore_with_status "$1"
}
trap restore_on_exit EXIT
trap 'restore_on_signal 129' HUP
trap 'restore_on_signal 130' INT
trap 'restore_on_signal 143' TERM

bash "$current_stack/infra/production/scripts/clamav-watchdog.sh"
OPENBMB_RELEASE="$stack_release_id" \
  OPENBMB_INFRASTRUCTURE_RELEASE="$stack_release_id" \
  OPENBMB_APPLICATION_RELEASE="$release_id" \
  bash "$current_stack/infra/production/scripts/compose.sh" \
  up -d --pull never --no-build --no-deps api client-web admin-web
OPENBMB_RELEASE="$stack_release_id" \
  OPENBMB_INFRASTRUCTURE_RELEASE="$stack_release_id" \
  OPENBMB_APPLICATION_RELEASE="$release_id" \
  bash "$current_stack/infra/production/scripts/health-check.sh" --local

temporary_link="${application_link}.new"
ln -sfn -- "$target" "$temporary_link"
application_link_mutation_started=true
mv -Tf -- "$temporary_link" "$application_link"
sync -f -- "$(dirname -- "$application_link")"
rollback_complete=true
trap - EXIT HUP INT TERM
printf 'Application containers rolled back to %s; stack release remains %s and data volumes were not changed.\n' \
  "$release_id" "$stack_release_id"

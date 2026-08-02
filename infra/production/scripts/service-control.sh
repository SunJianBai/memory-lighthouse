#!/usr/bin/env bash
set -Eeuo pipefail

case "${OPENBMB_OPERATION_LOCK_HELD:-false}" in
  false)
    current_link="${OPENBMB_CURRENT_LINK:-/opt/openbmb/current}"
    active_entry="$current_link/infra/production/scripts/service-control.sh"
    exec flock --exclusive --wait 0 --conflict-exit-code 75 \
      /run/lock/openbmb-operation.lock \
      env OPENBMB_OPERATION_LOCK_HELD=true bash "$active_entry" "$@"
    ;;
  true) ;;
  *) printf 'OPENBMB_OPERATION_LOCK_HELD must be true or false\n' >&2; exit 1 ;;
esac

script_path="$(readlink -f -- "${BASH_SOURCE[0]}")"
script_dir="$(CDPATH= cd -- "$(dirname -- "$script_path")" && pwd -P)"
current_link="${OPENBMB_CURRENT_LINK:-/opt/openbmb/current}"
application_link="${OPENBMB_APPLICATION_LINK:-/opt/openbmb/current-app}"
releases_root="${OPENBMB_RELEASES_ROOT:-/opt/openbmb/releases}"
security_epoch_script="$script_dir/security-epoch.sh"

if [[ $# -ne 1 ]]; then
  printf 'usage: %s <start|reload|stop>\n' "${BASH_SOURCE[0]}" >&2
  exit 2
fi

assert_application_start_allowed() {
  local application_target

  [[ -L "$application_link" ]] || {
    printf 'current application release link is missing\n' >&2
    return 1
  }
  application_target="$(readlink -f -- "$application_link")"
  case "$application_target" in
    "$releases_root"/*) ;;
    *) printf 'current application release escaped the release root\n' >&2; return 1 ;;
  esac
  [[ "$(dirname -- "$application_target")" == "$releases_root" ]] || {
    printf 'current application release must be directly below the release root\n' >&2
    return 1
  }
  bash "$security_epoch_script" assert-start "$application_target"
}

case "$1" in
  start)
    assert_application_start_allowed
    bash "$script_dir/compose.sh" up -d --pull never --no-build \
      mysql redis redis-livekit minio livekit minio-init \
      api client-web admin-web
    bash "$script_dir/health-check.sh" --local
    ;;
  reload)
    assert_application_start_allowed
    bash "$script_dir/compose.sh" up -d --pull never --no-build --no-deps \
      api client-web admin-web
    bash "$script_dir/health-check.sh" --local
    ;;
  stop)
    bash "$script_dir/compose.sh" stop --timeout 30 \
      api client-web admin-web livekit
    ;;
  *)
    printf 'usage: %s <start|reload|stop>\n' "${BASH_SOURCE[0]}" >&2
    exit 2
    ;;
esac

#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
case "${OPENBMB_OPERATION_LOCK_HELD:-false}" in
  false)
    exec flock --exclusive --wait 0 --conflict-exit-code 75 \
      /run/lock/openbmb-operation.lock \
      env OPENBMB_OPERATION_LOCK_HELD=true bash "$script_dir/rollback-public.sh" "$@"
    ;;
  true) ;;
  *) printf 'OPENBMB_OPERATION_LOCK_HELD must be true or false\n' >&2; exit 1 ;;
esac

if [[ $# -ne 4 ]]; then
  printf 'usage: %s <CampusHub-dir> <base-compose.yml> <env-file> <frontend-service>\n' "${BASH_SOURCE[0]}" >&2
  exit 2
fi

campus_dir="$(readlink -f -- "$1")"
base_compose="$2"
campus_env="$3"
frontend_service="$4"
[[ -f "$campus_dir/$base_compose" ]] || { printf 'base Compose file not found\n' >&2; exit 1; }
[[ -f "$campus_dir/$campus_env" ]] || { printf 'CampusHub environment file not found\n' >&2; exit 1; }

systemctl disable --now caddy
cd "$campus_dir"
docker compose --env-file "$campus_env" -f "$base_compose" \
  up -d --pull never --no-build --no-deps --force-recreate "$frontend_service"
curl --fail --silent --show-error http://127.0.0.1/ --output /dev/null
printf 'CampusHub is again serving port 80 directly. OpenBMB volumes were preserved.\n'

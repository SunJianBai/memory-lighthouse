#!/usr/bin/env bash
set -Eeuo pipefail

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
  up -d --no-deps --force-recreate "$frontend_service"
curl --fail --silent --show-error http://127.0.0.1/ --output /dev/null
printf 'CampusHub is again serving port 80 directly. OpenBMB volumes were preserved.\n'

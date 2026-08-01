#!/usr/bin/env bash
set -Eeuo pipefail
umask 0077

if [[ $# -ne 5 ]]; then
  printf 'usage: %s <CampusHub-dir> <base-compose.yml> <env-file> <override.yml> <frontend-service>\n' "${BASH_SOURCE[0]}" >&2
  exit 2
fi

campus_dir="$(readlink -f -- "$1")"
base_compose="$2"
campus_env="$3"
override_compose="$4"
frontend_service="$5"
state_root="/var/lib/openbmb/cutover"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
state_dir="$state_root/$stamp"
script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
caddy_env="/etc/caddy/openbmb.env"

caddy_value() {
  local key="$1"
  awk -F= -v wanted="$key" '$1 == wanted { sub(/^[^=]*=/, ""); print; exit }' "$caddy_env"
}

assert_existing_loopback_service() {
  local port="$1"
  if ! ss -H -ltn | awk '{print $4}' | grep -Eq "^(127\\.0\\.0\\.1|\\[::1\\]):${port}$"; then
    printf 'required existing loopback service is missing on port %s\n' "$port" >&2
    return 1
  fi
}

[[ -d "$campus_dir" ]] || { printf 'CampusHub directory not found\n' >&2; exit 1; }
[[ -f "$campus_dir/$base_compose" ]] || { printf 'base Compose file not found\n' >&2; exit 1; }
[[ -f "$campus_dir/$campus_env" ]] || { printf 'CampusHub environment file not found\n' >&2; exit 1; }
[[ -f "$campus_dir/$override_compose" ]] || { printf 'override Compose file not found\n' >&2; exit 1; }
command -v ss >/dev/null 2>&1 || { printf 'ss command is required\n' >&2; exit 1; }
[[ -f "$caddy_env" ]] || { printf 'Caddy environment file not found\n' >&2; exit 1; }
if find "$caddy_env" -maxdepth 0 -perm /0037 -print -quit | grep -q .; then
  printf 'Caddy environment file must be 0640 or stricter\n' >&2
  exit 1
fi
grep -Eq 'CHANGE_ME|REPLACE_WITH' "$caddy_env" && {
  printf 'Caddy environment file still contains placeholders\n' >&2
  exit 1
}
[[ "$(caddy_value OPENBMB_DOMAIN)" == sun227454.online ]] || {
  printf 'Caddy OPENBMB_DOMAIN must be sun227454.online\n' >&2
  exit 1
}
[[ "$(caddy_value CAMPUSHUB_UPSTREAM)" == 127.0.0.1:18080 ]] || {
  printf 'Caddy CampusHub upstream must stay on 127.0.0.1:18080\n' >&2
  exit 1
}
[[ "$(caddy_value LIVEKIT_SIGNAL_UPSTREAM)" == 127.0.0.1:17880 ]] || {
  printf 'Caddy LiveKit upstream must stay on 127.0.0.1:17880\n' >&2
  exit 1
}
[[ "$(caddy_value MINIO_S3_UPSTREAM)" == 127.0.0.1:19000 ]] || {
  printf 'Caddy MinIO upstream must stay on 127.0.0.1:19000\n' >&2
  exit 1
}

mkdir -p -- "$state_dir"
chmod 0700 -- "$state_root" "$state_dir"

cd "$campus_dir"
campus_compose=(docker compose --env-file "$campus_env" -f "$base_compose")
"${campus_compose[@]}" config --services | grep -Fxq "$frontend_service" || {
  printf 'CampusHub frontend service does not exist: %s\n' "$frontend_service" >&2
  exit 1
}
initial_frontend_binding="$("${campus_compose[@]}" port "$frontend_service" 80)"
grep -Fxq '0.0.0.0:80' <<<"$initial_frontend_binding" || {
  printf 'CampusHub frontend is not the expected current owner of 0.0.0.0:80: %s\n' "$initial_frontend_binding" >&2
  exit 1
}
assert_existing_loopback_service 8080
assert_existing_loopback_service 33306
"${campus_compose[@]}" config > "$state_dir/campus.before.yml"
"${campus_compose[@]}" ps --format json > "$state_dir/campus.before.containers.json"
chmod 0600 "$state_dir"/*

sudo -u caddy caddy validate \
  --config /etc/caddy/Caddyfile \
  --adapter caddyfile \
  --envfile "$caddy_env"

rollback_public() {
  status=$?
  if [[ $status -eq 0 ]]; then
    return
  fi
  printf 'Cutover failed; restoring CampusHub directly on port 80.\n' >&2
  systemctl stop caddy || true
  cd "$campus_dir"
  "${campus_compose[@]}" up -d --no-deps --force-recreate "$frontend_service" || true
  curl --fail --silent --show-error http://127.0.0.1/ --output /dev/null || true
  exit "$status"
}
trap rollback_public ERR

campus_cutover_compose=(docker compose --env-file "$campus_env" -f "$base_compose" -f "$override_compose")
"${campus_cutover_compose[@]}" config > "$state_dir/campus.after.yml"
"${campus_cutover_compose[@]}" \
  up -d --no-deps --force-recreate "$frontend_service"

published="$("${campus_cutover_compose[@]}" port "$frontend_service" 80)"
[[ "$published" == 127.0.0.1:18080 ]] || {
  printf 'unexpected CampusHub frontend binding: %s\n' "$published" >&2
  exit 1
}
curl --fail --silent --show-error http://127.0.0.1:18080/ --output /dev/null
assert_existing_loopback_service 8080
assert_existing_loopback_service 33306

systemctl start caddy
bash "$script_dir/health-check.sh" --public
assert_existing_loopback_service 8080
assert_existing_loopback_service 33306
systemctl enable caddy

trap - ERR
printf 'Caddy cutover succeeded. Snapshot: %s\n' "$state_dir"

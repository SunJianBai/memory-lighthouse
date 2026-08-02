#!/usr/bin/env bash
set -Eeuo pipefail
umask 0077

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
case "${OPENBMB_OPERATION_LOCK_HELD:-false}" in
  false)
    exec flock --exclusive --wait 0 --conflict-exit-code 75 \
      /run/lock/openbmb-operation.lock \
      env OPENBMB_OPERATION_LOCK_HELD=true bash "$script_dir/cutover-caddy.sh" "$@"
    ;;
  true) ;;
  *) printf 'OPENBMB_OPERATION_LOCK_HELD must be true or false\n' >&2; exit 1 ;;
esac

if [[ $# -ne 5 ]]; then
  printf 'usage: %s <CampusHub-dir> <base-compose.yml> <env-file> <override.yml> <frontend-service>\n' "${BASH_SOURCE[0]}" >&2
  exit 2
fi

campus_dir="$(readlink -f -- "$1")"
base_compose="$2"
campus_env="$3"
override_compose="$4"
frontend_service="$5"
state_root="${OPENBMB_CUTOVER_STATE_ROOT:-/var/lib/openbmb/cutover}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
state_dir="$state_root/$stamp"
caddy_env="${OPENBMB_CADDY_ENV_FILE:-/etc/caddy/openbmb.env}"
caddy_config="${OPENBMB_CADDY_CONFIG_FILE:-/etc/caddy/Caddyfile}"
health_check_script="${OPENBMB_CUTOVER_HEALTH_CHECK:-$script_dir/health-check.sh}"

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
[[ -f "$caddy_config" ]] || { printf 'Caddy configuration file not found\n' >&2; exit 1; }
[[ -f "$health_check_script" && ! -L "$health_check_script" ]] || {
  printf 'public health-check script not found\n' >&2
  exit 1
}
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
  --config "$caddy_config" \
  --adapter caddyfile \
  --envfile "$caddy_env"
initial_caddy_enable_state="$(systemctl is-enabled caddy 2>/dev/null || true)"
[[ "$initial_caddy_enable_state" == enabled || "$initial_caddy_enable_state" == disabled ]] || {
  printf 'Caddy must be either enabled or disabled before cutover, got: %s\n' \
    "$initial_caddy_enable_state" >&2
  exit 1
}

public_mutation_started=false
cutover_complete=false
rollback_public() {
  local status="$1"
  trap - EXIT HUP INT TERM
  if [[ "$cutover_complete" == true ]]; then
    exit "$status"
  fi
  if [[ "$public_mutation_started" == true ]]; then
    printf 'Cutover failed or was interrupted; restoring CampusHub directly on port 80.\n' >&2
    systemctl stop caddy || true
    cd "$campus_dir"
    "${campus_compose[@]}" up -d --pull never --no-build --no-deps --force-recreate "$frontend_service" || true
    curl --fail --silent --show-error http://127.0.0.1/ --output /dev/null || true
    if [[ "$initial_caddy_enable_state" == enabled ]]; then
      systemctl enable caddy || true
    else
      systemctl disable caddy || true
    fi
  fi
  exit "$status"
}
finish_on_exit() {
  local status=$?
  if [[ "$status" -eq 0 && "$cutover_complete" == true ]]; then
    return
  fi
  rollback_public "$status"
}
trap finish_on_exit EXIT
trap 'rollback_public 129' HUP
trap 'rollback_public 130' INT
trap 'rollback_public 143' TERM

campus_cutover_compose=(docker compose --env-file "$campus_env" -f "$base_compose" -f "$override_compose")
"${campus_cutover_compose[@]}" config > "$state_dir/campus.after.yml"
public_mutation_started=true
"${campus_cutover_compose[@]}" \
  up -d --pull never --no-build --no-deps --force-recreate "$frontend_service"

published="$("${campus_cutover_compose[@]}" port "$frontend_service" 80)"
[[ "$published" == 127.0.0.1:18080 ]] || {
  printf 'unexpected CampusHub frontend binding: %s\n' "$published" >&2
  exit 1
}
curl --fail --silent --show-error http://127.0.0.1:18080/ --output /dev/null
assert_existing_loopback_service 8080
assert_existing_loopback_service 33306

systemctl start caddy
bash "$health_check_script" --public
assert_existing_loopback_service 8080
assert_existing_loopback_service 33306
systemctl enable caddy

cutover_complete=true
trap - EXIT HUP INT TERM
printf 'Caddy cutover succeeded. Snapshot: %s\n' "$state_dir"

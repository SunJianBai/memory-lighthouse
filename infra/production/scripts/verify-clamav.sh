#!/usr/bin/env bash
set -Eeuo pipefail

api_env="${OPENBMB_API_ENV_FILE:-/etc/openbmb/api.env}"
infra_env="${OPENBMB_INFRA_ENV_FILE:-/etc/openbmb/infra.env}"
mode="${1:---once}"

case "$mode" in
  --once) wait_deadline=0 ;;
  --wait) wait_deadline=$((SECONDS + 1800)) ;;
  *)
    printf 'usage: %s [--once|--wait]\n' "${BASH_SOURCE[0]}" >&2
    exit 2
    ;;
esac

command -v timeout >/dev/null 2>&1 || {
  printf 'ClamAV check requires timeout(1).\n' >&2
  exit 1
}
[[ -f "$api_env" ]] || {
  printf 'ClamAV check environment is missing: %s\n' "$api_env" >&2
  exit 1
}
[[ -f "$infra_env" ]] || {
  printf 'ClamAV infrastructure environment is missing: %s\n' "$infra_env" >&2
  exit 1
}

value_from() {
  local key="$1"
  local file="$2"
  awk -F= -v wanted="$key" '$1 == wanted { sub(/^[^=]*=/, ""); print; exit }' "$file"
}

clamav_host="$(value_from CLAMAV_HOST "$api_env")"
clamav_port="$(value_from CLAMAV_PORT "$api_env")"
clamav_host_port="$(value_from CLAMAV_HOST_PORT "$infra_env")"
[[ "$clamav_host" == 127.0.0.1 ]] || {
  printf 'Production ClamAV must use the same-host loopback endpoint.\n' >&2
  exit 1
}
[[ "$clamav_port" =~ ^[0-9]+$ && "$clamav_port" -ge 1 && "$clamav_port" -le 65535 ]] || {
  printf 'CLAMAV_PORT must be between 1 and 65535.\n' >&2
  exit 1
}
[[ "$clamav_port" == "$clamav_host_port" ]] || {
  printf 'CLAMAV_PORT must equal the Compose loopback CLAMAV_HOST_PORT.\n' >&2
  exit 1
}

clamav_query() {
  timeout 5 bash -c '
    set -e
    exec 3<>"/dev/tcp/$1/$2"
    if [[ "$3" == ping ]]; then
      printf "zPING\0" >&3
    else
      # zINSTREAM followed by a zero-length network-order chunk is a real,
      # empty scan. It exercises the engine instead of only checking the port.
      printf "zINSTREAM\0\0\0\0\0" >&3
    fi
    IFS= read -r -d "" response <&3
    printf "%s" "$response"
  ' bash "$clamav_host" "$clamav_port" "$1"
}

probe_once() {
  local ping_reply
  local scan_reply

  ping_reply="$(clamav_query ping 2>/dev/null)" || return 1
  [[ "$ping_reply" == PONG ]] || return 1
  scan_reply="$(clamav_query scan 2>/dev/null)" || return 1
  [[ "$scan_reply" =~ (^|:)[[:space:]]*OK$ ]]
}

attempt=0
while true; do
  attempt=$((attempt + 1))
  if probe_once; then
    printf 'HEALTHY: same-host ClamAV accepts PING and INSTREAM\n'
    exit 0
  fi
  if [[ "$mode" == --once || "$SECONDS" -ge "$wait_deadline" ]]; then
    break
  fi
  if (( attempt == 1 || attempt % 6 == 0 )); then
    printf 'Waiting for the initial ClamAV signature load (%d seconds remain).\n' \
      "$((wait_deadline - SECONDS))"
  fi
  remaining_seconds=$((wait_deadline - SECONDS))
  (( remaining_seconds > 10 )) && remaining_seconds=10
  sleep "$remaining_seconds"
done

printf 'UNHEALTHY: same-host ClamAV did not accept PING and INSTREAM\n' >&2
exit 1

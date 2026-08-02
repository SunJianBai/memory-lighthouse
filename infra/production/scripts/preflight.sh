#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
production_dir="$(CDPATH= cd -- "$script_dir/.." && pwd -P)"
infra_env="${OPENBMB_INFRA_ENV_FILE:-/etc/openbmb/infra.env}"
api_env="${OPENBMB_API_ENV_FILE:-/etc/openbmb/api.env}"
expected_ip="124.220.81.104"

fail() {
  printf 'PRECHECK FAILED: %s\n' "$*" >&2
  exit 1
}

note() {
  printf 'PRECHECK: %s\n' "$*"
}

value_from() {
  local key="$1"
  local file="$2"
  awk -F= -v wanted="$key" '$1 == wanted { sub(/^[^=]*=/, ""); print; exit }' "$file"
}

for command_name in docker curl getent grep awk stat df openssl timeout mktemp readlink sync; do
  command -v "$command_name" >/dev/null 2>&1 || fail "required command is missing: $command_name"
done

[[ "$(uname -s)" == Linux ]] || fail 'production Compose uses Linux host networking'
docker compose version >/dev/null 2>&1 || fail 'Docker Compose v2 is unavailable'
[[ -f "$infra_env" ]] || fail "missing $infra_env"
[[ -f "$api_env" ]] || fail "missing $api_env"

for secret_file in "$infra_env" "$api_env"; do
  if find "$secret_file" -maxdepth 0 -perm /0037 -print -quit | grep -q .; then
    fail "$secret_file must not be readable/writable by other users (use 0640 or stricter)"
  fi
  if grep -Eq \
    '^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=.*(CHANGE_ME|REPLACE_WITH)' \
    "$secret_file"; then
    fail "$secret_file still contains placeholder secrets"
  fi
done

export OPENBMB_API_ENV_FILE="$api_env"
"$script_dir/compose.sh" config --quiet
note 'Compose model is valid'

livekit_key="$(value_from LIVEKIT_API_KEY "$infra_env")"
[[ "$livekit_key" == openbmb_api ]] || fail 'LIVEKIT_API_KEY must be openbmb_api because the webhook config pins that identifier'

[[ "$(value_from OPENBMB_DOMAIN "$infra_env")" == sun227454.online ]] || fail 'OPENBMB_DOMAIN must be sun227454.online on TX4H4G'
[[ "$(value_from MINIO_BUCKET "$infra_env")" == openbmb-assets ]] || fail 'MINIO_BUCKET must stay openbmb-assets because Caddy exposes that exact signed bucket path'

node_ip="$(value_from LIVEKIT_NODE_IP "$infra_env")"
[[ "$node_ip" == "$expected_ip" ]] || fail "LIVEKIT_NODE_IP must be $expected_ip on TX4H4G"

inspection="$(value_from ENABLE_DEVELOPMENT_CONTENT_INSPECTION "$api_env")"
[[ "${inspection,,}" == false ]] || fail 'production content inspection must remain false'

declare -a infra_secret_keys=(
  MYSQL_PASSWORD MYSQL_ROOT_PASSWORD REDIS_APP_PASSWORD
  REDIS_LIVEKIT_PASSWORD MINIO_ROOT_PASSWORD MINIO_APP_SECRET_KEY
  LIVEKIT_API_SECRET
)
declare -A seen_secrets=()
for key in "${infra_secret_keys[@]}"; do
  value="$(value_from "$key" "$infra_env")"
  [[ "$value" =~ ^[A-Za-z0-9_-]{32,}$ ]] || fail "$key must be at least 32 base64url characters"
  [[ -z "${seen_secrets[$value]:-}" ]] || fail "$key reuses the value from ${seen_secrets[$value]}"
  seen_secrets[$value]="$key"
done

kms_secret="$(value_from MINIO_KMS_SECRET_KEY "$infra_env")"
if [[ ! "$kms_secret" =~ ^([A-Za-z0-9._-]{1,64}):([A-Za-z0-9+/]+={0,2})$ ]] || \
   [[ "$(printf '%s' "${BASH_REMATCH[2]:-}" | openssl base64 -d -A 2>/dev/null | wc -c)" -ne 32 ]]; then
  fail 'MINIO_KMS_SECRET_KEY must be a key name plus standard Base64 for exactly 32 random bytes'
fi

declare -a api_base64url_keys=(
  AUTH_ACCESS_TOKEN_SECRET AUTH_ADMIN_ACCESS_TOKEN_SECRET
  AUTH_REFRESH_TOKEN_PEPPER
  AUTH_ONE_TIME_TOKEN_PEPPER HOUSEHOLD_INVITATION_TOKEN_PEPPER
  RATE_LIMIT_KEY_SECRET DEVICE_ACTIVATION_PEPPER
  DEVICE_CREDENTIAL_PEPPER DEVICE_ACCESS_TOKEN_SECRET
  CARE_WORKFLOW_ENCRYPTION_KEY
)
for key in "${api_base64url_keys[@]}"; do
  value="$(value_from "$key" "$api_env")"
  [[ "$value" =~ ^[A-Za-z0-9_-]{43,}$ ]] || fail "$key must encode at least 32 random bytes as base64url"
  [[ -z "${seen_secrets[$value]:-}" ]] || fail "$key reuses the value from ${seen_secrets[$value]}"
  seen_secrets[$value]="$key"
done

data_key="$(value_from DATA_ENCRYPTION_KEY_BASE64 "$api_env")"
if [[ ! "$data_key" =~ ^[A-Za-z0-9+/]+={0,2}$ ]] || \
   [[ "$(printf '%s' "$data_key" | openssl base64 -d -A 2>/dev/null | wc -c)" -ne 32 ]]; then
  fail 'DATA_ENCRYPTION_KEY_BASE64 must be standard Base64 for exactly 32 random bytes'
fi

available_kib="$(awk '/MemAvailable:/ { print $2 }' /proc/meminfo)"
swap_free_kib="$(awk '/SwapFree:/ { print $2 }' /proc/meminfo)"
[[ "${available_kib:-0}" -ge 786432 ]] || fail 'at least 768 MiB immediately available RAM is required before deployment'
available_disk_kib="$(df -Pk /opt | awk 'NR == 2 { print $4 }')"
case "${OPENBMB_SKIP_IMAGE_BUILD:-false}" in
  true)
    [[ "$(( ${available_kib:-0} + ${swap_free_kib:-0} ))" -ge 1572864 ]] || \
      fail 'available RAM plus free swap must total at least 1.5 GiB for migration and startup'
    [[ "${available_disk_kib:-0}" -ge 3145728 ]] || \
      fail 'at least 3 GiB free space under /opt is required after preloading release images'
    ;;
  false)
    fail 'host-local production builds are disabled; use digest-pinned preloaded images and OPENBMB_SKIP_IMAGE_BUILD=true'
    ;;
  *) fail 'OPENBMB_SKIP_IMAGE_BUILD must be true or false' ;;
esac

for host_name in \
  "$(value_from OPENBMB_DOMAIN "$infra_env")"; do
  [[ -n "$host_name" ]] || fail 'all public domain values must be set'
  if ! getent ahostsv4 "$host_name" | awk '{print $1}' | grep -Fxq "$expected_ip"; then
    fail "$host_name does not resolve to $expected_ip"
  fi
done
note 'root DNS record resolves to TX4H4G; LiveKit and S3 reuse it'

smtp_host="$(value_from SMTP_HOST "$api_env")"
smtp_port="$(value_from SMTP_PORT "$api_env")"
smtp_from="$(value_from SMTP_FROM_ADDRESS "$api_env")"
[[ -n "$smtp_host" && "$smtp_host" != smtp.example.com ]] || fail 'real SMTP_HOST is required'
[[ "$smtp_port" =~ ^[0-9]+$ ]] || fail 'SMTP_PORT must be numeric'
[[ -n "$smtp_from" && "$smtp_from" != *@example.com ]] || fail 'real SMTP_FROM_ADDRESS is required'
getent ahosts "$smtp_host" >/dev/null || fail "SMTP host does not resolve: $smtp_host"

clamav_host="$(value_from CLAMAV_HOST "$api_env")"
clamav_port="$(value_from CLAMAV_PORT "$api_env")"
clamav_timeout_ms="$(value_from CLAMAV_SCAN_TIMEOUT_MS "$api_env")"
asset_worker_enabled="$(value_from ASSET_LIFECYCLE_WORKER_ENABLED "$api_env")"
asset_lease_ms="$(value_from ASSET_LIFECYCLE_LEASE_MS "$api_env")"
[[ "${asset_worker_enabled,,}" == true ]] || \
  fail 'ASSET_LIFECYCLE_WORKER_ENABLED must be true in production'
[[ "$clamav_host" =~ ^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$ ]] || \
  fail 'CLAMAV_HOST must be a private DNS name or IPv4 address'
[[ "$clamav_host" != *.example ]] || fail 'a real private CLAMAV_HOST is required'
[[ "$clamav_port" =~ ^[0-9]+$ && "$clamav_port" -ge 1 && "$clamav_port" -le 65535 ]] || \
  fail 'CLAMAV_PORT must be between 1 and 65535'
[[ "$clamav_timeout_ms" =~ ^[0-9]+$ && "$clamav_timeout_ms" -ge 1000 && "$clamav_timeout_ms" -le 300000 ]] || \
  fail 'CLAMAV_SCAN_TIMEOUT_MS must be between 1000 and 300000'
[[ "$asset_lease_ms" =~ ^[0-9]+$ && "$asset_lease_ms" -ge 60000 && "$asset_lease_ms" -le 1800000 ]] || \
  fail 'ASSET_LIFECYCLE_LEASE_MS must be between 60000 and 1800000'
[[ "$asset_lease_ms" -ge "$((clamav_timeout_ms + 30000))" ]] || \
  fail 'ASSET_LIFECYCLE_LEASE_MS must exceed CLAMAV_SCAN_TIMEOUT_MS by at least 30 seconds'

clamav_query() {
  timeout 5 bash -c '
    set -e
    exec 3<>"/dev/tcp/$1/$2"
    if [[ "$3" == ping ]]; then
      printf "zPING\0" >&3
    else
      printf "zINSTREAM\0\0\0\0\0" >&3
    fi
    IFS= read -r -d "" response <&3
    printf "%s" "$response"
  ' bash "$clamav_host" "$clamav_port" "$1"
}

[[ "$(clamav_query ping 2>/dev/null)" == PONG ]] || \
  fail 'private clamd did not answer PING'
clamav_scan_reply="$(clamav_query scan 2>/dev/null)" || \
  fail 'private clamd did not accept INSTREAM'
[[ "$clamav_scan_reply" =~ (^|:)[[:space:]]*OK$ ]] || \
  fail 'private clamd INSTREAM health scan failed'
note 'private clamd accepts real INSTREAM scanning'

note 'Tencent Cloud and UFW must separately allow 80/TCP, 443/TCP, 7881/TCP, 7882/UDP and 3478/UDP'
note 'preflight checks passed'

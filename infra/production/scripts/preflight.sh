#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
production_dir="$(CDPATH= cd -- "$script_dir/.." && pwd -P)"
infra_env="${OPENBMB_INFRA_ENV_FILE:-/etc/openbmb/infra.env}"
api_env="${OPENBMB_API_ENV_FILE:-/etc/openbmb/api.env}"
expected_ip="124.220.81.104"
check_clamav_runtime=true

case "$#:${1:-}" in
  0:) ;;
  1:--skip-clamav-runtime) check_clamav_runtime=false ;;
  *)
    printf 'usage: %s [--skip-clamav-runtime]\n' "${BASH_SOURCE[0]}" >&2
    exit 2
    ;;
esac

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

assert_unique_env_keys() {
  local file="$1"
  local duplicates
  duplicates="$(
    awk -F= '
      /^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=/ {
        key = $1
        sub(/^[[:space:]]*/, "", key)
        sub(/[[:space:]]*$/, "", key)
        count[key] += 1
      }
      END {
        for (key in count) {
          if (count[key] > 1) print key
        }
      }
    ' "$file" | LC_ALL=C sort
  )"
  [[ -z "$duplicates" ]] || \
    fail "$file defines duplicate keys: $(tr '\n' ',' <<<"$duplicates" | sed 's/,$//')"
}

for command_name in docker curl getent grep awk sed sort tr stat df openssl timeout mktemp readlink sync; do
  command -v "$command_name" >/dev/null 2>&1 || fail "required command is missing: $command_name"
done

[[ "$(uname -s)" == Linux ]] || fail 'production Compose uses Linux host networking'
docker compose version >/dev/null 2>&1 || fail 'Docker Compose v2 is unavailable'
[[ -f "$infra_env" ]] || fail "missing $infra_env"
[[ -f "$api_env" ]] || fail "missing $api_env"

for secret_file in "$infra_env" "$api_env"; do
  assert_unique_env_keys "$secret_file"
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
docker_root="$(docker info --format '{{.DockerRootDir}}')"
[[ "$docker_root" == /* && -d "$docker_root" ]] || fail 'DockerRootDir must be an existing absolute directory'
docker_available_kib="$(df -Pk "$docker_root" | awk 'NR == 2 { print $4 }')"
case "${OPENBMB_SKIP_IMAGE_BUILD:-false}" in
  true)
    [[ "$(( ${available_kib:-0} + ${swap_free_kib:-0} ))" -ge 3145728 ]] || \
      fail 'available RAM plus free swap must total at least 3 GiB for ClamAV and the application stack'
    [[ "${available_disk_kib:-0}" -ge 4194304 ]] || \
      fail 'at least 4 GiB free space under /opt is required after preloading release images'
    [[ "${docker_available_kib:-0}" -ge 4194304 ]] || \
      fail 'at least 4 GiB free space under DockerRootDir is required for ClamAV signatures and containers'
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
smtp_secure="$(value_from SMTP_SECURE "$api_env")"
smtp_require_tls="$(value_from SMTP_REQUIRE_TLS "$api_env")"
smtp_user="$(value_from SMTP_USER "$api_env")"
smtp_password="$(value_from SMTP_PASSWORD "$api_env")"
smtp_from="$(value_from SMTP_FROM_ADDRESS "$api_env")"
[[ "$smtp_host" == smtp.qq.com ]] || fail 'SMTP_HOST must be smtp.qq.com for the selected QQ mailbox'
[[ "$smtp_port" == 465 ]] || fail 'QQ SMTP must use port 465 with implicit TLS'
[[ "${smtp_secure,,}" == true ]] || fail 'SMTP_SECURE must be true for QQ port 465'
[[ "${smtp_require_tls,,}" == false ]] || fail 'SMTP_REQUIRE_TLS must be false because port 465 uses implicit TLS, not STARTTLS'
[[ "${smtp_user,,}" =~ ^[a-z0-9._%+-]+@qq\.com$ ]] || fail 'SMTP_USER must be the complete QQ email address'
[[ -n "$smtp_password" ]] || fail 'SMTP_PASSWORD must contain the QQ SMTP authorization code'
[[ "${smtp_from,,}" == "${smtp_user,,}" ]] || fail 'SMTP_FROM_ADDRESS must equal SMTP_USER for QQ SMTP'
getent ahosts "$smtp_host" >/dev/null || fail "SMTP host does not resolve: $smtp_host"
note 'QQ SMTP uses implicit TLS on port 465; API readiness performs authenticated verification'

clamav_host="$(value_from CLAMAV_HOST "$api_env")"
clamav_port="$(value_from CLAMAV_PORT "$api_env")"
clamav_host_port="$(value_from CLAMAV_HOST_PORT "$infra_env")"
clamav_timeout_ms="$(value_from CLAMAV_SCAN_TIMEOUT_MS "$api_env")"
asset_worker_enabled="$(value_from ASSET_LIFECYCLE_WORKER_ENABLED "$api_env")"
asset_worker_concurrency="$(value_from ASSET_LIFECYCLE_CONCURRENCY "$api_env")"
asset_lease_ms="$(value_from ASSET_LIFECYCLE_LEASE_MS "$api_env")"
[[ "${asset_worker_enabled,,}" == true ]] || \
  fail 'ASSET_LIFECYCLE_WORKER_ENABLED must be true in production'
[[ "$asset_worker_concurrency" == 1 ]] || \
  fail 'ASSET_LIFECYCLE_CONCURRENCY must be 1 on the 4 GiB production host'
[[ "$clamav_host" == 127.0.0.1 ]] || \
  fail 'CLAMAV_HOST must be 127.0.0.1 for the same-host scanner'
[[ "$clamav_port" =~ ^[0-9]+$ && "$clamav_port" -ge 1 && "$clamav_port" -le 65535 ]] || \
  fail 'CLAMAV_PORT must be between 1 and 65535'
[[ "$clamav_host_port" =~ ^[0-9]+$ && "$clamav_host_port" -ge 1 && "$clamav_host_port" -le 65535 ]] || \
  fail 'CLAMAV_HOST_PORT must be between 1 and 65535'
[[ "$clamav_port" == "$clamav_host_port" ]] || \
  fail 'CLAMAV_PORT must equal the loopback CLAMAV_HOST_PORT published by Compose'
[[ "$clamav_timeout_ms" =~ ^[0-9]+$ && "$clamav_timeout_ms" -ge 1000 && "$clamav_timeout_ms" -le 300000 ]] || \
  fail 'CLAMAV_SCAN_TIMEOUT_MS must be between 1000 and 300000'
[[ "$asset_lease_ms" =~ ^[0-9]+$ && "$asset_lease_ms" -ge 60000 && "$asset_lease_ms" -le 1800000 ]] || \
  fail 'ASSET_LIFECYCLE_LEASE_MS must be between 60000 and 1800000'
[[ "$asset_lease_ms" -ge "$((clamav_timeout_ms + 30000))" ]] || \
  fail 'ASSET_LIFECYCLE_LEASE_MS must exceed CLAMAV_SCAN_TIMEOUT_MS by at least 30 seconds'

if [[ "$check_clamav_runtime" == true ]]; then
  bash "$script_dir/verify-clamav.sh" --once || \
    fail 'same-host ClamAV runtime verification failed'
  note 'same-host ClamAV accepts real INSTREAM scanning'
else
  note 'same-host ClamAV runtime check deferred until its immutable image is verified and started'
fi

note 'Tencent Cloud and UFW must separately allow 80/TCP, 443/TCP, 7881/TCP, 7882/UDP and 3478/UDP'
note 'preflight checks passed'

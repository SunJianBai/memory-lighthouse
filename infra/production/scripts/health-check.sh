#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
mode="${1:---local}"
root_domain="${OPENBMB_DOMAIN:-sun227454.online}"

retry() {
  local description="$1"
  shift
  local attempt
  for attempt in $(seq 1 30); do
    if "$@"; then
      printf 'HEALTHY: %s\n' "$description"
      return 0
    fi
    sleep 2
  done
  printf 'UNHEALTHY: %s\n' "$description" >&2
  return 1
}

clamav_ready() {
  bash "$script_dir/verify-clamav.sh" --once >/dev/null 2>&1
}

http_ready() {
  curl \
    --fail \
    --silent \
    --connect-timeout 2 \
    --max-time 10 \
    "$1" \
    --output /dev/null
}

if [[ "$mode" == --local ]]; then
  retry 'ClamAV PING and INSTREAM' clamav_ready
  retry 'client web container' http_ready http://127.0.0.1:14173/healthz
  retry 'admin web container' http_ready http://127.0.0.1:14174/healthz
  retry 'API liveness' http_ready http://127.0.0.1:13100/openBMB/api/v1/health/live
  retry 'API readiness' http_ready http://127.0.0.1:13100/openBMB/api/v1/health/ready
  retry 'LiveKit signal' http_ready http://127.0.0.1:17880/
elif [[ "$mode" == --public ]]; then
  retry 'ClamAV PING and INSTREAM (host loopback)' clamav_ready
  retry 'CampusHub fallback' http_ready "https://$root_domain/"
  retry 'OpenBMB client' http_ready "https://$root_domain/openBMB/"
  retry 'OpenBMB admin' http_ready "https://$root_domain/openBMB/admin/"
  retry 'OpenBMB API readiness' http_ready "https://$root_domain/openBMB/api/v1/health/ready"
  retry 'LiveKit TLS signal' http_ready "https://$root_domain/openBMB/rtc-health"
  retry 'private S3 endpoint' http_ready "https://$root_domain/openBMB/object-storage-health"
else
  printf 'usage: %s [--local|--public]\n' "${BASH_SOURCE[0]}" >&2
  exit 2
fi

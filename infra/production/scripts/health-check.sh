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

if [[ "$mode" == --local ]]; then
  retry 'ClamAV PING and INSTREAM' clamav_ready
  retry 'client web container' curl --fail --silent --show-error http://127.0.0.1:14173/healthz --output /dev/null
  retry 'admin web container' curl --fail --silent --show-error http://127.0.0.1:14174/healthz --output /dev/null
  retry 'API liveness' curl --fail --silent --show-error http://127.0.0.1:13100/openBMB/api/v1/health/live --output /dev/null
  retry 'API readiness' curl --fail --silent --show-error http://127.0.0.1:13100/openBMB/api/v1/health/ready --output /dev/null
  retry 'LiveKit signal' curl --fail --silent --show-error http://127.0.0.1:17880/ --output /dev/null
elif [[ "$mode" == --public ]]; then
  retry 'ClamAV PING and INSTREAM (host loopback)' clamav_ready
  retry 'CampusHub fallback' curl --fail --silent --show-error "https://$root_domain/" --output /dev/null
  retry 'OpenBMB client' curl --fail --silent --show-error "https://$root_domain/openBMB/" --output /dev/null
  retry 'OpenBMB admin' curl --fail --silent --show-error "https://$root_domain/openBMB/admin/" --output /dev/null
  retry 'OpenBMB API readiness' curl --fail --silent --show-error "https://$root_domain/openBMB/api/v1/health/ready" --output /dev/null
  retry 'LiveKit TLS signal' curl --fail --silent --show-error "https://$root_domain/openBMB/rtc-health" --output /dev/null
  retry 'private S3 endpoint' curl --fail --silent --show-error "https://$root_domain/openBMB/object-storage-health" --output /dev/null
else
  printf 'usage: %s [--local|--public]\n' "${BASH_SOURCE[0]}" >&2
  exit 2
fi

#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
production_dir="$(CDPATH= cd -- "$script_dir/.." && pwd -P)"

for script in "$script_dir"/*.sh; do
  bash -n "$script"
done
printf 'Shell syntax: OK\n'

OPENBMB_INFRA_ENV_FILE="$production_dir/env/infra.env.example" \
OPENBMB_API_ENV_FILE="$production_dir/env/api.env.example" \
OPENBMB_RELEASE=static-validation \
  bash "$script_dir/compose.sh" config --quiet
printf 'Docker Compose model: OK\n'

resolved="$(
  OPENBMB_INFRA_ENV_FILE="$production_dir/env/infra.env.example" \
  OPENBMB_API_ENV_FILE="$production_dir/env/api.env.example" \
  OPENBMB_RELEASE=static-validation \
    bash "$script_dir/compose.sh" config
)"

grep -Fq '127.0.0.1:13100' <<<"$resolved" || {
  printf 'API loopback bind invariant is missing\n' >&2
  exit 1
}
grep -Fq 'published: "14173"' <<<"$resolved" || {
  printf 'client loopback publish invariant is missing\n' >&2
  exit 1
}
grep -Fq 'published: "14174"' <<<"$resolved" || {
  printf 'admin loopback publish invariant is missing\n' >&2
  exit 1
}
[[ "$(grep -Fc 'host_ip: 127.0.0.1' <<<"$resolved")" -ge 7 ]] || {
  printf 'one or more production ports are not loopback-scoped\n' >&2
  exit 1
}
grep -Fq 'ENABLE_DEVELOPMENT_CONTENT_INSPECTION: "false"' <<<"$resolved" || {
  printf 'production inspection hard-off invariant is missing\n' >&2
  exit 1
}

printf 'Static deployment invariants: OK\n'

if command -v caddy >/dev/null 2>&1; then
  caddy_validation_log="$(mktemp "${TMPDIR:-/tmp}/openbmb-caddy-validate.XXXXXX.log")"
  trap 'rm -f -- "$caddy_validation_log"' EXIT
  CADDY_ACCESS_LOG="$caddy_validation_log" caddy validate \
    --config "$production_dir/caddy/Caddyfile" \
    --adapter caddyfile \
    --envfile "$production_dir/caddy/openbmb.env.example"
  rm -f -- "$caddy_validation_log"
  trap - EXIT
  printf 'Caddy configuration: OK\n'
else
  printf 'Caddy binary absent; Caddy validation skipped (Compose validation still passed).\n'
fi

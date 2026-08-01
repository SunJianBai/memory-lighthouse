#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
production_dir="$(CDPATH= cd -- "$script_dir/.." && pwd -P)"

for script in "$script_dir"/*.sh; do
  bash -n "$script"
done
printf 'Shell syntax: OK\n'

line_of() {
  grep -nF -m 1 -- "$2" "$1" | cut -d: -f1
}

assert_before() {
  local file="$1"
  local earlier="$2"
  local later="$3"
  local earlier_line
  local later_line
  earlier_line="$(line_of "$file" "$earlier")"
  later_line="$(line_of "$file" "$later")"
  [[ -n "$earlier_line" && -n "$later_line" && "$earlier_line" -lt "$later_line" ]] || {
    printf 'state-order invariant failed in %s: %s must precede %s\n' \
      "$file" "$earlier" "$later" >&2
    exit 1
  }
}

deploy_script="$script_dir/deploy-release.sh"
backup_script="$script_dir/backup.sh"
service_control_script="$script_dir/service-control.sh"
backup_service="$production_dir/systemd/openbmb-backup.service"
assert_before "$deploy_script" \
  'mv -Tf -- "$temporary_link" "$current_link"' \
  "printf 'Starting or reconciling data and media services."
assert_before "$deploy_script" \
  'bash "$script_dir/health-check.sh" --local' \
  'mv -Tf -- "$application_temporary_link" "$application_link"'
assert_before "$backup_script" \
  'active_entry="$current_link/infra/production/scripts/backup.sh"' \
  'script_path="$(readlink -f -- "${BASH_SOURCE[0]}")"'
assert_before "$backup_script" \
  "trap 'finish_on_signal 143' TERM" \
  '"$script_dir/compose.sh" stop --timeout 30 api'
assert_before "$backup_script" \
  'partial_dir="$(mktemp -d -- "$backup_root/.partial-${stamp}.XXXXXX")"' \
  'mv -T -- "$partial_dir" "$published_dir"'
assert_before "$backup_script" \
  'mv -T -- "$partial_dir" "$published_dir"' \
  'mv -- "$completion_tmp" "$published_dir/.openbmb-backup-complete"'
assert_before "$service_control_script" \
  'active_entry="$current_link/infra/production/scripts/service-control.sh"' \
  'script_path="$(readlink -f -- "${BASH_SOURCE[0]}")"'
grep -Fq -- '--wait 0 --conflict-exit-code 75' "$service_control_script"
grep -Fq 'OPENBMB_INFRASTRUCTURE_RELEASE="$old_id"' "$deploy_script"
grep -Fq 'API remained running; refusing infrastructure reconciliation and migration.' \
  "$deploy_script"
grep -Fq 'bash "$script_dir/health-check.sh" --local' "$backup_script"
grep -Fq 'sha256sum --check SHA256SUMS.tmp' "$backup_script"
grep -Fq '! -path ./SHA256SUMS' "$backup_script"
grep -Fq "trap 'rollback_on_signal 143' TERM" "$deploy_script"
grep -Fq "trap 'restore_on_signal 143' TERM" "$script_dir/rollback-release.sh"
grep -Fq 'ExecStopPost=/bin/bash /opt/openbmb/current/infra/production/scripts/service-control.sh reload' \
  "$backup_service"
grep -Fq 'TimeoutStopSec=600' "$backup_service"
printf 'Release state ordering: OK\n'

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

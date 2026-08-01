#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
production_dir="$(CDPATH= cd -- "$script_dir/.." && pwd -P)"
project_root="$(CDPATH= cd -- "$production_dir/../.." && pwd -P)"

for script in "$script_dir"/*.sh; do
  bash -n "$script"
done
printf 'Shell syntax: OK\n'
bash "$script_dir/test-security-state.sh"
bash "$script_dir/audit-security-migration-recovery.sh" --self-test

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
rollback_script="$script_dir/rollback-release.sh"
delivery_workflow="$project_root/.github/workflows/production-delivery.yml"
key_capability_migration="$project_root/apps/server-api/prisma/migrations/20260802151000_require_non_exportable_device_key_protection/migration.sql"
join_ticket_migration="$project_root/apps/server-api/prisma/migrations/20260802141000_one_time_remote_join_tickets/migration.sql"
server_schema="$project_root/apps/server-api/prisma/schema.prisma"
reference_schema="$project_root/docs/refactor/database/schema.prisma"
migration_lock="$project_root/apps/server-api/prisma/migrations/migration_lock.toml"

while IFS= read -r -d '' migration_file; do
  awk -v file="$migration_file" '
    {
      rest = $0
      while (match(rest, /`[^`]+`/)) {
        identifier = substr(rest, RSTART + 1, RLENGTH - 2)
        if (length(identifier) > 64) {
          printf "MySQL identifier exceeds 64 characters: %s:%d: %s\n", \
            file, FNR, identifier > "/dev/stderr"
          exit 1
        }
        rest = substr(rest, RSTART + RLENGTH)
      }
    }
  ' "$migration_file"
done < <(find "$project_root/apps/server-api/prisma/migrations" \
  -type f -name migration.sql -print0)

assert_before "$deploy_script" \
  'mv -Tf -- "$temporary_link" "$current_link"' \
  "printf 'Starting or reconciling data services while realtime media remains drained."
assert_before "$deploy_script" \
  'bash "$script_dir/compose.sh" stop --timeout 30 api livekit' \
  'bash "$security_epoch_script" begin "$release_root"'
assert_before "$deploy_script" \
  'bash "$security_epoch_script" begin "$release_root"' \
  'irreversible_boundary_started=true # Credential rotation starts after this fail-closed boundary.'
assert_before "$deploy_script" \
  'irreversible_boundary_started=true # Credential rotation starts after this fail-closed boundary.' \
  'bash "$script_dir/rotate-livekit-secret.sh"'
assert_before "$deploy_script" \
  'bash "$script_dir/rotate-livekit-secret.sh"' \
  'bash "$script_dir/drain-realtime.sh"'
assert_before "$deploy_script" \
  'bash "$script_dir/drain-realtime.sh"' \
  "printf 'Applying committed Prisma migrations."
assert_before "$deploy_script" \
  "printf 'Applying committed Prisma migrations." \
  "printf 'Starting the drained LiveKit service after schema migration."
assert_before "$deploy_script" \
  'bash "$script_dir/health-check.sh" --local' \
  'mv -Tf -- "$application_temporary_link" "$application_link"'
assert_before "$deploy_script" \
  'mv -Tf -- "$application_temporary_link" "$application_link"' \
  'bash "$security_epoch_script" finish "$release_root"'
assert_before "$backup_script" \
  'active_entry="$current_link/infra/production/scripts/backup.sh"' \
  'script_path="$(readlink -f -- "${BASH_SOURCE[0]}")"'
assert_before "$backup_script" \
  'if bash "$security_epoch_script" pending-exists; then' \
  'mkdir -p -- "$backup_root"'
assert_before "$backup_script" \
  "trap 'finish_on_signal 143' TERM" \
  '"$script_dir/compose.sh" stop --timeout 30 api'
assert_before "$backup_script" \
  'partial_dir="$(mktemp -d -- "$backup_root/.partial-${stamp}.XXXXXX")"' \
  'mv -T -- "$partial_dir" "$published_dir"'
assert_before "$backup_script" \
  'bash "$security_epoch_script" minimum >"$partial_dir/minimum-security-epoch"' \
  "printf 'Creating MySQL snapshot in %s"
assert_before "$backup_script" \
  'mv -T -- "$partial_dir" "$published_dir"' \
  'mv -- "$completion_tmp" "$published_dir/.openbmb-backup-complete"'
assert_before "$service_control_script" \
  'active_entry="$current_link/infra/production/scripts/service-control.sh"' \
  'script_path="$(readlink -f -- "${BASH_SOURCE[0]}")"'
assert_before "$rollback_script" \
  'application_link_mutation_started=true' \
  'mv -Tf -- "$temporary_link" "$application_link"'
assert_before "$rollback_script" \
  'mv -Tf -- "$temporary_link" "$application_link"' \
  'sync -f -- "$(dirname -- "$application_link")"'
assert_before "$rollback_script" \
  'sync -f -- "$(dirname -- "$application_link")"' \
  'rollback_complete=true'
assert_before "$rollback_script" \
  'application_pointer_safe=false' \
  'ln -sfn -- "$old_application_target" "$restore_temporary_link"'
assert_before "$rollback_script" \
  'mv -Tf -- "$restore_temporary_link" "$application_link"' \
  'sync -f -- "$application_state_directory"'
awk '
  $0 == "  if [[ \"$application_pointer_safe\" == true ]]; then" {
    found_safe_branch = 1
    next
  }
  found_safe_branch && $0 == "  else" {
    in_unsafe_branch = 1
    next
  }
  in_unsafe_branch && /up -d/ { unsafe_up = 1 }
  in_unsafe_branch && /stop --timeout 30 api client-web admin-web/ {
    unsafe_stop = 1
  }
  in_unsafe_branch && $0 == "  fi" {
    checked_unsafe_branch = 1
    exit unsafe_stop && !unsafe_up ? 0 : 1
  }
  END { if (!checked_unsafe_branch) exit 1 }
' "$rollback_script"
grep -Fq -- '--wait 0 --conflict-exit-code 75' "$service_control_script"
grep -Fq 'OPENBMB_INFRASTRUCTURE_RELEASE="$old_id"' "$deploy_script"
grep -Fq 'API remained running; refusing infrastructure reconciliation and migration.' \
  "$deploy_script"
grep -Fq 'LiveKit remained running; refusing media drain and migration.' \
  "$deploy_script"
grep -Fq "'openbmb:media-owner:*'" "$script_dir/drain-realtime.sh"
grep -Fq 'openbmb-redis-livekit livekit REDIS_LIVEKIT_PASSWORD' \
  "$script_dir/drain-realtime.sh"
grep -Fq 'bash "$script_dir/health-check.sh" --local' "$backup_script"
grep -Fq 'sha256sum --check SHA256SUMS.tmp' "$backup_script"
grep -Fq '! -path ./SHA256SUMS' "$backup_script"
grep -Fq "trap 'rollback_on_signal 143' TERM" "$deploy_script"
grep -Fq "trap 'restore_on_signal 143' TERM" "$rollback_script"
grep -Fq 'bash "$security_epoch_script" assert-start "$application_target"' \
  "$service_control_script"
grep -Fq 'bash "$security_epoch_script" assert-rollback "$target"' \
  "$rollback_script"
grep -Fq '[[ "$current_stack_epoch" == 0 ]]' "$rollback_script"
grep -Fq 'ln -sfn -- "$old_application_target" "$restore_temporary_link"' \
  "$rollback_script"
grep -Fq 'mv -Tf -- "$restore_temporary_link" "$application_link"' \
  "$rollback_script"
grep -Fq 'bash "$security_epoch_script" complete-recovery "$old_application_target"' \
  "$deploy_script"
grep -Fq '[[ "$irreversible_boundary_started" == false && -n "$old_application_target" ]]' \
  "$deploy_script"
grep -Fq 'if [[ "$old_release_epoch" == 0 ]]; then' "$deploy_script"
grep -Fq 'Skipping the ordinary backup because this deployment is resuming a pending security boundary.' \
  "$deploy_script"
grep -Fq 'minimum-security-epoch' "$backup_script"
grep -Fq 'Refusing an ordinary backup while a security boundary is pending.' \
  "$backup_script"
grep -Fq 'Recovery LiveKit is healthy with the current, non-restored signing secret.' \
  "$deploy_script"
grep -Fq 'if bash "$security_epoch_script" pending-exists; then' \
  "$script_dir/audit-security-migration-recovery.sh"
grep -Fq "cat <<'SQL'" "$script_dir/audit-security-migration-recovery.sh"
! grep -Fq 'mysql_scalar <<SQL' \
  "$script_dir/audit-security-migration-recovery.sh"
grep -Fq "printf '  sudo -n bash %q --profile tools" \
  "$script_dir/audit-security-migration-recovery.sh"
for legacy_authority_contract in \
  '`remote_session_participants`' \
  '`remote_assistance_sessions`' \
  '`model_sessions`' \
  '`companion_sessions`' \
  '`device_credentials`' \
  '`companion_bindings`' \
  '`devices`' \
  '`device_activation_challenges`'; do
  grep -Fq "$legacy_authority_contract" \
    "$script_dir/audit-security-migration-recovery.sh"
done
grep -Fq 'assert_container_stopped openbmb-api' "$script_dir/rotate-livekit-secret.sh"
grep -Fq 'assert_container_stopped openbmb-livekit' "$script_dir/rotate-livekit-secret.sh"
[[ "$(<"$production_dir/compatibility/security-epoch")" == 1 ]]
for livekit_config in \
  "$production_dir/../livekit/livekit.yaml" \
  "$production_dir/livekit/livekit.production.yaml"; do
  awk '
    /^[^[:space:]#]/ { section = $1 }
    section == "room:" && \
      /^[[:space:]]+auto_create:[[:space:]]*false([[:space:]]*(#.*)?)?$/ { found += 1 }
    END { exit found == 1 ? 0 : 1 }
  ' "$livekit_config" || {
    printf 'LiveKit room auto_create must be false exactly once: %s\n' "$livekit_config" >&2
    exit 1
  }
done
grep -Fq 'ExecStopPost=/bin/bash /opt/openbmb/current/infra/production/scripts/service-control.sh reload' \
  "$backup_service"
grep -Fq 'TimeoutStopSec=600' "$backup_service"
grep -Fq 'MINIO_KMS_SECRET_KEY:' "$production_dir/../compose/compose.yml"
grep -Fq 'MINIO_KMS_AUTO_ENCRYPTION: "on"' "$production_dir/../compose/compose.yml"
grep -Fq 'mc encrypt set sse-s3' "$production_dir/../minio/init-minio.sh"
grep -Fq 's3:ListBucketVersions' "$production_dir/../minio/init-minio.sh"
grep -Fq 's3:DeleteObjectVersion' "$production_dir/../minio/init-minio.sh"
grep -Fq 'zINSTREAM' "$script_dir/preflight.sh"
grep -Fq 'test "$(sudo -n stat -c %U:%G /opt/openbmb)" = root:openbmb' \
  "$delivery_workflow"
grep -Fq 'if sudo -n test -e "$release_root" || sudo -n test -L "$release_root"; then' \
  "$delivery_workflow"
grep -Fq 'sudo -n test ! -e "$incoming"' "$delivery_workflow"
grep -Fq 'sudo -n env OPENBMB_DOMAIN=sun227454.online bash' "$delivery_workflow"
grep -Fq 'CREATE INDEX `remote_participants_ticket_status_expiry_idx`' \
  "$join_ticket_migration"
grep -Fq '@@index([joinTicketStatus, joinTicketExpiresAt], map: "remote_participants_ticket_status_expiry_idx")' \
  "$server_schema"
grep -Fq '@@index([join_ticket_status, join_ticket_expires_at], map: "remote_participants_ticket_status_expiry_idx")' \
  "$reference_schema"
grep -Fq 'provider = "mysql"' "$migration_lock"
[[ "$(grep -Ec '^[[:space:]]*ALTER TABLE' "$key_capability_migration")" -eq 1 ]]
! grep -Eq '^[[:space:]]*(START TRANSACTION|UPDATE|COMMIT)[[:space:];]' \
  "$key_capability_migration"
! grep -Eq 'ADD COLUMN .* DEFAULT' "$key_capability_migration"
[[ "$(grep -Ec '^[[:space:]]*ADD CONSTRAINT' "$key_capability_migration")" -eq 3 ]]
grep -Fq 'devices_active_key_protection_check' "$key_capability_migration"
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
grep -Fq 'MINIO_KMS_AUTO_ENCRYPTION: "on"' <<<"$resolved" || {
  printf 'MinIO SSE-S3 auto-encryption invariant is missing\n' >&2
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

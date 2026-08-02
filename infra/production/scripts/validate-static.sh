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
bash "$script_dir/test-clamav-watchdog.sh"
bash "$script_dir/test-image-import.sh"
bash "$script_dir/test-image-transfer.sh"
bash "$script_dir/test-cutover-caddy.sh"
bash "$script_dir/test-ssh-master.sh"

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
health_check_script="$script_dir/health-check.sh"
clamav_check_script="$script_dir/verify-clamav.sh"
clamav_watchdog_script="$script_dir/clamav-watchdog.sh"
smtp_check_script="$script_dir/verify-smtp.sh"
backup_service="$production_dir/systemd/openbmb-backup.service"
stack_service="$production_dir/systemd/openbmb.service"
clamav_watchdog_service="$production_dir/systemd/openbmb-clamav-watchdog.service"
clamav_watchdog_timer="$production_dir/systemd/openbmb-clamav-watchdog.timer"
rollback_script="$script_dir/rollback-release.sh"
delivery_workflow="$project_root/.github/workflows/production-delivery.yml"
production_compose="$production_dir/compose.production.yml"
release_image_set="$script_dir/release-image-set.sh"
image_import_script="$script_dir/import-release-image.sh"
image_transfer_script="$script_dir/transfer-release-images.sh"
cutover_script="$script_dir/cutover-caddy.sh"
ssh_master_script="$script_dir/ensure-ssh-master.sh"
production_api_env="$production_dir/env/api.env.example"
key_capability_migration="$project_root/apps/server-api/prisma/migrations/20260802151000_require_non_exportable_device_key_protection/migration.sql"
join_ticket_migration="$project_root/apps/server-api/prisma/migrations/20260802141000_one_time_remote_join_tickets/migration.sql"
server_schema="$project_root/apps/server-api/prisma/schema.prisma"
reference_schema="$project_root/docs/refactor/database/schema.prisma"
migration_lock="$project_root/apps/server-api/prisma/migrations/migration_lock.toml"

source "$release_image_set"
openbmb_load_release_image_set git-000000000000
[[ "${#OPENBMB_REQUIRED_IMAGES[@]}" -eq 10 ]]
[[ "${#OPENBMB_SOURCE_IMAGES[@]}" -eq 10 ]]
[[ "${#OPENBMB_DELIVERY_COMPONENTS[@]}" -eq 10 ]]
[[ "${OPENBMB_REQUIRED_IMAGES[9]}" == openbmb-clamav:git-000000000000 ]]
[[ "${OPENBMB_SOURCE_IMAGES[9]}" == clamav/clamav-debian:1.4.5_base ]]
[[ "${OPENBMB_DELIVERY_COMPONENTS[9]}" == clamav ]]

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
  'bash "$script_dir/preflight.sh" --skip-clamav-runtime' \
  'bash "$script_dir/verify-release-images.sh"'
assert_before "$deploy_script" \
  'bash "$script_dir/verify-release-images.sh"' \
  'bash "$script_dir/verify-smtp.sh"'
assert_before "$deploy_script" \
  'bash "$script_dir/verify-smtp.sh"' \
  "printf 'Starting and validating the same-host ClamAV scanner before state changes."
assert_before "$deploy_script" \
  'bash "$script_dir/verify-smtp.sh"' \
  'deployment_mutated=true'
assert_before "$smtp_check_script" \
  'bash "$script_dir/verify-release-images.sh"' \
  'bash "$script_dir/compose.sh" run \'
assert_before "$deploy_script" \
  'post_clamav_disk_kib=' \
  'mv -Tf -- "$temporary_link" "$current_link"'
awk '
  /clamav_target_attempted=true/ {
    in_target_bootstrap = 1
    target_up = 0
    target_watchdog = 0
    next
  }
  in_target_bootstrap && /bash "\$script_dir\/compose.sh" up -d --pull never --no-build clamav/ {
    target_up += 1
  }
  in_target_bootstrap && /bash "\$script_dir\/clamav-watchdog.sh"/ {
    target_watchdog += 1
  }
  in_target_bootstrap && /post_clamav_disk_kib=/ {
    checked_target_bootstrap = 1
    exit target_up == 1 && target_watchdog == 1 ? 0 : 1
  }
  END { if (!checked_target_bootstrap) exit 1 }
' "$deploy_script"
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
grep -Fq 'bash "$script_dir/clamav-watchdog.sh"' \
  "$service_control_script"
[[ "$(grep -Fc 'bash "$script_dir/clamav-watchdog.sh"' "$service_control_script")" -eq 2 ]]
grep -Fq 'bash "$script_dir/verify-clamav.sh" --once' "$backup_script"
grep -Fq 'bash "$current_stack/infra/production/scripts/clamav-watchdog.sh"' \
  "$rollback_script"
[[ "$(grep -Fc 'verify-clamav.sh" --once' "$rollback_script")" -ge 1 ]]
grep -Fq 'recovery_services+=(clamav)' "$deploy_script"
grep -Fq 'up -d --pull never --no-build "${recovery_services[@]}"' "$deploy_script"
! grep -Fq 'bash "$recovery_stack/infra/production/scripts/verify-clamav.sh"' \
  "$deploy_script"
grep -Fq 'Restoring the previous release ClamAV image after deployment failure.' \
  "$deploy_script"
grep -Fq 'Keeping the attested target ClamAV scanner for the active pre-ClamAV application stack.' \
  "$deploy_script"
grep -Fq 'existing_clamav_image" =~ ^openbmb-clamav:' "$deploy_script"
grep -Fq 'bash "$old_clamav_watchdog"' "$deploy_script"
grep -Fq 'previous ClamAV stack has no full freshness watchdog; keeping it stopped.' \
  "$deploy_script"
grep -Fq 'clamav_target_attested=true' "$deploy_script"
grep -Fq 'clamav_recovery_attested=true' "$deploy_script"
grep -Fq 'if [[ "$clamav_recovery_attested" == true ]]' "$deploy_script"
assert_before "$deploy_script" \
  'bash "$script_dir/clamav-watchdog.sh"' \
  'clamav_target_attested=true'
assert_before "$deploy_script" \
  'clamav_target_attested=true' \
  'post_clamav_disk_kib='
awk '
  /if \[\[ "\$old_stack_has_clamav" == true \]\]/ {
    in_old_restore = 1
  }
  in_old_restore && /bash "\$old_clamav_watchdog"/ {
    full_watchdog = 1
  }
  in_old_restore && /previous ClamAV stack has no full freshness watchdog/ {
    missing_watchdog_fail_closed = 1
  }
  in_old_restore && /elif \[\[ -n "\$old_application_target" \]\]/ {
    checked_old_restore = 1
    exit full_watchdog && missing_watchdog_fail_closed ? 0 : 1
  }
  END { if (!checked_old_restore) exit 1 }
' "$deploy_script"
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
grep -Fq 'rm --force --stop clamav' "$deploy_script"
grep -Fq 'post_clamav_docker_kib=' "$deploy_script"
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
    /^[^[:space:]#]/ { section = $1; sub(/\r$/, "", section) }
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
grep -Fq 'TimeoutStopSec=3600' "$backup_service"
grep -Fq 'RuntimeDirectoryPreserve=yes' "$backup_service"
grep -Fq 'ReadWritePaths=/var/backups/openbmb /run/lock /run/openbmb' \
  "$backup_service"
grep -Fq 'TimeoutStartSec=3600' "$stack_service"
grep -Fq 'TimeoutStopSec=120' "$stack_service"
grep -Fq 'SuccessExitStatus=75' "$clamav_watchdog_service"
grep -Fq 'TimeoutStartSec=3600' "$clamav_watchdog_service"
grep -Fq 'TimeoutStopSec=120' "$clamav_watchdog_service"
grep -Fq 'RuntimeDirectory=openbmb' "$clamav_watchdog_service"
grep -Fq 'RuntimeDirectoryPreserve=yes' "$clamav_watchdog_service"
grep -Fq 'DOCKER_CONFIG=/tmp/openbmb-watchdog-docker-config' \
  "$clamav_watchdog_service"
grep -Fq 'OnUnitActiveSec=15m' "$clamav_watchdog_timer"
grep -Fq 'MINIO_KMS_SECRET_KEY:' "$production_dir/../compose/compose.yml"
grep -Fq 'MINIO_KMS_AUTO_ENCRYPTION: "on"' "$production_dir/../compose/compose.yml"
grep -Fq 'mc encrypt set sse-s3' "$production_dir/../minio/init-minio.sh"
grep -Fq 's3:ListBucketVersions' "$production_dir/../minio/init-minio.sh"
grep -Fq 's3:DeleteObjectVersion' "$production_dir/../minio/init-minio.sh"
grep -Fq 'zINSTREAM' "$clamav_check_script"
grep -Fq '/run/lock/openbmb-operation.lock' "$clamav_watchdog_script"
grep -Fq 'SuccessExitStatus=75' "$clamav_watchdog_service"
grep -Fq '/proc/[0-9]*/comm' "$clamav_watchdog_script"
grep -Fq '/var/lib/clamav/daily.cvd' "$clamav_watchdog_script"
grep -Fq '/var/lib/clamav/daily.cld' "$clamav_watchdog_script"
grep -Fq 'sigtool --info "$database"' "$clamav_watchdog_script"
grep -Fq 'printf "zVERSION\0"' "$clamav_watchdog_script"
grep -Fq '[[ "$disk_version" == "$loaded_version" ]]' "$clamav_watchdog_script"
grep -Fq 'max_signature_age_seconds=259200' "$clamav_watchdog_script"
grep -Fq 'minimum_recovery_interval_seconds=3600' "$clamav_watchdog_script"
grep -Fq 'attestation_grace_seconds=180' "$clamav_watchdog_script"
grep -Fq 'auxiliary_wait_seconds=900' "$clamav_watchdog_script"
grep -Fq "trap 'stop_on_signal 143' TERM" "$clamav_watchdog_script"
grep -Fq 'watchdog_state_dir=/run/openbmb' "$clamav_watchdog_script"
grep -Fq '[[ ! -L "$watchdog_state_dir" ]]' "$clamav_watchdog_script"
grep -Fq 'com.docker.compose.project' "$clamav_watchdog_script"
grep -Fq 'docker stop --time 90 openbmb-clamav' "$clamav_watchdog_script"
grep -Fq 'stop --timeout 90 clamav' "$clamav_watchdog_script"
grep -Fq -- '--force-recreate clamav' "$clamav_watchdog_script"
grep -Fq 'bash "$script_dir/verify-clamav.sh" --wait' "$clamav_watchdog_script"
grep -Fq 'bash "$script_dir/compose.sh" run \' "$smtp_check_script"
grep -Fq -- '--no-deps' "$smtp_check_script"
grep -Fq -- '--pull never' "$smtp_check_script"
grep -Fq '/run/lock/openbmb-operation.lock' "$smtp_check_script"
grep -Fq 'export OPENBMB_APPLICATION_RELEASE="$release_id"' "$smtp_check_script"
grep -Fq 'SMTP_PASSWORD=.*(CHANGE_ME|REPLACE_WITH)' "$smtp_check_script"
grep -Fq 'await adapter.onModuleInit();' "$smtp_check_script"
! grep -Fq 'sendMail' "$smtp_check_script"
! grep -Eq -- '--env([=[:space:]]+)[^[:space:]]*SMTP_PASSWORD' "$smtp_check_script"
grep -Fq 'DOCKER_CONFIG=/tmp/openbmb-backup-docker-config' "$backup_service"
grep -Fq 'bash "$script_dir/verify-clamav.sh" --once' "$script_dir/preflight.sh"
grep -Fq "docker info --format '{{.DockerRootDir}}'" "$script_dir/preflight.sh"
grep -Fq 'assert_unique_env_keys "$secret_file"' "$script_dir/preflight.sh"
grep -Fq '3145728' "$script_dir/preflight.sh"
grep -Fq 'bash "$script_dir/verify-clamav.sh" --once' "$health_check_script"
grep -Fq 'openbmb-clamav:$release_id' "$release_image_set"
grep -Fq 'clamav/clamav-debian:1.4.5_base' "$release_image_set"
grep -Fq '127.0.0.1:${CLAMAV_HOST_PORT:-13310}:3310' "$production_compose"
grep -Fq 'clamav_database:/var/lib/clamav' "$production_compose"
grep -Fq 'CLAMD_CONF_ConcurrentDatabaseReload: "no"' "$production_compose"
grep -Fq 'CLAMD_CONF_StreamMaxLength: 100M' "$production_compose"
grep -Fq 'FRESHCLAM_CONF_TestDatabases: "no"' "$production_compose"
grep -Fq 'CLAMD_CONF_MaxThreads: "1"' "$production_compose"
grep -Fq 'CLAMD_CONF_MaxConnectionQueueLength: "2"' "$production_compose"
grep -Fxq 'SMTP_HOST=smtp.qq.com' "$production_api_env"
grep -Fxq 'SMTP_PORT=465' "$production_api_env"
grep -Fxq 'SMTP_SECURE=true' "$production_api_env"
grep -Fxq 'SMTP_REQUIRE_TLS=false' "$production_api_env"
grep -Fq 'test "$(sudo -n stat -c %U:%G /opt/openbmb)" = root:openbmb' \
  "$delivery_workflow"
grep -Fq 'if sudo -n test -e "$release_root" || sudo -n test -L "$release_root"; then' \
  "$delivery_workflow"
grep -Fq 'sudo -n test ! -e "$incoming"' "$delivery_workflow"
grep -Fq 'sudo -n env OPENBMB_DOMAIN=sun227454.online bash' "$delivery_workflow"
grep -Fq 'test "${docker_free_kib:-0}" -ge 4194304' "$delivery_workflow"
grep -Fq '"containerd-snapshotter": true' "$delivery_workflow"
grep -Fq 'io.containerd.snapshotter.v1' "$delivery_workflow"
grep -Fq "docker image inspect --format '{{.Descriptor.digest}}'" "$delivery_workflow"
assert_before "$delivery_workflow" \
  'name: Use stable OCI image identities on the runner' \
  'name: Build immutable application images'
assert_before "$delivery_workflow" \
  'name: Verify stable OCI image identities' \
  'name: Publish exact release transport images to GHCR'
grep -Fq 'ConnectTimeout 20' "$delivery_workflow"
grep -Fq 'ConnectionAttempts 1' "$delivery_workflow"
grep -Fq 'ControlMaster no' "$delivery_workflow"
grep -Fq 'Host tx4h4g-prod tx4h4g-prod-lane-*' "$delivery_workflow"
grep -Fq 'ControlPath ~/.ssh/openbmb-%n-%C' "$delivery_workflow"
grep -Fq 'ControlPersist 130m' "$delivery_workflow"
grep -Fq 'ProxyCommand /bin/false' "$delivery_workflow"
grep -Fq 'timeout-minutes: 360' "$delivery_workflow"
[[ "$(grep -Fc 'bash infra/production/scripts/ensure-ssh-master.sh tx4h4g-prod 6 5' \
  "$delivery_workflow")" -eq 8 ]]
grep -Fq 'for lane in {1..8}; do' "$delivery_workflow"
grep -Fq '"tx4h4g-prod-lane-$lane" 6 5' "$delivery_workflow"
grep -Fq 'OPENBMB_TRANSFER_SSH_LANES=8' "$delivery_workflow"
grep -Fq 'OPENBMB_TRANSFER_CHUNK_BYTES=8388608' "$delivery_workflow"
grep -Fq 'bash infra/production/scripts/transfer-release-images.sh \' "$delivery_workflow"
! grep -Fq 'pull-release-images.sh' "$delivery_workflow"
! grep -Fq 'printf '\''%s\n'\'' "$GHCR_TOKEN" | ssh' "$delivery_workflow"
grep -Fq '/run/lock/openbmb-operation.lock' "$image_import_script"
grep -Fq 'minimum_free_kib=4194304' "$image_import_script"
grep -Fq 'cat -- "${chunk_paths[@]}" | sha256sum' "$image_import_script"
grep -Fq 'gzip -dc | docker load' "$image_import_script"
grep -Fq 'OCI revision differs' "$image_import_script"
grep -Fq 'cmp --silent "$expected_manifest" "$host_manifest"' "$image_import_script"
assert_before "$image_import_script" \
  'for index in "${!OPENBMB_REQUIRED_IMAGES[@]}"; do' \
  'mv -- "$script_dir/$host_manifest_tmp" "$host_manifest"'
grep -Fq 'docker save --output "$raw_archive" "$image_name"' "$image_transfer_script"
grep -Fq 'split --bytes="$chunk_size_bytes"' "$image_transfer_script"
grep -Fq 'Reused verified chunk' "$image_transfer_script"
grep -Fq 'for upload_attempt in {1..6}; do' "$image_transfer_script"
grep -Fq 'cmp --silent "$expected_manifest" "$host_manifest_incoming"' "$image_transfer_script"
grep -Fq 'assert_transfer_lock_alive' "$image_transfer_script"
grep -Fq '"$ssh_command" "$@" </dev/null' "$image_transfer_script"
grep -Fq '"$scp_command" "$@" </dev/null' "$image_transfer_script"
grep -Fq ') </dev/null &' "$image_transfer_script"
grep -Fq 'kill -TERM "$transfer_owner_pid"' "$image_transfer_script"
grep -Fq 'transfer_lane_count="${OPENBMB_TRANSFER_SSH_LANES:-1}"' "$image_transfer_script"
grep -Fq 'chunk_size_bytes="${OPENBMB_TRANSFER_CHUNK_BYTES:-33554432}"' "$image_transfer_script"
grep -Fq 'ensure_data_lane "$lane_host"' "$image_transfer_script"
grep -Fq 'bash "$ssh_master_file" "$lane_host" 3 2' "$image_transfer_script"
grep -Fq 'probe_remote_chunk "$lane_host" "$candidate_partial"' "$image_transfer_script"
grep -Fq 'mv -Tf -- \"\$partial\" \"\$final\"' "$image_transfer_script"
! grep -Fq 'rm -f -- \"\$final\"' "$image_transfer_script"
grep -Fq -- "-name 'part-*.partial-*' -delete" "$image_transfer_script"
grep -Fq 'kill "$upload_pid" >/dev/null 2>&1 || true' "$image_transfer_script"
grep -Fq 'wait "$upload_pid" >/dev/null 2>&1 || true' "$image_transfer_script"
[[ "$(grep -Fc 'worker_spawn_in_progress=true' "$image_transfer_script")" -eq 3 ]]
grep -Fq 'pending_owner_signal_status="$signal_status"' "$image_transfer_script"
grep -Fq 'upload_child_spawn_in_progress=true' "$image_transfer_script"
grep -Fq 'pending_upload_signal_status="$signal_status"' "$image_transfer_script"
assert_before "$image_transfer_script" \
  'exec {transfer_lock_write_fd}>&-' \
  'while IFS= read -r _unexpected_lock_output'
! grep -Fq 'GHCR_TOKEN' "$image_transfer_script"
! grep -Fq 'docker login' "$image_transfer_script"
grep -Fq 'run_child "$ssh_command" -MNf \' "$ssh_master_script"
grep -Fq -- '-o ProxyCommand=none' "$ssh_master_script"
grep -Fq -- '-o ControlMaster=yes' "$ssh_master_script"
grep -Fq '"$ssh_command" -O check "$ssh_host"' "$ssh_master_script"
grep -Fq '"$ssh_command" -G -T "$ssh_host"' "$ssh_master_script"
grep -Fq '"$attempts" -le 6' "$ssh_master_script"
grep -Fq 'kill "$ssh_child_pid" >/dev/null 2>&1 || true' "$ssh_master_script"
grep -Fq 'wait "$ssh_child_pid" >/dev/null 2>&1 || true' "$ssh_master_script"
grep -Fq 'ssh_child_spawn_in_progress=true' "$ssh_master_script"
grep -Fq '"$@" </dev/null &' "$ssh_master_script"
grep -Fq 'pending_signal_status="$signal_status"' "$ssh_master_script"
grep -Fq 'validate_existing_control_socket' "$ssh_master_script"
grep -Fq 'rm -f -- "$control_path"' "$ssh_master_script"
! grep -Eq '\$ssh_command.*(bash|sudo|sh)[[:space:]]' "$ssh_master_script"
grep -Fq "trap 'rollback_public 129' HUP" "$cutover_script"
grep -Fq "trap 'rollback_public 130' INT" "$cutover_script"
grep -Fq "trap 'rollback_public 143' TERM" "$cutover_script"
grep -Fq 'initial_caddy_enable_state="$(systemctl is-enabled caddy' "$cutover_script"
grep -Fq 'systemctl disable caddy || true' "$cutover_script"
assert_before "$cutover_script" \
  'public_mutation_started=true' \
  'published="$("${campus_cutover_compose[@]}" port "$frontend_service" 80)"'
assert_before "$cutover_script" \
  'systemctl enable caddy' \
  'cutover_complete=true'
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

service_block() {
  local service="$1"
  awk -v header="  $service:" '
    $0 == header { inside = 1; print; next }
    inside && /^  [A-Za-z0-9_-]+:$/ { exit }
    inside { print }
  ' <<<"$resolved"
}

api_block="$(service_block api)"
clamav_block="$(service_block clamav)"

grep -Fq 'CLAMAV_HOST: 127.0.0.1' <<<"$api_block" || {
  printf 'API same-host ClamAV address invariant is missing\n' >&2
  exit 1
}
grep -Fq 'CLAMAV_PORT: "13310"' <<<"$api_block" || {
  printf 'API same-host ClamAV port invariant is missing\n' >&2
  exit 1
}
grep -A2 -F '    clamav:' <<<"$api_block" | grep -Fq 'condition: service_healthy' || {
  printf 'API does not require healthy ClamAV\n' >&2
  exit 1
}
grep -Fq 'image: openbmb-clamav:static-validation' <<<"$clamav_block" || {
  printf 'ClamAV does not use the release-scoped image\n' >&2
  exit 1
}
[[ "$(grep -Fc 'host_ip: 127.0.0.1' <<<"$clamav_block")" -eq 1 && \
   "$(grep -Fc 'published: "13310"' <<<"$clamav_block")" -eq 1 ]] || {
  printf 'ClamAV must publish exactly one loopback port\n' >&2
  exit 1
}
[[ "$(grep -Fc 'clamav_egress: null' <<<"$resolved")" -eq 1 ]] || {
  printf 'only ClamAV may join the signature-update egress network\n' >&2
  exit 1
}
! grep -Eq '^[[:space:]]+(private|web|host_access): null$' <<<"$clamav_block" || {
  printf 'ClamAV must not join application data networks\n' >&2
  exit 1
}
grep -Fq 'source: clamav_database' <<<"$clamav_block" || {
  printf 'ClamAV signature volume invariant is missing\n' >&2
  exit 1
}
grep -Fq 'mem_limit: "1610612736"' <<<"$clamav_block" || {
  printf 'ClamAV memory limit invariant is missing\n' >&2
  exit 1
}
grep -Fq 'memswap_limit: "2147483648"' <<<"$clamav_block" || {
  printf 'ClamAV memory+swap limit invariant is missing\n' >&2
  exit 1
}

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
grep -Fq 'published: "13310"' <<<"$resolved" || {
  printf 'ClamAV loopback publish invariant is missing\n' >&2
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

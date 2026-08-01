#!/usr/bin/env bash
set -Eeuo pipefail

migration_150000='20260802150000_invalidate_legacy_exportable_device_credentials'
migration_151000='20260802151000_require_non_exportable_device_key_protection'

fail() {
  printf 'SECURITY MIGRATION AUDIT: %s\n' "$*" >&2
  exit 1
}

is_nonnegative_integer() {
  [[ "$1" =~ ^(0|[1-9][0-9]*)$ ]]
}

classify_150000() {
  local unsafe_count="$1"
  local migration_marker_count="$2"

  is_nonnegative_integer "$unsafe_count" || return 2
  is_nonnegative_integer "$migration_marker_count" || return 2
  if (( unsafe_count == 0 )); then
    printf 'applied\n'
  elif (( migration_marker_count == 0 )); then
    printf 'rolled-back\n'
  else
    printf 'manual-review\n'
  fi
}

classify_151000() {
  local column_count="$1"
  local valid_column_count="$2"
  local constraint_count="$3"
  local enforced_constraint_count="$4"

  for value in "$column_count" "$valid_column_count" \
    "$constraint_count" "$enforced_constraint_count"; do
    is_nonnegative_integer "$value" || return 2
  done
  if (( column_count == 2 && valid_column_count == 2 && \
        constraint_count == 3 && enforced_constraint_count == 3 )); then
    printf 'applied\n'
  elif (( column_count == 0 && constraint_count == 0 )); then
    printf 'rolled-back\n'
  else
    printf 'manual-review\n'
  fi
}

write_history_query() {
  local selected_migration="$1"

  case "$selected_migration" in
    "$migration_150000"|"$migration_151000") ;;
    *) return 2 ;;
  esac
  printf "SET @openbmb_migration_name = '%s';\n" "$selected_migration"
  # This delimiter must remain quoted: the MySQL identifier backticks are
  # data for mysql, never Bash command substitutions.
  cat <<'SQL'
SELECT CONCAT(
  COUNT(*), CHAR(9), COALESCE(MAX(`checksum`), '')
)
FROM `_prisma_migrations`
WHERE
  `migration_name` = @openbmb_migration_name
  AND `finished_at` IS NULL
  AND `rolled_back_at` IS NULL;
SQL
}

run_self_test() {
  local history_query

  [[ "$(classify_150000 0 0)" == applied ]]
  [[ "$(classify_150000 7 0)" == rolled-back ]]
  [[ "$(classify_150000 1 1)" == manual-review ]]
  [[ "$(classify_151000 2 2 3 3)" == applied ]]
  [[ "$(classify_151000 0 0 0 0)" == rolled-back ]]
  [[ "$(classify_151000 1 1 0 0)" == manual-review ]]
  [[ "$(classify_151000 2 1 3 3)" == manual-review ]]
  history_query="$(write_history_query "$migration_150000")"
  grep -Fq 'FROM `_prisma_migrations`' <<<"$history_query"
  grep -Fq "SET @openbmb_migration_name = '$migration_150000';" \
    <<<"$history_query"
  printf 'Security migration recovery classifier fixtures: OK\n'
}

if [[ "${1:-}" == --self-test ]]; then
  [[ $# -eq 1 ]] || fail '--self-test accepts no additional arguments'
  run_self_test
  exit 0
fi

if [[ $# -ne 1 ]]; then
  printf 'usage: %s <%s|%s>\n' "${BASH_SOURCE[0]}" \
    "$migration_150000" "$migration_151000" >&2
  exit 2
fi
migration_name="$1"
case "$migration_name" in
  "$migration_150000"|"$migration_151000") ;;
  *) fail 'only the two security-boundary migrations may be audited' ;;
esac

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_root="$(CDPATH= cd -- "$script_dir/../../.." && pwd -P)"
security_epoch_script="$script_dir/security-epoch.sh"
migration_file="$project_root/apps/server-api/prisma/migrations/$migration_name/migration.sql"

case "${OPENBMB_OPERATION_LOCK_HELD:-false}" in
  false)
    exec flock --exclusive --wait 0 --conflict-exit-code 75 \
      /run/lock/openbmb-operation.lock \
      env OPENBMB_OPERATION_LOCK_HELD=true bash "${BASH_SOURCE[0]}" "$@"
    ;;
  true) ;;
  *) fail 'OPENBMB_OPERATION_LOCK_HELD must be true or false' ;;
esac

[[ -f "$migration_file" && ! -L "$migration_file" ]] || \
  fail "migration file is missing or unsafe: $migration_file"
if bash "$security_epoch_script" pending-exists; then
  :
else
  pending_status=$?
  if [[ "$pending_status" -eq 3 ]]; then
    fail 'recovery audit requires a pending security boundary'
  fi
  exit "$pending_status"
fi

assert_container_stopped() {
  local container_name="$1"
  local container_ids
  local running

  container_ids="$(
    docker container ls --all --format '{{.ID}} {{.Names}}' |
      awk -v expected="$container_name" '$2 == expected { print $1 }'
  )"
  [[ "$container_ids" != *$'\n'* ]] || \
    fail "multiple containers unexpectedly use the $container_name name"
  [[ -n "$container_ids" ]] || return 0
  running="$(docker inspect --format '{{.State.Running}}' "$container_ids")"
  [[ "$running" == false ]] || \
    fail "$container_name must remain stopped during migration recovery"
}

assert_container_stopped openbmb-api
assert_container_stopped openbmb-livekit

mysql_scalar() {
  bash "$script_dir/compose.sh" exec -T mysql sh -ceu '
    MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql \
      --protocol=socket --user=root --batch --skip-column-names \
      "$MYSQL_DATABASE"
  '
}

history_record="$(write_history_query "$migration_name" | mysql_scalar | tr -d '\r')"
IFS=$'\t' read -r unresolved_count recorded_checksum <<<"$history_record"
[[ "$unresolved_count" == 1 ]] || \
  fail "expected exactly one unresolved failed record, found ${unresolved_count:-invalid}"
local_checksum="$(sha256sum "$migration_file" | awk '{ print $1 }')"
[[ "$recorded_checksum" == "$local_checksum" ]] || \
  fail 'the failed Prisma record checksum does not match this immutable release'

classification=''
details=''
if [[ "$migration_name" == "$migration_150000" ]]; then
  engine_contract="$(mysql_scalar <<'SQL' | tr -d '\r\n'
SELECT CONCAT(
  COUNT(*), '|', SUM(UPPER(`engine`) = 'INNODB')
)
FROM `information_schema`.`tables`
WHERE
  `table_schema` = DATABASE()
  AND `table_name` IN (
    'remote_session_participants',
    'remote_assistance_sessions',
    'companion_bindings',
    'model_sessions',
    'companion_sessions',
    'device_credentials',
    'device_binding_events',
    'devices',
    'device_activation_challenges'
  );
SQL
)"
  [[ "$engine_contract" == '9|9' ]] || \
    fail "all nine transaction participants must be InnoDB, got $engine_contract"

  migration_state="$(mysql_scalar <<'SQL' | tr -d '\r\n'
SELECT CONCAT(
  (
    (SELECT COUNT(*)
      FROM `remote_session_participants`
      WHERE `join_ticket_status` IN ('ISSUING', 'ISSUED', 'CONSUMED')) +
    (SELECT COUNT(*)
      FROM `remote_assistance_sessions`
      WHERE `status` IN ('RINGING', 'ACCEPTED', 'CONNECTING', 'ACTIVE', 'ENDING')) +
    (SELECT COUNT(*)
      FROM `model_sessions`
      WHERE `status` = 'ACTIVE') +
    (SELECT COUNT(*)
      FROM `companion_sessions`
      WHERE `status` = 'ACTIVE') +
    (SELECT COUNT(*)
      FROM `device_credentials`
      WHERE `revoked_at` IS NULL) +
    (SELECT COUNT(*)
      FROM `companion_bindings`
      WHERE `status` <> 'REVOKED') +
    (SELECT COUNT(*)
      FROM `devices`
      WHERE `status` <> 'REVOKED') +
    (SELECT COUNT(*) FROM `device_activation_challenges`
      WHERE `status` IN ('PENDING', 'CLAIMED', 'APPROVED'))
  ),
  '|',
  (
    (SELECT COUNT(*) FROM `device_binding_events`
      WHERE `reason_code` = 'LEGACY_EXPORTABLE_KEY_INVALIDATED') +
    (SELECT COUNT(*) FROM `remote_assistance_sessions`
      WHERE `end_reason` = 'LEGACY_DEVICE_KEY_REVOKED') +
    (SELECT COUNT(*) FROM `companion_sessions`
      WHERE `end_reason` = 'LEGACY_DEVICE_KEY_REVOKED') +
    (SELECT COUNT(*) FROM `model_sessions`
      WHERE `end_reason` = 'LEGACY_DEVICE_KEY_REVOKED')
  )
);
SQL
)"
  IFS='|' read -r unsafe_count migration_marker_count <<<"$migration_state"
  classification="$(classify_150000 "$unsafe_count" "$migration_marker_count")" || \
    fail "invalid migration-state counters: $migration_state"
  details="unsafe=$unsafe_count migration-markers=$migration_marker_count"
else
  schema_state="$(mysql_scalar <<'SQL' | tr -d '\r\n'
SELECT CONCAT(
  (SELECT COUNT(*)
    FROM `information_schema`.`columns`
    WHERE `table_schema` = DATABASE()
      AND `table_name` = 'devices'
      AND `column_name` IN ('installation_key_algorithm', 'key_protection')),
  '|',
  (SELECT COUNT(*)
    FROM `information_schema`.`columns`
    WHERE `table_schema` = DATABASE()
      AND `table_name` = 'devices'
      AND `column_name` IN ('installation_key_algorithm', 'key_protection')
      AND `is_nullable` = 'NO'
      AND `column_default` IS NULL
      AND `data_type` = 'varchar'
      AND `character_maximum_length` = 32),
  '|',
  (SELECT COUNT(*)
    FROM `information_schema`.`table_constraints`
    WHERE `table_schema` = DATABASE()
      AND `table_name` = 'devices'
      AND `constraint_type` = 'CHECK'
      AND `constraint_name` IN (
        'devices_installation_key_algorithm_check',
        'devices_key_protection_check',
        'devices_active_key_protection_check'
      )),
  '|',
  (SELECT COUNT(*)
    FROM `information_schema`.`table_constraints` AS `tc`
    JOIN `information_schema`.`check_constraints` AS `cc`
      ON `cc`.`constraint_schema` = `tc`.`constraint_schema`
      AND `cc`.`constraint_name` = `tc`.`constraint_name`
    WHERE `tc`.`table_schema` = DATABASE()
      AND `tc`.`table_name` = 'devices'
      AND `tc`.`constraint_type` = 'CHECK'
      AND `tc`.`enforced` = 'YES'
      AND (
        (`tc`.`constraint_name` = 'devices_installation_key_algorithm_check'
          AND LOCATE('REVOKED', `cc`.`check_clause`) > 0
          AND LOCATE('ED25519', `cc`.`check_clause`) > 0
          AND LOCATE('ECDSA_P256_SHA256', `cc`.`check_clause`) > 0)
        OR (`tc`.`constraint_name` = 'devices_key_protection_check'
          AND LOCATE('REVOKED', `cc`.`check_clause`) > 0
          AND LOCATE('LEGACY_UNVERIFIED', `cc`.`check_clause`) > 0
          AND LOCATE('NON_EXPORTABLE_V1', `cc`.`check_clause`) > 0)
        OR (`tc`.`constraint_name` = 'devices_active_key_protection_check'
          AND LOCATE('REVOKED', `cc`.`check_clause`) > 0
          AND LOCATE('NON_EXPORTABLE_V1', `cc`.`check_clause`) > 0)
      ))
);
SQL
)"
  IFS='|' read -r column_count valid_column_count \
    constraint_count enforced_constraint_count <<<"$schema_state"
  classification="$(classify_151000 "$column_count" "$valid_column_count" \
    "$constraint_count" "$enforced_constraint_count")" || \
    fail "invalid schema-state counters: $schema_state"
  details="columns=$column_count valid-columns=$valid_column_count constraints=$constraint_count valid-enforced-constraints=$enforced_constraint_count"
fi

printf 'Migration: %s\n' "$migration_name"
printf 'Verified immutable checksum: %s\n' "$local_checksum"
printf 'Observed state: %s\n' "$details"
if [[ "$classification" == manual-review ]]; then
  printf 'Resolution: REFUSED. Mixed state requires a reviewed forward repair; do not run prisma migrate resolve.\n' >&2
  exit 1
fi

printf 'Resolution candidate: --%s\n' "$classification"
printf 'This audit is read-only. After reviewing _prisma_migrations.logs, run exactly one approved resolve command, then prisma migrate deploy.\n'
printf '  sudo -n bash %q --profile tools run --rm --pull never migrate ../../node_modules/.bin/prisma migrate resolve --%s %q\n' \
  "$script_dir/compose.sh" "$classification" "$migration_name"

#!/usr/bin/env bash
set -Eeuo pipefail

project_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
migration="$project_root/apps/server-api/prisma/migrations/20260802150000_invalidate_legacy_exportable_device_credentials/migration.sql"
capability_migration="$project_root/apps/server-api/prisma/migrations/20260802151000_require_non_exportable_device_key_protection/migration.sql"
mysql_container="${OPENBMB_MYSQL_CONTAINER:-openbmb-mysql}"

[[ -f "$migration" ]] || {
  printf 'legacy device-key migration is missing\n' >&2
  exit 1
}
[[ -f "$capability_migration" ]] || {
  printf 'device key-capability migration is missing\n' >&2
  exit 1
}

mysql_exec() {
  docker exec -i "$mysql_container" sh -ec '
    exec mysql --protocol=socket --user=root \
      --password="$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"
  '
}

mysql_scalar() {
  docker exec -i "$mysql_container" sh -ec '
    exec mysql --protocol=socket --user=root \
      --password="$MYSQL_ROOT_PASSWORD" --batch --skip-column-names \
      "$MYSQL_DATABASE"
  '
}

cleanup_fixture() {
  mysql_exec >/dev/null <<'SQL' || true
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `devices_key_capability_migration_fixture`;
DELETE FROM `device_binding_events` WHERE `binding_id` IN (
  '01K1K000000000000000000002',
  '01K1K000000000000000000012',
  '01K1K000000000000000000025'
);
DELETE FROM `remote_session_participants` WHERE `id` IN (
  '01K1K000000000000000000006',
  '01K1K000000000000000000016'
);
DELETE FROM `remote_assistance_sessions` WHERE `id` IN (
  '01K1K000000000000000000005',
  '01K1K000000000000000000015'
);
DELETE FROM `model_sessions` WHERE `id` IN (
  '01K1K000000000000000000009',
  '01K1K000000000000000000028'
);
DELETE FROM `companion_sessions` WHERE `id` IN (
  '01K1K000000000000000000008',
  '01K1K000000000000000000027'
);
DELETE FROM `device_credentials` WHERE `id` IN (
  '01K1K000000000000000000003',
  '01K1K000000000000000000013'
);
DELETE FROM `device_activation_challenges` WHERE `id` IN (
  '01K1K000000000000000000010',
  '01K1K000000000000000000017'
);
DELETE FROM `companion_bindings` WHERE `id` IN (
  '01K1K000000000000000000002',
  '01K1K000000000000000000012',
  '01K1K000000000000000000025'
);
DELETE FROM `devices` WHERE `id` IN (
  '01K1K000000000000000000001',
  '01K1K000000000000000000011',
  '01K1K000000000000000000024'
);
DELETE FROM `prompt_versions` WHERE `id` = '01K1K000000000000000000019';
DELETE FROM `care_recipients` WHERE `id` IN (
  '01K1K000000000000000000021',
  '01K1K000000000000000000023',
  '01K1K000000000000000000026'
);
DELETE FROM `household_members` WHERE `id` = '01K1K000000000000000000022';
DELETE FROM `households` WHERE `id` = '01K1K000000000000000000020';
DELETE FROM `users` WHERE `id` = '01K1K000000000000000000029';
ALTER TABLE `devices`
  ALTER CHECK `devices_active_key_protection_check` ENFORCED;
SET FOREIGN_KEY_CHECKS = 1;
SQL
}

failure_migration="$(mktemp "${TMPDIR:-/tmp}/openbmb-legacy-migration.XXXXXX.sql")"
capability_fixture_migration="$(mktemp "${TMPDIR:-/tmp}/openbmb-capability-migration.XXXXXX.sql")"
capability_failure_migration="$(mktemp "${TMPDIR:-/tmp}/openbmb-capability-failure.XXXXXX.sql")"
trap 'rm -f -- "$failure_migration" "$capability_fixture_migration" "$capability_failure_migration"; cleanup_fixture' EXIT
cleanup_fixture

sed \
  -e 's/`devices`/`devices_key_capability_migration_fixture`/g' \
  -e 's/devices_installation_key_algorithm_check/fixture_installation_key_algorithm_check/g' \
  -e 's/devices_key_protection_check/fixture_key_protection_check/g' \
  -e 's/devices_active_key_protection_check/fixture_active_key_protection_check/g' \
  "$capability_migration" >"$capability_fixture_migration"
sed '$s/;$/, ADD CONSTRAINT `fixture_forced_failure_check` CHECK (0);/' \
  "$capability_fixture_migration" >"$capability_failure_migration"

mysql_exec >/dev/null <<'SQL'
CREATE TABLE `devices_key_capability_migration_fixture` (
  `id` CHAR(26) NOT NULL PRIMARY KEY,
  `installation_public_key` BLOB NOT NULL,
  `status` VARCHAR(32) NOT NULL
) ENGINE=InnoDB;
INSERT INTO `devices_key_capability_migration_fixture` (`id`, `installation_public_key`, `status`)
VALUES ('01K1K000000000000000000099', UNHEX('01020304'), 'REVOKED');
SQL

if mysql_exec <"$capability_failure_migration" >/dev/null 2>&1; then
  printf 'fault-injected key-capability ALTER unexpectedly committed\n' >&2
  exit 1
fi
capability_failure_state="$(mysql_scalar <<'SQL' | tr -d '\r\n'
SELECT CONCAT_WS('|',
  (SELECT COUNT(*) FROM `information_schema`.`columns`
    WHERE `table_schema` = DATABASE()
      AND `table_name` = 'devices_key_capability_migration_fixture'
      AND `column_name` IN ('installation_key_algorithm', 'key_protection')),
  (SELECT COUNT(*) FROM `information_schema`.`table_constraints`
    WHERE `table_schema` = DATABASE()
      AND `table_name` = 'devices_key_capability_migration_fixture'
      AND `constraint_name` IN (
        'fixture_installation_key_algorithm_check',
        'fixture_key_protection_check',
        'fixture_active_key_protection_check',
        'fixture_forced_failure_check'
      )),
  (SELECT COUNT(*) FROM `devices_key_capability_migration_fixture`)
);
SQL
)"
[[ "$capability_failure_state" == '0|0|1' ]] || {
  printf 'failed key-capability ALTER left partial DDL: %s\n' \
    "$capability_failure_state" >&2
  exit 1
}

mysql_exec <"$capability_fixture_migration" >/dev/null
capability_fixture_state="$(mysql_scalar <<'SQL' | tr -d '\r\n'
SELECT CONCAT_WS('|',
  (SELECT GROUP_CONCAT(
    CONCAT(`column_name`, ':', `is_nullable`, ':', COALESCE(`column_default`, '<NULL>'))
    ORDER BY `ordinal_position` SEPARATOR ','
  ) FROM `information_schema`.`columns`
    WHERE `table_schema` = DATABASE()
      AND `table_name` = 'devices_key_capability_migration_fixture'
      AND `column_name` IN ('installation_key_algorithm', 'key_protection')),
  (SELECT GROUP_CONCAT(CONCAT(`constraint_name`, ':', `enforced`)
    ORDER BY `constraint_name` SEPARATOR ',')
  FROM `information_schema`.`table_constraints`
    WHERE `table_schema` = DATABASE()
      AND `table_name` = 'devices_key_capability_migration_fixture'
      AND `constraint_name` IN (
        'fixture_installation_key_algorithm_check',
        'fixture_key_protection_check',
        'fixture_active_key_protection_check'
      )),
  (SELECT CONCAT(`installation_key_algorithm`, ':', `key_protection`)
    FROM `devices_key_capability_migration_fixture`
    WHERE `id` = '01K1K000000000000000000099')
);
SQL
)"
[[ "$capability_fixture_state" == \
  'installation_key_algorithm:NO:<NULL>,key_protection:NO:<NULL>|fixture_active_key_protection_check:YES,fixture_installation_key_algorithm_check:YES,fixture_key_protection_check:YES|:' ]] || {
  printf 'key-capability atomic ALTER contract is invalid: %s\n' \
    "$capability_fixture_state" >&2
  exit 1
}
if printf '%s\n' \
  "INSERT INTO devices_key_capability_migration_fixture (id, installation_public_key, status) VALUES ('01K1K000000000000000000098', UNHEX('05'), 'ACTIVE');" |
  mysql_exec >/dev/null 2>&1; then
  printf 'strict legacy insert bypassed required device capability columns\n' >&2
  exit 1
fi
if printf '%s\n' \
  "SET SESSION sql_mode = '';" \
  "INSERT INTO devices_key_capability_migration_fixture (id, installation_public_key, status) VALUES ('01K1K000000000000000000098', UNHEX('05'), 'ACTIVE');" |
  mysql_exec >/dev/null 2>&1; then
  printf 'non-strict legacy insert bypassed the active-key CHECK constraint\n' >&2
  exit 1
fi

device_key_schema_contract="$(mysql_scalar <<'SQL' | tr -d '\r\n'
SELECT GROUP_CONCAT(
  CONCAT(
    `column_name`, ':', `is_nullable`, ':',
    COALESCE(`column_default`, '<NULL>')
  )
  ORDER BY `ordinal_position` SEPARATOR '|'
)
FROM `information_schema`.`columns`
WHERE
  `table_schema` = DATABASE()
  AND `table_name` = 'devices'
  AND `column_name` IN ('installation_key_algorithm', 'key_protection');
SQL
)"
[[ "$device_key_schema_contract" == 'installation_key_algorithm:NO:<NULL>|key_protection:NO:<NULL>' ]] || {
  printf 'device key capability columns are not required/no-default: %s\n' \
    "$device_key_schema_contract" >&2
  exit 1
}

device_key_constraint_contract="$(mysql_scalar <<'SQL' | tr -d '\r\n'
SELECT GROUP_CONCAT(CONCAT(`constraint_name`, ':', `enforced`)
  ORDER BY `constraint_name` SEPARATOR '|')
FROM `information_schema`.`table_constraints`
WHERE
  `table_schema` = DATABASE()
  AND `table_name` = 'devices'
  AND `constraint_name` IN (
    'devices_installation_key_algorithm_check',
    'devices_key_protection_check',
    'devices_active_key_protection_check'
  );
SQL
)"
[[ "$device_key_constraint_contract" == \
  'devices_active_key_protection_check:YES|devices_installation_key_algorithm_check:YES|devices_key_protection_check:YES' ]] || {
  printf 'device key capability CHECK constraints are missing or disabled: %s\n' \
    "$device_key_constraint_contract" >&2
  exit 1
}

mysql_exec >/dev/null <<'SQL'
ALTER TABLE `devices`
  ALTER CHECK `devices_active_key_protection_check` NOT ENFORCED;

INSERT INTO `users` (
  `id`, `display_name`, `status`, `created_at`, `updated_at`, `version`
) VALUES (
  '01K1K000000000000000000029', 'migration-fixture-user', 'ACTIVE',
  '2026-01-01 00:00:00.000', '2026-01-01 00:00:00.000', 0
);

INSERT INTO `households` (
  `id`, `name`, `status`, `created_by_user_id`,
  `created_at`, `updated_at`, `version`
) VALUES (
  '01K1K000000000000000000020', 'migration-fixture-household', 'ACTIVE',
  '01K1K000000000000000000029',
  '2026-01-01 00:00:00.000', '2026-01-01 00:00:00.000', 0
);

INSERT INTO `household_members` (
  `id`, `household_id`, `user_id`, `status`, `joined_at`,
  `created_at`, `updated_at`, `version`
) VALUES (
  '01K1K000000000000000000022', '01K1K000000000000000000020',
  '01K1K000000000000000000029', 'ACTIVE', '2026-01-01 00:00:00.000',
  '2026-01-01 00:00:00.000', '2026-01-01 00:00:00.000', 0
);

INSERT INTO `care_recipients` (
  `id`, `household_id`, `name`, `preferred_name`, `status`,
  `created_at`, `updated_at`, `version`
) VALUES
  (
    '01K1K000000000000000000021', '01K1K000000000000000000020',
    'migration-recipient-active', 'active', 'ACTIVE',
    '2026-01-01 00:00:00.000', '2026-01-01 00:00:00.000', 0
  ),
  (
    '01K1K000000000000000000023', '01K1K000000000000000000020',
    'migration-recipient-pre-revoked', 'pre-revoked', 'ACTIVE',
    '2026-01-01 00:00:00.000', '2026-01-01 00:00:00.000', 0
  ),
  (
    '01K1K000000000000000000026', '01K1K000000000000000000020',
    'migration-recipient-second', 'second', 'ACTIVE',
    '2026-01-01 00:00:00.000', '2026-01-01 00:00:00.000', 0
  );

INSERT INTO `prompt_versions` (
  `id`, `code`, `version`, `provider`, `model`, `content_hash`,
  `content_ciphertext`, `content_nonce`, `encryption_key_id`, `published_at`
) VALUES (
  '01K1K000000000000000000019', 'migration-fixture', 1,
  'MODELBEST', 'MiniCPM-o-4.5', UNHEX(REPEAT('71', 32)), UNHEX('01'),
  UNHEX(REPEAT('72', 24)), 'migration-fixture-key', '2026-01-01 00:00:00.000'
);

INSERT INTO `devices` (
  `id`, `platform`, `installation_key_fingerprint`,
  `installation_public_key`, `installation_key_algorithm`,
  `key_protection`, `status`,
  `created_at`, `updated_at`, `version`
) VALUES
  (
    '01K1K000000000000000000001', 'ANDROID', UNHEX(REPEAT('11', 32)),
    UNHEX('01020304'), 'ED25519', 'LEGACY_UNVERIFIED', 'ACTIVE',
    '2026-01-01 00:00:00.000', '2026-01-01 00:00:00.000', 3
  ),
  (
    '01K1K000000000000000000011', 'WEB', UNHEX(REPEAT('12', 32)),
    UNHEX('05060708'), 'ED25519', 'LEGACY_UNVERIFIED', 'REVOKED',
    '2026-01-01 00:00:00.000', '2026-01-01 00:00:00.000', 7
  ),
  (
    '01K1K000000000000000000024', 'ANDROID', UNHEX(REPEAT('13', 32)),
    UNHEX('090A0B0C'), 'ED25519', 'LEGACY_UNVERIFIED', 'ACTIVE',
    '2026-01-01 00:00:00.000', '2026-01-01 00:00:00.000', 14
  );

INSERT INTO `companion_bindings` (
  `id`, `device_id`, `household_id`, `recipient_id`, `display_name`,
  `status`, `activated_by_member_id`, `activated_at`, `revoked_at`,
  `binding_version`, `created_at`, `updated_at`, `version`
) VALUES
  (
    '01K1K000000000000000000002', '01K1K000000000000000000001',
    '01K1K000000000000000000020', '01K1K000000000000000000021',
    'legacy-active', 'ACTIVE', '01K1K000000000000000000022',
    '2026-01-01 00:00:00.000', NULL, 4,
    '2026-01-01 00:00:00.000', '2026-01-01 00:00:00.000', 5
  ),
  (
    '01K1K000000000000000000012', '01K1K000000000000000000011',
    '01K1K000000000000000000020', '01K1K000000000000000000023',
    'already-revoked', 'REVOKED', '01K1K000000000000000000022',
    '2026-01-01 00:00:00.000', '2026-01-02 00:00:00.000', 8,
    '2026-01-01 00:00:00.000', '2026-01-02 00:00:00.000', 9
  ),
  (
    '01K1K000000000000000000025', '01K1K000000000000000000024',
    '01K1K000000000000000000020', '01K1K000000000000000000026',
    'second-active', 'ACTIVE', '01K1K000000000000000000022',
    '2026-01-01 00:00:00.000', NULL, 15,
    '2026-01-01 00:00:00.000', '2026-01-01 00:00:00.000', 16
  );

INSERT INTO `device_credentials` (
  `id`, `binding_id`, `credential_hash`, `credential_family_id`,
  `device_key_thumbprint`, `issued_at`, `expires_at`, `revoked_at`
) VALUES
  (
    '01K1K000000000000000000003', '01K1K000000000000000000002',
    UNHEX(REPEAT('21', 32)), '01K1K000000000000000000004',
    UNHEX(REPEAT('31', 32)), '2026-01-01 00:00:00.000',
    '2027-01-01 00:00:00.000', NULL
  ),
  (
    '01K1K000000000000000000013', '01K1K000000000000000000012',
    UNHEX(REPEAT('22', 32)), '01K1K000000000000000000014',
    UNHEX(REPEAT('32', 32)), '2026-01-01 00:00:00.000',
    '2027-01-01 00:00:00.000', NULL
  );

INSERT INTO `remote_assistance_sessions` (
  `id`, `household_id`, `recipient_id`, `binding_id`,
  `initiated_by_member_id`, `answer_mode`, `requested_media`, `status`,
  `livekit_room_name`, `requested_at`, `accepted_at`,
  `consent_snapshot_json`, `trace_id`, `created_at`, `updated_at`, `version`
) VALUES
  (
    '01K1K000000000000000000005', '01K1K000000000000000000020',
    '01K1K000000000000000000021', '01K1K000000000000000000002',
    '01K1K000000000000000000022', 'ONSITE_CONFIRMATION', '7', 'ACTIVE',
    'migration-active-room', '2026-01-01 01:00:00.000',
    '2026-01-01 01:00:01.000', JSON_OBJECT('recording', false),
    'migration-active-trace', '2026-01-01 01:00:00.000',
    '2026-01-01 01:00:01.000', 6
  ),
  (
    '01K1K000000000000000000015', '01K1K000000000000000000020',
    '01K1K000000000000000000023', '01K1K000000000000000000012',
    '01K1K000000000000000000022', 'ONSITE_CONFIRMATION', '7', 'ACTIVE',
    'migration-pre-revoked-binding-room', '2026-01-01 02:00:00.000',
    '2026-01-01 02:00:01.000', JSON_OBJECT('recording', false),
    'migration-pre-revoked-binding-trace', '2026-01-01 02:00:00.000',
    '2026-01-02 00:00:00.000', 10
  );

INSERT INTO `remote_session_participants` (
  `id`, `session_id`, `principal_type`, `role`, `client_type`,
  `join_ticket_id`, `join_ticket_status`, `join_ticket_issued_at`, `created_at`
) VALUES
  (
    '01K1K000000000000000000006', '01K1K000000000000000000005',
    'DEVICE', 'DEVICE', 'ANDROID', '01K1K000000000000000000007',
    'ISSUED', '2026-01-01 01:00:01.000', '2026-01-01 01:00:01.000'
  ),
  (
    '01K1K000000000000000000016', '01K1K000000000000000000015',
    'DEVICE', 'DEVICE', 'ANDROID', '01K1K000000000000000000018',
    'ISSUED', '2026-01-01 02:00:01.000', '2026-01-01 02:00:01.000'
  );

INSERT INTO `companion_sessions` (
  `id`, `household_id`, `recipient_id`, `binding_id`, `mode`, `status`,
  `care_snapshot_hash`, `consent_snapshot_json`, `started_at`, `trace_id`,
  `created_at`, `version`
) VALUES
  (
    '01K1K000000000000000000008', '01K1K000000000000000000020',
    '01K1K000000000000000000021', '01K1K000000000000000000002',
    'COMPANION', 'ACTIVE', UNHEX(REPEAT('41', 32)),
    JSON_OBJECT('model', true), '2026-01-01 00:30:00.000',
    'migration-companion-trace', '2026-01-01 00:30:00.000', 11
  ),
  (
    '01K1K000000000000000000027', '01K1K000000000000000000020',
    '01K1K000000000000000000023', '01K1K000000000000000000012',
    'COMPANION', 'ACTIVE', UNHEX(REPEAT('42', 32)),
    JSON_OBJECT('model', true), '2026-01-01 02:30:00.000',
    'migration-pre-revoked-companion-trace', '2026-01-01 02:30:00.000', 17
  );

INSERT INTO `model_sessions` (
  `id`, `companion_session_id`, `provider`, `model`, `prompt_version_id`,
  `status`, `started_at`, `created_at`
) VALUES
  (
    '01K1K000000000000000000009', '01K1K000000000000000000008',
    'MODELBEST', 'MiniCPM-o-4.5', '01K1K000000000000000000019',
    'ACTIVE', '2026-01-01 00:30:00.000', '2026-01-01 00:30:00.000'
  ),
  (
    '01K1K000000000000000000028', '01K1K000000000000000000027',
    'MODELBEST', 'MiniCPM-o-4.5', '01K1K000000000000000000019',
    'ACTIVE', '2026-01-01 02:30:00.000', '2026-01-01 02:30:00.000'
  );

INSERT INTO `device_activation_challenges` (
  `id`, `public_id`, `flow`, `household_id`, `recipient_id`,
  `pending_device_id`, `secret_hash`, `status`, `issued_by_member_id`,
  `expires_at`, `created_at`, `updated_at`, `version`
) VALUES
  (
    '01K1K000000000000000000010', 'MIGRATION-ACTIVE', 'QR',
    '01K1K000000000000000000020', '01K1K000000000000000000021',
    '01K1K000000000000000000001', UNHEX(REPEAT('51', 32)), 'APPROVED',
    '01K1K000000000000000000022', '2027-01-01 00:00:00.000',
    '2026-01-01 00:00:00.000', '2026-01-01 00:00:00.000', 12
  ),
  (
    '01K1K000000000000000000017', 'MIGRATION-CANCELLED', 'QR',
    '01K1K000000000000000000020', '01K1K000000000000000000023',
    '01K1K000000000000000000011', UNHEX(REPEAT('52', 32)), 'CANCELLED',
    '01K1K000000000000000000022', '2027-01-01 00:00:00.000',
    '2026-01-01 00:00:00.000', '2026-01-02 00:00:00.000', 13
  );
SQL

sed '/^COMMIT;$/i SIGNAL SQLSTATE '\''45000'\'' SET MESSAGE_TEXT = '\''fixture rollback'\'';' \
  "$migration" > "$failure_migration"

if mysql_exec < "$failure_migration" >/dev/null 2>&1; then
  printf 'fault-injected migration unexpectedly committed\n' >&2
  exit 1
fi

rollback_state="$(mysql_scalar <<'SQL' | tr -d '\r\n'
SELECT CONCAT_WS('|',
  (SELECT `status` FROM `companion_bindings` WHERE `id` = '01K1K000000000000000000002'),
  (SELECT `revoked_at` IS NULL FROM `device_credentials` WHERE `id` = '01K1K000000000000000000003'),
  (SELECT `status` FROM `remote_assistance_sessions` WHERE `id` = '01K1K000000000000000000005'),
  (SELECT `join_ticket_status` FROM `remote_session_participants` WHERE `id` = '01K1K000000000000000000006'),
  (SELECT `status` FROM `companion_sessions` WHERE `id` = '01K1K000000000000000000008'),
  (SELECT `status` FROM `model_sessions` WHERE `id` = '01K1K000000000000000000009'),
  (SELECT `status` FROM `devices` WHERE `id` = '01K1K000000000000000000001'),
  (SELECT `status` FROM `device_activation_challenges` WHERE `id` = '01K1K000000000000000000010'),
  (SELECT COUNT(*) FROM `device_binding_events`
    WHERE `binding_id` = '01K1K000000000000000000002'
      AND `reason_code` = 'LEGACY_EXPORTABLE_KEY_INVALIDATED'),
  (SELECT `revoked_at` IS NULL FROM `device_credentials` WHERE `id` = '01K1K000000000000000000013'),
  (SELECT `status` FROM `remote_assistance_sessions` WHERE `id` = '01K1K000000000000000000015'),
  (SELECT `join_ticket_status` FROM `remote_session_participants` WHERE `id` = '01K1K000000000000000000016'),
  (SELECT `status` FROM `companion_sessions` WHERE `id` = '01K1K000000000000000000027'),
  (SELECT `status` FROM `model_sessions` WHERE `id` = '01K1K000000000000000000028'),
  (SELECT `status` FROM `companion_bindings` WHERE `id` = '01K1K000000000000000000012'),
  (SELECT `version` FROM `companion_bindings` WHERE `id` = '01K1K000000000000000000012'),
  (SELECT COUNT(*) FROM `device_binding_events`
    WHERE `binding_id` = '01K1K000000000000000000012'
      AND `reason_code` = 'LEGACY_EXPORTABLE_KEY_INVALIDATED')
);
SQL
)"
[[ "$rollback_state" == 'ACTIVE|1|ACTIVE|ISSUED|ACTIVE|ACTIVE|ACTIVE|APPROVED|0|1|ACTIVE|ISSUED|ACTIVE|ACTIVE|REVOKED|9|0' ]] || {
  printf 'fault-injected migration left partial state: %s\n' "$rollback_state" >&2
  exit 1
}

mysql_exec < "$migration" >/dev/null
mysql_exec >/dev/null <<'SQL'
ALTER TABLE `devices`
  ALTER CHECK `devices_active_key_protection_check` ENFORCED;
SQL

committed_state="$(mysql_scalar <<'SQL' | tr -d '\r\n'
SELECT CONCAT_WS('|',
  (SELECT `status` FROM `companion_bindings` WHERE `id` = '01K1K000000000000000000002'),
  (SELECT `revoked_at` IS NOT NULL FROM `device_credentials` WHERE `id` = '01K1K000000000000000000003'),
  (SELECT `status` FROM `remote_assistance_sessions` WHERE `id` = '01K1K000000000000000000005'),
  (SELECT `join_ticket_status` FROM `remote_session_participants` WHERE `id` = '01K1K000000000000000000006'),
  (SELECT `status` FROM `companion_sessions` WHERE `id` = '01K1K000000000000000000008'),
  (SELECT `status` FROM `model_sessions` WHERE `id` = '01K1K000000000000000000009'),
  (SELECT `status` FROM `devices` WHERE `id` = '01K1K000000000000000000001'),
  (SELECT `status` FROM `device_activation_challenges` WHERE `id` = '01K1K000000000000000000010'),
  (SELECT COUNT(*) FROM `device_binding_events`
    WHERE `binding_id` = '01K1K000000000000000000002'
      AND `reason_code` = 'LEGACY_EXPORTABLE_KEY_INVALIDATED'),
  (SELECT COUNT(*) FROM `device_binding_events`
    WHERE `binding_id` = '01K1K000000000000000000002'
      AND `id` REGEXP '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  (SELECT COUNT(DISTINCT `id`) FROM `device_binding_events`
    WHERE `binding_id` IN (
      '01K1K000000000000000000002',
      '01K1K000000000000000000025'
    ) AND `reason_code` = 'LEGACY_EXPORTABLE_KEY_INVALIDATED'),
  (SELECT COUNT(*) FROM `device_binding_events`
    WHERE `binding_id` IN (
      '01K1K000000000000000000002',
      '01K1K000000000000000000025'
    ) AND `id` REGEXP '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  (SELECT `revoked_at` IS NOT NULL FROM `device_credentials` WHERE `id` = '01K1K000000000000000000013'),
  (SELECT `status` FROM `remote_assistance_sessions` WHERE `id` = '01K1K000000000000000000015'),
  (SELECT `join_ticket_status` FROM `remote_session_participants` WHERE `id` = '01K1K000000000000000000016'),
  (SELECT `status` FROM `companion_sessions` WHERE `id` = '01K1K000000000000000000027'),
  (SELECT `status` FROM `model_sessions` WHERE `id` = '01K1K000000000000000000028'),
  (SELECT `status` FROM `companion_bindings` WHERE `id` = '01K1K000000000000000000012'),
  (SELECT `version` FROM `companion_bindings` WHERE `id` = '01K1K000000000000000000012'),
  (SELECT COUNT(*) FROM `device_binding_events`
    WHERE `binding_id` = '01K1K000000000000000000012'
      AND `reason_code` = 'LEGACY_EXPORTABLE_KEY_INVALIDATED')
);
SQL
)"
[[ "$committed_state" == 'REVOKED|1|REVOKED|REVOKED|ENDED|ENDED|REVOKED|CANCELLED|1|1|2|2|1|REVOKED|REVOKED|ENDED|ENDED|REVOKED|9|0' ]] || {
  printf 'committed migration state is invalid: %s\n' "$committed_state" >&2
  exit 1
}

timestamp_count="$(mysql_scalar <<'SQL' | tr -d '\r\n'
SELECT COUNT(DISTINCT `migration_timestamp`)
FROM (
  SELECT `revoked_at` AS `migration_timestamp`
  FROM `companion_bindings` WHERE `id` = '01K1K000000000000000000002'
  UNION ALL
  SELECT `updated_at` FROM `devices` WHERE `id` = '01K1K000000000000000000001'
  UNION ALL
  SELECT `ended_at` FROM `remote_assistance_sessions` WHERE `id` = '01K1K000000000000000000005'
  UNION ALL
  SELECT `join_ticket_revoked_at` FROM `remote_session_participants` WHERE `id` = '01K1K000000000000000000006'
  UNION ALL
  SELECT `ended_at` FROM `companion_sessions` WHERE `id` = '01K1K000000000000000000008'
  UNION ALL
  SELECT `ended_at` FROM `model_sessions` WHERE `id` = '01K1K000000000000000000009'
  UNION ALL
  SELECT `occurred_at` FROM `device_binding_events`
  WHERE `binding_id` = '01K1K000000000000000000002'
    AND `reason_code` = 'LEGACY_EXPORTABLE_KEY_INVALIDATED'
) AS `migration_times`;
SQL
)"
[[ "$timestamp_count" == 1 ]] || {
  printf 'migration timestamps were not consistent\n' >&2
  exit 1
}

versions_before_repeat="$(mysql_scalar <<'SQL' | tr -d '\r\n'
SELECT CONCAT_WS('|',
  (SELECT `version` FROM `companion_bindings` WHERE `id` = '01K1K000000000000000000002'),
  (SELECT `version` FROM `devices` WHERE `id` = '01K1K000000000000000000001'),
  (SELECT COUNT(*) FROM `device_binding_events`
    WHERE `binding_id` = '01K1K000000000000000000002'
      AND `reason_code` = 'LEGACY_EXPORTABLE_KEY_INVALIDATED')
);
SQL
)"
mysql_exec < "$migration" >/dev/null
versions_after_repeat="$(mysql_scalar <<'SQL' | tr -d '\r\n'
SELECT CONCAT_WS('|',
  (SELECT `version` FROM `companion_bindings` WHERE `id` = '01K1K000000000000000000002'),
  (SELECT `version` FROM `devices` WHERE `id` = '01K1K000000000000000000001'),
  (SELECT COUNT(*) FROM `device_binding_events`
    WHERE `binding_id` = '01K1K000000000000000000002'
      AND `reason_code` = 'LEGACY_EXPORTABLE_KEY_INVALIDATED')
);
SQL
)"
[[ "$versions_after_repeat" == "$versions_before_repeat" ]] || {
  printf 'legacy invalidation migration is not idempotent\n' >&2
  exit 1
}

printf 'Legacy device-key migration upgrade, pre-revoked residual cleanup, rollback and ULID invariants: OK\n'

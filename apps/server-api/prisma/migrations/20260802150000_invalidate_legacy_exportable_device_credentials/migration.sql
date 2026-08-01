-- Releases before this migration allowed some clients to persist exportable
-- device signing keys. There is no trustworthy server-side signal that can
-- distinguish those installations from protected keys, so fail closed and
-- require every pre-existing device to complete family-approved activation
-- again after the clients have generated non-exportable keys.

-- Prisma does not wrap MySQL migrations in a transaction. These related DML
-- statements form one security boundary, so they must either all commit or
-- all roll back. Reuse one timestamp for consistent terminal/audit records.
START TRANSACTION;

SET @migration_now = CURRENT_TIMESTAMP(3);
SET @ulid_alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
SET @migration_milliseconds = CAST(
  ROUND(UNIX_TIMESTAMP(@migration_now) * 1000) AS UNSIGNED
);
SET @ulid_time_prefix = CONCAT(
  SUBSTRING(@ulid_alphabet, ((@migration_milliseconds >> 45) & 31) + 1, 1),
  SUBSTRING(@ulid_alphabet, ((@migration_milliseconds >> 40) & 31) + 1, 1),
  SUBSTRING(@ulid_alphabet, ((@migration_milliseconds >> 35) & 31) + 1, 1),
  SUBSTRING(@ulid_alphabet, ((@migration_milliseconds >> 30) & 31) + 1, 1),
  SUBSTRING(@ulid_alphabet, ((@migration_milliseconds >> 25) & 31) + 1, 1),
  SUBSTRING(@ulid_alphabet, ((@migration_milliseconds >> 20) & 31) + 1, 1),
  SUBSTRING(@ulid_alphabet, ((@migration_milliseconds >> 15) & 31) + 1, 1),
  SUBSTRING(@ulid_alphabet, ((@migration_milliseconds >> 10) & 31) + 1, 1),
  SUBSTRING(@ulid_alphabet, ((@migration_milliseconds >> 5) & 31) + 1, 1),
  SUBSTRING(@ulid_alphabet, (@migration_milliseconds & 31) + 1, 1)
);

UPDATE `remote_session_participants` AS `participant`
JOIN `remote_assistance_sessions` AS `session`
  ON `session`.`id` = `participant`.`session_id`
JOIN `companion_bindings` AS `binding`
  ON `binding`.`id` = `session`.`binding_id`
SET
  `participant`.`join_ticket_status` = 'REVOKED',
  `participant`.`join_ticket_revoked_at` = COALESCE(
    `participant`.`join_ticket_revoked_at`,
    @migration_now
  )
WHERE
  `participant`.`join_ticket_status` IN ('ISSUING', 'ISSUED', 'CONSUMED');

UPDATE `remote_assistance_sessions` AS `session`
JOIN `companion_bindings` AS `binding`
  ON `binding`.`id` = `session`.`binding_id`
SET
  `session`.`status` = 'REVOKED',
  `session`.`ended_at` = COALESCE(`session`.`ended_at`, @migration_now),
  `session`.`ended_by_type` = 'SYSTEM',
  `session`.`ended_by_id` = NULL,
  `session`.`end_reason` = 'LEGACY_DEVICE_KEY_REVOKED',
  `session`.`updated_at` = @migration_now,
  `session`.`version` = `session`.`version` + 1
WHERE
  `session`.`status` IN ('RINGING', 'ACCEPTED', 'CONNECTING', 'ACTIVE', 'ENDING');

UPDATE `model_sessions` AS `model_session`
JOIN `companion_sessions` AS `companion_session`
  ON `companion_session`.`id` = `model_session`.`companion_session_id`
JOIN `companion_bindings` AS `binding`
  ON `binding`.`id` = `companion_session`.`binding_id`
SET
  `model_session`.`status` = 'ENDED',
  `model_session`.`ended_at` = COALESCE(
    `model_session`.`ended_at`,
    @migration_now
  ),
  `model_session`.`end_reason` = 'LEGACY_DEVICE_KEY_REVOKED'
WHERE
  `model_session`.`status` = 'ACTIVE';

UPDATE `companion_sessions` AS `companion_session`
JOIN `companion_bindings` AS `binding`
  ON `binding`.`id` = `companion_session`.`binding_id`
SET
  `companion_session`.`status` = 'ENDED',
  `companion_session`.`ended_at` = COALESCE(
    `companion_session`.`ended_at`,
    @migration_now
  ),
  `companion_session`.`end_reason` = 'LEGACY_DEVICE_KEY_REVOKED',
  `companion_session`.`version` = `companion_session`.`version` + 1
WHERE
  `companion_session`.`status` = 'ACTIVE';

UPDATE `device_credentials` AS `credential`
JOIN `companion_bindings` AS `binding`
  ON `binding`.`id` = `credential`.`binding_id`
SET `credential`.`revoked_at` = COALESCE(
  `credential`.`revoked_at`,
  @migration_now
)
WHERE `credential`.`revoked_at` IS NULL;

INSERT INTO `device_binding_events` (
  `id`,
  `binding_id`,
  `event_type`,
  `actor_type`,
  `actor_id`,
  `reason_code`,
  `occurred_at`
)
SELECT
  CONCAT(
    @ulid_time_prefix,
    SUBSTRING(@ulid_alphabet, (CONV(SUBSTRING(`binding`.`random_hex`, 1, 2), 16, 10) & 31) + 1, 1),
    SUBSTRING(@ulid_alphabet, (CONV(SUBSTRING(`binding`.`random_hex`, 3, 2), 16, 10) & 31) + 1, 1),
    SUBSTRING(@ulid_alphabet, (CONV(SUBSTRING(`binding`.`random_hex`, 5, 2), 16, 10) & 31) + 1, 1),
    SUBSTRING(@ulid_alphabet, (CONV(SUBSTRING(`binding`.`random_hex`, 7, 2), 16, 10) & 31) + 1, 1),
    SUBSTRING(@ulid_alphabet, (CONV(SUBSTRING(`binding`.`random_hex`, 9, 2), 16, 10) & 31) + 1, 1),
    SUBSTRING(@ulid_alphabet, (CONV(SUBSTRING(`binding`.`random_hex`, 11, 2), 16, 10) & 31) + 1, 1),
    SUBSTRING(@ulid_alphabet, (CONV(SUBSTRING(`binding`.`random_hex`, 13, 2), 16, 10) & 31) + 1, 1),
    SUBSTRING(@ulid_alphabet, (CONV(SUBSTRING(`binding`.`random_hex`, 15, 2), 16, 10) & 31) + 1, 1),
    SUBSTRING(@ulid_alphabet, (CONV(SUBSTRING(`binding`.`random_hex`, 17, 2), 16, 10) & 31) + 1, 1),
    SUBSTRING(@ulid_alphabet, (CONV(SUBSTRING(`binding`.`random_hex`, 19, 2), 16, 10) & 31) + 1, 1),
    SUBSTRING(@ulid_alphabet, (CONV(SUBSTRING(`binding`.`random_hex`, 21, 2), 16, 10) & 31) + 1, 1),
    SUBSTRING(@ulid_alphabet, (CONV(SUBSTRING(`binding`.`random_hex`, 23, 2), 16, 10) & 31) + 1, 1),
    SUBSTRING(@ulid_alphabet, (CONV(SUBSTRING(`binding`.`random_hex`, 25, 2), 16, 10) & 31) + 1, 1),
    SUBSTRING(@ulid_alphabet, (CONV(SUBSTRING(`binding`.`random_hex`, 27, 2), 16, 10) & 31) + 1, 1),
    SUBSTRING(@ulid_alphabet, (CONV(SUBSTRING(`binding`.`random_hex`, 29, 2), 16, 10) & 31) + 1, 1),
    SUBSTRING(@ulid_alphabet, (CONV(SUBSTRING(`binding`.`random_hex`, 31, 2), 16, 10) & 31) + 1, 1)
  ),
  `binding`.`id`,
  'REVOKED',
  'SYSTEM',
  NULL,
  'LEGACY_EXPORTABLE_KEY_INVALIDATED',
  @migration_now
FROM (
  SELECT
    `id`,
    SHA2(
      CONCAT(
        `id`,
        '|',
        CAST(@migration_now AS CHAR),
        '|LEGACY_EXPORTABLE_KEY_INVALIDATED'
      ),
      256
    ) AS `random_hex`
  FROM `companion_bindings`
  WHERE `status` <> 'REVOKED'
) AS `binding`;

UPDATE `companion_bindings`
SET
  `status` = 'REVOKED',
  `revoked_at` = COALESCE(`revoked_at`, @migration_now),
  `binding_version` = `binding_version` + 1,
  `updated_at` = @migration_now,
  `version` = `version` + 1
WHERE `status` <> 'REVOKED';

UPDATE `devices`
SET
  `status` = 'REVOKED',
  `updated_at` = @migration_now,
  `version` = `version` + 1
WHERE `status` <> 'REVOKED';

UPDATE `device_activation_challenges`
SET
  `status` = 'CANCELLED',
  `updated_at` = @migration_now,
  `version` = `version` + 1
WHERE `status` IN ('PENDING', 'CLAIMED', 'APPROVED');

COMMIT;

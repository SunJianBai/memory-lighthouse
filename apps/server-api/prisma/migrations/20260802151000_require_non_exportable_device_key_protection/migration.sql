-- The preceding 150000 migration has already revoked every legacy device,
-- binding, credential, active media session, and activation challenge. Add a
-- persisted protocol capability afterwards so none of those installations can
-- become usable again through an older registration contract.

-- MySQL commits each DDL statement independently, so express the entire schema
-- transition as one atomic InnoDB ALTER TABLE. The preceding migration has made
-- every existing device REVOKED; MySQL therefore backfills these no-default,
-- NOT NULL VARCHAR columns with its implicit empty-string value. Empty is
-- permitted only on those revoked tombstones. A new server always writes an
-- explicit supported algorithm and NON_EXPORTABLE_V1, while an older server
-- that omits the columns is rejected in both strict and non-strict SQL modes.
ALTER TABLE `devices`
  ADD COLUMN `installation_key_algorithm` VARCHAR(32) NOT NULL
    AFTER `installation_public_key`,
  ADD COLUMN `key_protection` VARCHAR(32) NOT NULL
    AFTER `installation_key_algorithm`,
  ADD CONSTRAINT `devices_installation_key_algorithm_check`
    CHECK (
      (`status` = 'REVOKED' AND `installation_key_algorithm` = '')
      OR `installation_key_algorithm` IN ('ED25519', 'ECDSA_P256_SHA256')
    ),
  ADD CONSTRAINT `devices_key_protection_check`
    CHECK (
      (`status` = 'REVOKED' AND `key_protection` = '')
      OR `key_protection` IN ('LEGACY_UNVERIFIED', 'NON_EXPORTABLE_V1')
    ),
  ADD CONSTRAINT `devices_active_key_protection_check`
    CHECK (`status` = 'REVOKED' OR `key_protection` = 'NON_EXPORTABLE_V1');

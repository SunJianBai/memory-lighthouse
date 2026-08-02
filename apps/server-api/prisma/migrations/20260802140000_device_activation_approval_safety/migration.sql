ALTER TABLE `device_activation_challenges`
    ADD COLUMN `claim_network_source` VARCHAR(32) NULL,
    ADD COLUMN `approval_idempotency_key` VARCHAR(100) NULL;

CREATE UNIQUE INDEX `device_activation_challenges_approval_idempotency_key_key`
    ON `device_activation_challenges`(`approval_idempotency_key`);

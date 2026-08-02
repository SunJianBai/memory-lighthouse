CREATE TABLE `care_command_receipts` (
    `id` CHAR(26) NOT NULL,
    `idempotency_key` VARCHAR(100) NOT NULL,
    `command_type` VARCHAR(64) NOT NULL,
    `command_fingerprint` BINARY(32) NOT NULL,
    `result_ciphertext` LONGBLOB NOT NULL,
    `result_nonce` VARBINARY(24) NOT NULL,
    `encryption_key_id` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `care_command_receipts_idempotency_key_key`(`idempotency_key`),
    INDEX `care_command_receipts_command_type_created_at_idx`(`command_type`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

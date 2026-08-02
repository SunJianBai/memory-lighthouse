ALTER TABLE `family_task_actions`
    ADD COLUMN `idempotency_key` VARCHAR(100) NULL;

UPDATE `family_task_actions`
SET `idempotency_key` = CONCAT('legacy:', `id`)
WHERE `idempotency_key` IS NULL;

ALTER TABLE `family_task_actions`
    MODIFY `idempotency_key` VARCHAR(100) NOT NULL;

CREATE UNIQUE INDEX `family_task_actions_idempotency_key_key`
    ON `family_task_actions`(`idempotency_key`);

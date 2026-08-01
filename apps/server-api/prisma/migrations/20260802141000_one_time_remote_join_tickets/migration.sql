ALTER TABLE `remote_session_participants`
    ADD COLUMN `join_ticket_id` CHAR(26) NULL,
    ADD COLUMN `join_ticket_status` VARCHAR(16) NULL,
    ADD COLUMN `join_ticket_issued_at` DATETIME(3) NULL,
    ADD COLUMN `join_ticket_expires_at` DATETIME(3) NULL,
    ADD COLUMN `join_ticket_consumed_at` DATETIME(3) NULL,
    ADD COLUMN `join_ticket_revoked_at` DATETIME(3) NULL;

CREATE UNIQUE INDEX `remote_session_participants_join_ticket_id_key`
    ON `remote_session_participants`(`join_ticket_id`);
CREATE INDEX `remote_participants_ticket_status_expiry_idx`
    ON `remote_session_participants`(`join_ticket_status`, `join_ticket_expires_at`);

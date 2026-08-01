ALTER TABLE `user_sessions`
  ADD COLUMN `purpose` VARCHAR(32) NOT NULL DEFAULT 'USER';

CREATE INDEX `user_sessions_user_id_purpose_revoked_at_expires_at_idx`
  ON `user_sessions`(`user_id`, `purpose`, `revoked_at`, `expires_at`);

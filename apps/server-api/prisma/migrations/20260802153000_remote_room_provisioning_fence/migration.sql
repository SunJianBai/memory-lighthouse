ALTER TABLE `remote_assistance_sessions`
  ADD COLUMN `room_cleanup_not_before` DATETIME(3) NULL
    AFTER `room_cleanup_completed_at`,
  ADD COLUMN `room_provisioned_at` DATETIME(3) NULL
    AFTER `room_cleanup_not_before`;

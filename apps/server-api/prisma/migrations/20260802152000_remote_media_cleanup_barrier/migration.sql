-- A terminal database status alone does not disconnect already admitted
-- self-hosted LiveKit participants. Keep a durable cleanup barrier so a room
-- deletion outage cannot release the camera/microphone lease or admit new
-- media on the same companion binding.
ALTER TABLE `remote_assistance_sessions`
  ADD COLUMN `room_cleanup_status` VARCHAR(16) NOT NULL DEFAULT 'PENDING'
    AFTER `end_reason`,
  ADD COLUMN `room_cleanup_completed_at` DATETIME(3) NULL
    AFTER `room_cleanup_status`,
  ADD CONSTRAINT `remote_sessions_room_cleanup_status_check`
    CHECK (`room_cleanup_status` IN ('PENDING', 'COMPLETED')),
  ADD INDEX `remote_sessions_cleanup_barrier_idx`
    (`status`, `room_cleanup_status`, `ended_at`);

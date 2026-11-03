-- Nullable additions preserve existing schedule and occurrence history.
ALTER TABLE `routine_schedules` ADD COLUMN `effective_from_utc` DATETIME(3) NULL;
ALTER TABLE `routine_occurrences` ADD COLUMN `closure_reason` VARCHAR(32) NULL;
ALTER TABLE `companion_sessions` ADD COLUMN `routine_configuration_hash` BINARY(32) NULL;

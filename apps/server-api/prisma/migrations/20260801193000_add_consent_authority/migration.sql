ALTER TABLE `recipient_members`
  ADD COLUMN `can_manage_consent` BOOLEAN NOT NULL DEFAULT false AFTER `can_manage_profile`;

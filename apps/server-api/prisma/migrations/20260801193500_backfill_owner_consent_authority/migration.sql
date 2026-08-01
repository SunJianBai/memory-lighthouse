UPDATE `recipient_members` AS `recipient_member`
INNER JOIN `household_member_roles` AS `member_role`
  ON `member_role`.`member_id` = `recipient_member`.`household_member_id`
INNER JOIN `roles` AS `role`
  ON `role`.`id` = `member_role`.`role_id`
  AND `role`.`scope` = 'HOUSEHOLD'
  AND `role`.`code` = 'OWNER'
SET `recipient_member`.`can_manage_consent` = true
WHERE `recipient_member`.`status` = 'ACTIVE';

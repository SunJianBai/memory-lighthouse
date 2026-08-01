-- Stable built-in roles. User-created role mutation is intentionally out of scope.
INSERT INTO `roles` (`id`, `scope`, `code`, `name`, `description`, `created_at`) VALUES
  ('01KYYD3S500F51W79C2NMV1YHQ', 'HOUSEHOLD', 'OWNER', '家庭所有者', '管理家庭成员；高风险能力仍需陪伴对象级授权。', CURRENT_TIMESTAMP(3)),
  ('01KYYD3S51FP2MWNJPA8VJZ0HF', 'HOUSEHOLD', 'CAREGIVER', '照护家属', '按陪伴对象级 Care Authority 执行照护操作。', CURRENT_TIMESTAMP(3)),
  ('01KYYD3S52NPFN6CTD97XKA7PP', 'HOUSEHOLD', 'VIEWER', '只读成员', '仅查看获准的家庭与陪伴对象资料。', CURRENT_TIMESTAMP(3)),
  ('01KYYD3S538NNSDYZEM70HEBZY', 'PLATFORM', 'ADMIN', '平台管理员', '管理平台运行信息；不自动获得家庭内容访问权。', CURRENT_TIMESTAMP(3)),
  ('01KYYD3S545TEPR6VBXHTVKXPD', 'PLATFORM', 'CONTENT_AUDITOR', '开发内容检查员', '仅在开发验收环境持 Inspection Grant 检查原文。', CURRENT_TIMESTAMP(3));

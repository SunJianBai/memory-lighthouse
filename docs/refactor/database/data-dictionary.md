# 数据字典

本文给出首版 MySQL 逻辑字段。最终字段名以 Prisma migration 为准，所有时间均为 UTC `DATETIME(3)`，所有 ID 均为 ULID `CHAR(26)`。

## 1. 公共字段

可变聚合默认包含：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `id` | `CHAR(26)` | ULID 主键 |
| `created_at` | `DATETIME(3)` | 创建时间 |
| `updated_at` | `DATETIME(3)` | 更新时间 |
| `version` | `INT` | 乐观锁版本 |
| `deleted_at` | `DATETIME(3) NULL` | 仅适用于允许软删除的内容 |

追加式事件通常只有 `id`、`occurred_at` 和创建所需快照，不提供通用更新或软删除 Interface。

## 2. 身份与权限

### `users`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `display_name` | `VARCHAR(100)` | 显示称呼 |
| `status` | `VARCHAR(32)` | `PENDING_VERIFICATION/ACTIVE/LOCKED/DELETION_PENDING/DELETED` |
| `locale` | `VARCHAR(16)` | 界面语言 |
| `timezone` | `VARCHAR(64)` | IANA 时区 |
| `deleted_at` | `DATETIME(3) NULL` | 注销进入保留期的时间 |

### `login_identities`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `user_id` | `CHAR(26)` | 所属 User |
| `type` | `VARCHAR(16)` | `EMAIL/USERNAME` |
| `value` | `VARCHAR(320)` | 展示值 |
| `normalized_value` | `VARCHAR(320)` | 规范化唯一值，使用确定性排序规则 |
| `verified_at` | `DATETIME(3) NULL` | 验证时间；用户名可在创建时视为已验证 |
| `is_primary` | `BOOLEAN` | 是否主登录标识 |

唯一约束：`(type, normalized_value)`。

### `password_credentials`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `user_id` | `CHAR(26)` | 唯一 |
| `password_hash` | `VARBINARY(255)` | 密码哈希编码，不是加密密码 |
| `algorithm` | `VARCHAR(32)` | 哈希算法 |
| `params_version` | `INT` | 参数版本 |
| `changed_at` | `DATETIME(3)` | 最后修改时间 |

### `user_sessions`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `user_id` | `CHAR(26)` | 登录 User |
| `refresh_token_hash` | `BINARY(32)` | 唯一摘要 |
| `token_family_id` | `CHAR(26)` | 令牌轮换族 |
| `client_type` | `VARCHAR(16)` | `WEB/ANDROID/ADMIN_WEB` |
| `device_id` | `CHAR(26) NULL` | 对应安装，可空 |
| `issued_at/expires_at/last_used_at` | `DATETIME(3)` | 生命周期 |
| `rotated_at/revoked_at` | `DATETIME(3) NULL` | 轮换和撤销 |
| `replaced_by_session_id` | `CHAR(26) NULL` | 轮换后继 |
| `ip_hash` | `BINARY(32) NULL` | 带服务端 Pepper 的 IP 摘要 |
| `user_agent` | `VARCHAR(512) NULL` | 客户端信息 |

### `one_time_tokens`

用于邮箱验证、重置密码和更换邮箱：`purpose`、`user_id`、`identity_id`、`token_hash`、`expires_at`、`consumed_at`、`attempt_count`。

### `roles`、`permissions`、`role_permissions`

- `roles.scope`：`PLATFORM/HOUSEHOLD`。
- `roles.code`：范围内唯一。
- `permissions.code`：全局唯一的动作字符串。
- `role_permissions`：`(role_id, permission_id)` 复合主键。

### `platform_role_assignments`、`household_member_roles`

分别为 User 分配平台角色、为 Household Member 分配家庭角色；都记录分配者和分配时间。

## 3. 家庭与陪伴对象

### `households`

`name`、`timezone`、`status`、`created_by_user_id`、`version`。

### `household_members`

`household_id`、`user_id`、`status`、`invited_by_member_id`、`joined_at`、`left_at`。唯一约束 `(household_id, user_id)`。

### `household_invitations`

`household_id`、`target_email_normalized`、`role_id`、`token_hash`、`issued_by_member_id`、`expires_at`、`accepted_at`、`revoked_at`。明文邀请令牌不入库。

### `care_recipients`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `household_id` | `CHAR(26)` | 数据隔离范围 |
| `linked_user_id` | `CHAR(26) NULL` | 未来可选的本人账号 |
| `name/preferred_name` | `VARCHAR(100)` | 姓名与日常称呼 |
| `birth_date` | `DATE NULL` | 可选生日 |
| `timezone` | `VARCHAR(64)` | 日程时区 |
| `home_label` | `VARCHAR(100) NULL` | 非精确居家标签 |
| `communication_notes_ciphertext` | `LONGBLOB NULL` | 加密沟通偏好 |
| `communication_notes_nonce` | `VARBINARY(24) NULL` | 加密 Nonce |
| `encryption_key_id` | `VARCHAR(64) NULL` | 密钥版本 |
| `status` | `VARCHAR(32)` | 当前状态 |

### `recipient_members`

陪伴对象级 Care Authority：`recipient_id`、`household_member_id`、`relationship_label`、`access_level`、`can_manage_profile`、`can_manage_routine`、`can_view_events`、`can_view_conversation`、`can_activate_device`、`can_remote_call`、`receive_notifications`、`contact_priority`、`status`。

唯一约束 `(recipient_id, household_member_id)`。

### `trusted_contacts`

`recipient_id`、可选 `household_member_id`、姓名、关系、加密电话/邮箱、优先级和是否可查看证据。它是陪伴资料，不自动获得系统权限。

## 4. 设备与激活

### `devices`

`platform`、`installation_key_fingerprint`、`installation_public_key`、`manufacturer`、`model`、`os_version`、`app_version`、`last_seen_at`、`status`。不保存 IMEI 或 Android ID。

### `companion_bindings`

| 字段 | 说明 |
| --- | --- |
| `device_id` | 当前模型下唯一 |
| `household_id/recipient_id` | 绑定目标 |
| `display_name` | 家属可识别名称 |
| `status` | `ACTIVE/SUSPENDED/REVOKED` |
| `activated_by_member_id` | 批准家属 |
| `activated_at/revoked_at` | 生命周期 |
| `binding_version` | 凭据和策略失效版本 |

### `device_binding_events`

追加记录 `ACTIVATED/SUSPENDED/RESUMED/REVOKED/REBOUND`，包含 actor、原因和时间。

### `device_activation_challenges`

`public_id`、`flow`、`household_id`、`recipient_id`、`pending_device_id`、`secret_hash`、`code_hash`、`status`、`issued_by_member_id`、`approved_by_member_id`、`expires_at`、`claimed_at`、`approved_at`、`consumed_at`、`attempt_count`、`max_attempts`。

### `device_credentials`

`binding_id`、`credential_hash`、`credential_family_id`、`device_key_thumbprint`、`issued_at`、`expires_at`、`last_used_at`、`rotated_at`、`revoked_at`。解绑时全部撤销。

## 5. 授权

### `consent_document_versions`

`code`、`version`、`content_hash`、`published_at`；唯一 `(code, version)`。

### `recipient_consent_states`

每个 Recipient 和 Scope 一个当前投影：`recipient_id`、`scope`、`decision`、`last_event_id`、`version`。

Scope 至少包括：`CAMERA`、`MICROPHONE`、`CLOUD_MODEL_PROCESSING`、`SENSITIVE_MEMORY`、`TRANSCRIPT_RETENTION`、`REMOTE_AUDIO`、`REMOTE_VIDEO`、`ADMIN_RAW_CONTENT_REVIEW`。

### `recipient_consent_events`

追加记录 `recipient_id`、`scope`、`decision`、`document_version_id`、`decided_by_member_id`、`reason`、`supersedes_event_id`、`occurred_at`。

## 6. 记忆、对象和药物资料

### `memories`

`household_id`、`recipient_id`、`kind`、`title`、`sensitivity`、`verification_status`、`status`、`current_revision_no`、`created_by_member_id`、`version`。

### `memory_revisions`

`memory_id`、`revision_no`、`content_ciphertext`、`content_nonce`、`encryption_key_id`、`content_hash`、`source`、`change_reason`、`created_by_member_id`、`created_at`。唯一 `(memory_id, revision_no)`。

### `tags`、`memory_tags`

- `tags`：家庭内名称唯一，保存 `name/normalized_name`。
- `memory_tags`：复合主键 `(memory_id, tag_id)`。

### `assets`

`household_id`、`recipient_id`、`bucket`、`object_key`、`original_name`、`mime_type`、`byte_size`、`sha256`、`kind`、`scan_status`、`encryption_key_id`、`retention_until`、`status`、`uploaded_by_member_id`。

不保存预签名 URL。关联表：`memory_assets`、`recipient_assets`、`medication_assets`、`care_event_assets`、`conversation_assets`。

### `medications`

`household_id`、`recipient_id`、`name`、`alias`、加密 purpose/requirements、`container_label`、`container_location`、`status`、`version`。只表示家属录入事实。

## 7. 日程、实例和确认

### `routines`

`household_id`、`recipient_id`、`type`、可选 `medication_id`、`title`、加密 instructions/confirmation_question、`status`、`version`。

### `routine_schedules`

`routine_id`、`timezone`、`local_time_minutes`、`weekday_mask`、`start_date`、`end_date`、`grace_minutes`、`family_notice_minutes`、`schedule_version`、`active`。

### `routine_occurrences`

`household_id`、`recipient_id`、`routine_id`、`schedule_id`、`scheduled_at_utc`、`scheduled_local_date`、`status`、`confirmation_deadline_at`、`escalation_at`、`completed_at`、`version`。唯一 `(schedule_id, scheduled_at_utc)`。

### `routine_confirmations`

`occurrence_id`、`confirmation_type`、`source`、可选 `member_id`、可选 `binding_id`、可选 `utterance_id`、`note_ciphertext`、`confirmed_at`、`idempotency_key`。

## 8. 照护事件与待办

### `care_events`

`household_id`、`recipient_id`、`type`、`severity`、`source_type`、`source_id`、可选 `routine_occurrence_id/model_session_id/remote_session_id`、加密标题/摘要、`dedupe_key`、`payload_json`、`occurred_at`。

### `family_tasks`

`household_id`、`recipient_id`、`source_event_id`、`assignee_member_id`、`status`、`priority`、`due_at`、`resolved_at`、`resolution_code`、加密 `resolution_note`、`version`。

### `family_task_actions`

追加记录 `task_id`、`actor_member_id`、`action`、`from_status`、`to_status`、加密 note 和 `occurred_at`。

## 9. 陪伴和模型会话

### `prompt_versions`

`code`、`version`、`provider`、`model`、`content_hash`、加密模板正文、`published_at`；唯一 `(code, version)`。

### `companion_sessions`

`household_id`、`recipient_id`、`binding_id`、`mode`、`status`、`care_snapshot_hash`、`consent_snapshot_json`、`started_at`、`ended_at`、`end_reason`、`trace_id`。

### `model_sessions`

`companion_session_id`、`provider`、`model`、`prompt_version_id`、`provider_session_id`、`status`、`started_at`、`ended_at`、`end_reason`、`error_code`、`first_response_at`。

### `conversation_utterances`

`model_session_id`、`sequence_no`、`speaker`、可选 `member_id/binding_id`、`provider_event_id`、`start_offset_ms`、`end_offset_ms`、`is_final`、`language`、`confidence`、`created_at`。

### `conversation_utterance_contents`

以 `utterance_id` 为主键，保存 `raw_text_ciphertext`、`nonce`、`encryption_key_id`、`content_hash`、`char_count`、`retention_until`、`purged_at`。

### `memory_usage_records`

`model_session_id`、`utterance_id`、`memory_revision_id`、`usage_type`、`rank`、`retrieval_score`，用于解释模型引用。

### `model_session_events`

只保存连接、排队、首响、打断、错误和终止等低频技术事件及非敏感指标。

## 10. 远程陪伴

### `remote_access_policies`

`binding_id`、`mode`、`camera_allowed`、`microphone_allowed`、`send_family_audio_allowed`、`countdown_seconds`、`valid_from`、`valid_until`、`local_confirmed_at`、`consent_event_id`、`status`、`version`。当前模型一条 Binding 一个当前 Policy。

### `remote_access_policy_members`

`policy_id`、`household_member_id`、`allowed_video`、`allowed_receive_audio`、`allowed_send_audio`、`valid_until`、`revoked_at`。只有白名单成员可使用预授权策略。

### `remote_assistance_sessions`

| 字段 | 说明 |
| --- | --- |
| `household_id/recipient_id/binding_id` | 目标范围 |
| `initiated_by_member_id` | 发起家属 |
| `access_policy_id` | 发起时使用的策略 |
| `answer_mode` | `MANUAL/PREAUTHORIZED_COUNTDOWN` |
| `requested_media` | 音频或音视频 |
| `status` | 请求到终止的状态机 |
| `livekit_room_name` | 随机房间名，不是加入凭据 |
| `requested/accepted/connected/ended_at` | 生命周期 |
| `ended_by_type/ended_by_id/end_reason` | 结束来源 |
| `consent_snapshot_json` | 发起时授权快照 |
| `trace_id/version` | 追踪与并发控制 |

### `remote_session_participants`

`session_id`、`principal_type`、可选 `user_id/binding_id`、`role`、`client_type`、`joined_at`、`left_at`、`published_audio`、`published_video`。

### `remote_session_events`

追加记录邀请、现场提示、接听、拒绝、Token 签发、加入/离开、轨道启停、断线恢复和结束。不得保存 SDP、ICE 或媒体内容。

## 11. 管理员检查与审计

### `inspection_grants`

`environment`、`requested_by_user_id`、`approved_by_user_id`、`household_id`、可选 `recipient_id`、`data_categories_json`、`reason`、`ticket_reference`、`status`、`valid_from`、`expires_at`、`revoked_at`。

### `content_inspections`

`grant_id`、`operator_user_id`、`resource_type`、`resource_id`、`original_revealed`、`request_id`、`occurred_at`。不复制原文。

### `audit_logs`

详见[安全文档](../07-security-and-privacy.md)。Audit Entry 追加写入，包含 actor、action、resource、household、purpose、decision、request/trace、前后哈希和哈希链字段。

## 12. 通知和 Outbox

### `notification_endpoints`

`user_id/device_id`、`channel`、`provider`、`endpoint_ciphertext`、`endpoint_hash`、`verified_at`、`status`。唯一 `(channel, endpoint_hash)`。

### `notifications`

`household_id`、`recipient_id`、`type`、`priority`、`template_code`、`template_variables_json`、`scheduled_at`、`dedupe_key`。唯一 `(household_id, dedupe_key)`。

### `notification_deliveries`

`notification_id`、`endpoint_id`、`status`、`attempt_count`、`next_attempt_at`、`provider_message_id`、`sent_at`、`delivered_at`、`last_error_code`。唯一 `(notification_id, endpoint_id)`。

### `outbox_events`、`inbox_receipts`

- Outbox：聚合、事件类型、载荷、可用时间、租约、尝试次数和发布时间。
- Inbox：消费者与事件 ID 唯一，保证至少一次投递下的副作用幂等。


-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(26) NOT NULL,
    `display_name` VARCHAR(100) NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `locale` VARCHAR(16) NOT NULL DEFAULT 'zh-CN',
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    INDEX `users_status_created_at_idx`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `login_identities` (
    `id` CHAR(26) NOT NULL,
    `user_id` CHAR(26) NOT NULL,
    `type` VARCHAR(16) NOT NULL,
    `value` VARCHAR(320) NOT NULL,
    `normalized_value` VARCHAR(320) NOT NULL,
    `verified_at` DATETIME(3) NULL,
    `is_primary` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `login_identities_user_id_idx`(`user_id`),
    UNIQUE INDEX `login_identities_type_normalized_value_key`(`type`, `normalized_value`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `password_credentials` (
    `user_id` CHAR(26) NOT NULL,
    `password_hash` VARBINARY(255) NOT NULL,
    `algorithm` VARCHAR(32) NOT NULL,
    `params_version` INTEGER NOT NULL DEFAULT 1,
    `changed_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_sessions` (
    `id` CHAR(26) NOT NULL,
    `user_id` CHAR(26) NOT NULL,
    `device_id` CHAR(26) NULL,
    `refresh_token_hash` BINARY(32) NOT NULL,
    `token_family_id` CHAR(26) NOT NULL,
    `client_type` VARCHAR(16) NOT NULL,
    `issued_at` DATETIME(3) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `last_used_at` DATETIME(3) NULL,
    `rotated_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `replaced_by_session_id` CHAR(26) NULL,
    `ip_hash` BINARY(32) NULL,
    `user_agent` VARCHAR(512) NULL,

    UNIQUE INDEX `user_sessions_refresh_token_hash_key`(`refresh_token_hash`),
    INDEX `user_sessions_user_id_revoked_at_expires_at_idx`(`user_id`, `revoked_at`, `expires_at`),
    INDEX `user_sessions_token_family_id_idx`(`token_family_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `one_time_tokens` (
    `id` CHAR(26) NOT NULL,
    `user_id` CHAR(26) NOT NULL,
    `identity_id` CHAR(26) NULL,
    `purpose` VARCHAR(32) NOT NULL,
    `token_hash` BINARY(32) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `consumed_at` DATETIME(3) NULL,
    `attempt_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `one_time_tokens_token_hash_key`(`token_hash`),
    INDEX `one_time_tokens_user_id_purpose_expires_at_idx`(`user_id`, `purpose`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` CHAR(26) NOT NULL,
    `scope` VARCHAR(16) NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `roles_scope_code_key`(`scope`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `id` CHAR(26) NOT NULL,
    `code` VARCHAR(100) NOT NULL,
    `description` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `permissions_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `role_id` CHAR(26) NOT NULL,
    `permission_id` CHAR(26) NOT NULL,

    PRIMARY KEY (`role_id`, `permission_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `platform_role_assignments` (
    `user_id` CHAR(26) NOT NULL,
    `role_id` CHAR(26) NOT NULL,
    `assigned_by_id` CHAR(26) NULL,
    `assigned_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`user_id`, `role_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `households` (
    `id` CHAR(26) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
    `status` VARCHAR(32) NOT NULL,
    `created_by_user_id` CHAR(26) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    INDEX `households_status_created_at_idx`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `household_members` (
    `id` CHAR(26) NOT NULL,
    `household_id` CHAR(26) NOT NULL,
    `user_id` CHAR(26) NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `invited_by_member_id` CHAR(26) NULL,
    `joined_at` DATETIME(3) NULL,
    `left_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    INDEX `household_members_user_id_status_idx`(`user_id`, `status`),
    UNIQUE INDEX `household_members_household_id_user_id_key`(`household_id`, `user_id`),
    UNIQUE INDEX `household_members_household_id_id_key`(`household_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `household_member_roles` (
    `member_id` CHAR(26) NOT NULL,
    `role_id` CHAR(26) NOT NULL,

    PRIMARY KEY (`member_id`, `role_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `household_invitations` (
    `id` CHAR(26) NOT NULL,
    `household_id` CHAR(26) NOT NULL,
    `target_email_normalized` VARCHAR(320) NOT NULL,
    `role_id` CHAR(26) NOT NULL,
    `token_hash` BINARY(32) NOT NULL,
    `issued_by_member_id` CHAR(26) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `accepted_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `household_invitations_token_hash_key`(`token_hash`),
    INDEX `household_invitations_household_id_expires_at_idx`(`household_id`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `care_recipients` (
    `id` CHAR(26) NOT NULL,
    `household_id` CHAR(26) NOT NULL,
    `linked_user_id` CHAR(26) NULL,
    `name` VARCHAR(100) NOT NULL,
    `preferred_name` VARCHAR(100) NOT NULL,
    `birth_date` DATE NULL,
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
    `home_label` VARCHAR(100) NULL,
    `communication_notes_ciphertext` LONGBLOB NULL,
    `communication_notes_nonce` VARBINARY(24) NULL,
    `encryption_key_id` VARCHAR(64) NULL,
    `status` VARCHAR(32) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    INDEX `care_recipients_household_id_status_idx`(`household_id`, `status`),
    UNIQUE INDEX `care_recipients_household_id_id_key`(`household_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recipient_members` (
    `id` CHAR(26) NOT NULL,
    `household_id` CHAR(26) NOT NULL,
    `recipient_id` CHAR(26) NOT NULL,
    `household_member_id` CHAR(26) NOT NULL,
    `relationship_label` VARCHAR(50) NULL,
    `access_level` VARCHAR(32) NOT NULL,
    `can_manage_profile` BOOLEAN NOT NULL DEFAULT false,
    `can_manage_routine` BOOLEAN NOT NULL DEFAULT false,
    `can_view_events` BOOLEAN NOT NULL DEFAULT false,
    `can_view_conversation` BOOLEAN NOT NULL DEFAULT false,
    `can_activate_device` BOOLEAN NOT NULL DEFAULT false,
    `can_remote_call` BOOLEAN NOT NULL DEFAULT false,
    `receive_notifications` BOOLEAN NOT NULL DEFAULT true,
    `contact_priority` INTEGER NULL,
    `status` VARCHAR(32) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    INDEX `recipient_members_household_id_status_idx`(`household_id`, `status`),
    UNIQUE INDEX `recipient_members_recipient_id_household_member_id_key`(`recipient_id`, `household_member_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `trusted_contacts` (
    `id` CHAR(26) NOT NULL,
    `household_id` CHAR(26) NOT NULL,
    `recipient_id` CHAR(26) NOT NULL,
    `household_member_id` CHAR(26) NULL,
    `name` VARCHAR(100) NOT NULL,
    `relationship_label` VARCHAR(50) NOT NULL,
    `phone_ciphertext` BLOB NULL,
    `email_ciphertext` BLOB NULL,
    `contact_nonce` VARBINARY(24) NULL,
    `encryption_key_id` VARCHAR(64) NULL,
    `priority` INTEGER NOT NULL DEFAULT 1,
    `can_view_evidence` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    INDEX `trusted_contacts_recipient_id_priority_idx`(`recipient_id`, `priority`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `devices` (
    `id` CHAR(26) NOT NULL,
    `platform` VARCHAR(16) NOT NULL,
    `installation_key_fingerprint` BINARY(32) NOT NULL,
    `installation_public_key` BLOB NOT NULL,
    `manufacturer` VARCHAR(100) NULL,
    `model` VARCHAR(100) NULL,
    `os_version` VARCHAR(64) NULL,
    `app_version` VARCHAR(32) NULL,
    `last_seen_at` DATETIME(3) NULL,
    `status` VARCHAR(32) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `devices_installation_key_fingerprint_key`(`installation_key_fingerprint`),
    INDEX `devices_status_last_seen_at_idx`(`status`, `last_seen_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `companion_bindings` (
    `id` CHAR(26) NOT NULL,
    `device_id` CHAR(26) NOT NULL,
    `household_id` CHAR(26) NOT NULL,
    `recipient_id` CHAR(26) NOT NULL,
    `display_name` VARCHAR(100) NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `activated_by_member_id` CHAR(26) NOT NULL,
    `activated_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `binding_version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `companion_bindings_device_id_key`(`device_id`),
    INDEX `companion_bindings_household_id_recipient_id_status_idx`(`household_id`, `recipient_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `device_binding_events` (
    `id` CHAR(26) NOT NULL,
    `binding_id` CHAR(26) NOT NULL,
    `event_type` VARCHAR(32) NOT NULL,
    `actor_type` VARCHAR(16) NOT NULL,
    `actor_id` CHAR(26) NULL,
    `reason_code` VARCHAR(64) NULL,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `device_binding_events_binding_id_occurred_at_idx`(`binding_id`, `occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `device_activation_challenges` (
    `id` CHAR(26) NOT NULL,
    `public_id` VARCHAR(32) NOT NULL,
    `flow` VARCHAR(32) NOT NULL,
    `household_id` CHAR(26) NOT NULL,
    `recipient_id` CHAR(26) NOT NULL,
    `pending_device_id` CHAR(26) NULL,
    `secret_hash` BINARY(32) NOT NULL,
    `code_hash` BINARY(32) NULL,
    `status` VARCHAR(32) NOT NULL,
    `issued_by_member_id` CHAR(26) NOT NULL,
    `approved_by_member_id` CHAR(26) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `claimed_at` DATETIME(3) NULL,
    `approved_at` DATETIME(3) NULL,
    `consumed_at` DATETIME(3) NULL,
    `attempt_count` INTEGER NOT NULL DEFAULT 0,
    `max_attempts` INTEGER NOT NULL DEFAULT 5,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `device_activation_challenges_public_id_key`(`public_id`),
    UNIQUE INDEX `device_activation_challenges_secret_hash_key`(`secret_hash`),
    INDEX `device_activation_challenges_status_expires_at_idx`(`status`, `expires_at`),
    INDEX `device_activation_challenges_household_id_recipient_id_statu_idx`(`household_id`, `recipient_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `device_credentials` (
    `id` CHAR(26) NOT NULL,
    `binding_id` CHAR(26) NOT NULL,
    `credential_hash` BINARY(32) NOT NULL,
    `credential_family_id` CHAR(26) NOT NULL,
    `device_key_thumbprint` BINARY(32) NOT NULL,
    `issued_at` DATETIME(3) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `last_used_at` DATETIME(3) NULL,
    `rotated_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,

    UNIQUE INDEX `device_credentials_credential_hash_key`(`credential_hash`),
    INDEX `device_credentials_binding_id_revoked_at_expires_at_idx`(`binding_id`, `revoked_at`, `expires_at`),
    INDEX `device_credentials_credential_family_id_idx`(`credential_family_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `consent_document_versions` (
    `id` CHAR(26) NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `version` INTEGER NOT NULL,
    `content_hash` BINARY(32) NOT NULL,
    `published_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `consent_document_versions_code_version_key`(`code`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recipient_consent_states` (
    `id` CHAR(26) NOT NULL,
    `household_id` CHAR(26) NOT NULL,
    `recipient_id` CHAR(26) NOT NULL,
    `scope` VARCHAR(64) NOT NULL,
    `decision` VARCHAR(16) NOT NULL,
    `last_event_id` CHAR(26) NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `recipient_consent_states_last_event_id_key`(`last_event_id`),
    INDEX `recipient_consent_states_household_id_scope_decision_idx`(`household_id`, `scope`, `decision`),
    UNIQUE INDEX `recipient_consent_states_recipient_id_scope_key`(`recipient_id`, `scope`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recipient_consent_events` (
    `id` CHAR(26) NOT NULL,
    `household_id` CHAR(26) NOT NULL,
    `recipient_id` CHAR(26) NOT NULL,
    `scope` VARCHAR(64) NOT NULL,
    `decision` VARCHAR(16) NOT NULL,
    `document_version_id` CHAR(26) NOT NULL,
    `decided_by_member_id` CHAR(26) NOT NULL,
    `reason` VARCHAR(500) NULL,
    `supersedes_event_id` CHAR(26) NULL,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `recipient_consent_events_recipient_id_scope_occurred_at_idx`(`recipient_id`, `scope`, `occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `memories` (
    `id` CHAR(26) NOT NULL,
    `household_id` CHAR(26) NOT NULL,
    `recipient_id` CHAR(26) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `sensitivity` VARCHAR(16) NOT NULL,
    `verification_status` VARCHAR(32) NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `current_revision_no` INTEGER NOT NULL DEFAULT 1,
    `created_by_member_id` CHAR(26) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    INDEX `memories_recipient_id_status_updated_at_idx`(`recipient_id`, `status`, `updated_at`),
    INDEX `memories_household_id_kind_status_idx`(`household_id`, `kind`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `memory_revisions` (
    `id` CHAR(26) NOT NULL,
    `memory_id` CHAR(26) NOT NULL,
    `revision_no` INTEGER NOT NULL,
    `content_ciphertext` LONGBLOB NOT NULL,
    `content_nonce` VARBINARY(24) NOT NULL,
    `encryption_key_id` VARCHAR(64) NOT NULL,
    `content_hash` BINARY(32) NOT NULL,
    `source` VARCHAR(32) NOT NULL,
    `change_reason` VARCHAR(500) NULL,
    `created_by_member_id` CHAR(26) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `memory_revisions_memory_id_revision_no_key`(`memory_id`, `revision_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tags` (
    `id` CHAR(26) NOT NULL,
    `household_id` CHAR(26) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `normalized_name` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `tags_household_id_normalized_name_key`(`household_id`, `normalized_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `memory_tags` (
    `memory_id` CHAR(26) NOT NULL,
    `tag_id` CHAR(26) NOT NULL,

    PRIMARY KEY (`memory_id`, `tag_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assets` (
    `id` CHAR(26) NOT NULL,
    `household_id` CHAR(26) NOT NULL,
    `recipient_id` CHAR(26) NULL,
    `bucket` VARCHAR(63) NOT NULL,
    `object_key` VARCHAR(512) NOT NULL,
    `original_name` VARCHAR(255) NOT NULL,
    `mime_type` VARCHAR(128) NOT NULL,
    `byte_size` BIGINT NOT NULL,
    `sha256` BINARY(32) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `scan_status` VARCHAR(32) NOT NULL,
    `encryption_key_id` VARCHAR(64) NULL,
    `retention_until` DATETIME(3) NULL,
    `status` VARCHAR(32) NOT NULL,
    `uploaded_by_member_id` CHAR(26) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    INDEX `assets_household_id_sha256_idx`(`household_id`, `sha256`),
    INDEX `assets_status_retention_until_idx`(`status`, `retention_until`),
    UNIQUE INDEX `assets_bucket_object_key_key`(`bucket`, `object_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `memory_assets` (
    `memory_id` CHAR(26) NOT NULL,
    `asset_id` CHAR(26) NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`memory_id`, `asset_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recipient_assets` (
    `recipient_id` CHAR(26) NOT NULL,
    `asset_id` CHAR(26) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,

    PRIMARY KEY (`recipient_id`, `asset_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `medications` (
    `id` CHAR(26) NOT NULL,
    `household_id` CHAR(26) NOT NULL,
    `recipient_id` CHAR(26) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `alias` VARCHAR(100) NULL,
    `purpose_ciphertext` BLOB NULL,
    `requirements_ciphertext` LONGBLOB NULL,
    `content_nonce` VARBINARY(24) NULL,
    `encryption_key_id` VARCHAR(64) NULL,
    `container_label` VARCHAR(200) NULL,
    `container_location` VARCHAR(200) NULL,
    `status` VARCHAR(32) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    INDEX `medications_recipient_id_status_idx`(`recipient_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `medication_assets` (
    `medication_id` CHAR(26) NOT NULL,
    `asset_id` CHAR(26) NOT NULL,

    PRIMARY KEY (`medication_id`, `asset_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `routines` (
    `id` CHAR(26) NOT NULL,
    `household_id` CHAR(26) NOT NULL,
    `recipient_id` CHAR(26) NOT NULL,
    `type` VARCHAR(32) NOT NULL,
    `medication_id` CHAR(26) NULL,
    `title` VARCHAR(200) NOT NULL,
    `instructions_ciphertext` LONGBLOB NOT NULL,
    `confirmation_question_ciphertext` LONGBLOB NOT NULL,
    `content_nonce` VARBINARY(24) NOT NULL,
    `encryption_key_id` VARCHAR(64) NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    INDEX `routines_recipient_id_status_idx`(`recipient_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `routine_schedules` (
    `id` CHAR(26) NOT NULL,
    `routine_id` CHAR(26) NOT NULL,
    `timezone` VARCHAR(64) NOT NULL,
    `local_time_minutes` INTEGER NOT NULL,
    `weekday_mask` INTEGER NOT NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NULL,
    `grace_minutes` INTEGER NOT NULL,
    `family_notice_minutes` INTEGER NOT NULL,
    `schedule_version` INTEGER NOT NULL DEFAULT 1,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `routine_schedules_routine_id_active_idx`(`routine_id`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `routine_occurrences` (
    `id` CHAR(26) NOT NULL,
    `household_id` CHAR(26) NOT NULL,
    `recipient_id` CHAR(26) NOT NULL,
    `routine_id` CHAR(26) NOT NULL,
    `schedule_id` CHAR(26) NOT NULL,
    `scheduled_at_utc` DATETIME(3) NOT NULL,
    `scheduled_local_date` DATE NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `confirmation_deadline_at` DATETIME(3) NULL,
    `escalation_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    INDEX `routine_occurrences_recipient_id_status_scheduled_at_utc_idx`(`recipient_id`, `status`, `scheduled_at_utc`),
    INDEX `routine_occurrences_household_id_status_escalation_at_idx`(`household_id`, `status`, `escalation_at`),
    UNIQUE INDEX `routine_occurrences_schedule_id_scheduled_at_utc_key`(`schedule_id`, `scheduled_at_utc`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `routine_confirmations` (
    `id` CHAR(26) NOT NULL,
    `occurrence_id` CHAR(26) NOT NULL,
    `confirmation_type` VARCHAR(32) NOT NULL,
    `source` VARCHAR(32) NOT NULL,
    `member_id` CHAR(26) NULL,
    `binding_id` CHAR(26) NULL,
    `utterance_id` CHAR(26) NULL,
    `note_ciphertext` BLOB NULL,
    `note_nonce` VARBINARY(24) NULL,
    `encryption_key_id` VARCHAR(64) NULL,
    `confirmed_at` DATETIME(3) NOT NULL,
    `idempotency_key` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `routine_confirmations_idempotency_key_key`(`idempotency_key`),
    INDEX `routine_confirmations_occurrence_id_confirmed_at_idx`(`occurrence_id`, `confirmed_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `care_events` (
    `id` CHAR(26) NOT NULL,
    `household_id` CHAR(26) NOT NULL,
    `recipient_id` CHAR(26) NOT NULL,
    `type` VARCHAR(64) NOT NULL,
    `severity` VARCHAR(16) NOT NULL,
    `source_type` VARCHAR(32) NOT NULL,
    `source_id` CHAR(26) NULL,
    `routine_occurrence_id` CHAR(26) NULL,
    `model_session_id` CHAR(26) NULL,
    `remote_session_id` CHAR(26) NULL,
    `title_ciphertext` BLOB NOT NULL,
    `summary_ciphertext` LONGBLOB NOT NULL,
    `content_nonce` VARBINARY(24) NOT NULL,
    `encryption_key_id` VARCHAR(64) NOT NULL,
    `dedupe_key` VARCHAR(128) NOT NULL,
    `payload_json` JSON NULL,
    `occurred_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `care_events_recipient_id_occurred_at_idx`(`recipient_id`, `occurred_at`),
    INDEX `care_events_household_id_type_occurred_at_idx`(`household_id`, `type`, `occurred_at`),
    UNIQUE INDEX `care_events_household_id_dedupe_key_key`(`household_id`, `dedupe_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `care_event_assets` (
    `event_id` CHAR(26) NOT NULL,
    `asset_id` CHAR(26) NOT NULL,

    PRIMARY KEY (`event_id`, `asset_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `family_tasks` (
    `id` CHAR(26) NOT NULL,
    `household_id` CHAR(26) NOT NULL,
    `recipient_id` CHAR(26) NOT NULL,
    `source_event_id` CHAR(26) NOT NULL,
    `assignee_member_id` CHAR(26) NULL,
    `status` VARCHAR(32) NOT NULL,
    `priority` VARCHAR(16) NOT NULL,
    `due_at` DATETIME(3) NULL,
    `resolved_at` DATETIME(3) NULL,
    `resolution_code` VARCHAR(64) NULL,
    `resolution_note_ciphertext` LONGBLOB NULL,
    `resolution_note_nonce` VARBINARY(24) NULL,
    `encryption_key_id` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `family_tasks_source_event_id_key`(`source_event_id`),
    INDEX `family_tasks_household_id_status_due_at_idx`(`household_id`, `status`, `due_at`),
    INDEX `family_tasks_recipient_id_status_idx`(`recipient_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `family_task_actions` (
    `id` CHAR(26) NOT NULL,
    `task_id` CHAR(26) NOT NULL,
    `actor_member_id` CHAR(26) NOT NULL,
    `action` VARCHAR(32) NOT NULL,
    `from_status` VARCHAR(32) NULL,
    `to_status` VARCHAR(32) NULL,
    `note_ciphertext` BLOB NULL,
    `note_nonce` VARBINARY(24) NULL,
    `encryption_key_id` VARCHAR(64) NULL,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `family_task_actions_task_id_occurred_at_idx`(`task_id`, `occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `prompt_versions` (
    `id` CHAR(26) NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `version` INTEGER NOT NULL,
    `provider` VARCHAR(32) NOT NULL,
    `model` VARCHAR(100) NOT NULL,
    `content_hash` BINARY(32) NOT NULL,
    `content_ciphertext` LONGBLOB NOT NULL,
    `content_nonce` VARBINARY(24) NOT NULL,
    `encryption_key_id` VARCHAR(64) NOT NULL,
    `published_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `prompt_versions_code_version_key`(`code`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `companion_sessions` (
    `id` CHAR(26) NOT NULL,
    `household_id` CHAR(26) NOT NULL,
    `recipient_id` CHAR(26) NOT NULL,
    `binding_id` CHAR(26) NOT NULL,
    `mode` VARCHAR(32) NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `care_snapshot_hash` BINARY(32) NOT NULL,
    `consent_snapshot_json` JSON NOT NULL,
    `started_at` DATETIME(3) NOT NULL,
    `ended_at` DATETIME(3) NULL,
    `end_reason` VARCHAR(64) NULL,
    `trace_id` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `version` INTEGER NOT NULL DEFAULT 0,

    INDEX `companion_sessions_recipient_id_started_at_idx`(`recipient_id`, `started_at`),
    INDEX `companion_sessions_binding_id_status_idx`(`binding_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `model_sessions` (
    `id` CHAR(26) NOT NULL,
    `companion_session_id` CHAR(26) NOT NULL,
    `provider` VARCHAR(32) NOT NULL,
    `model` VARCHAR(100) NOT NULL,
    `prompt_version_id` CHAR(26) NOT NULL,
    `provider_session_id` VARCHAR(200) NULL,
    `status` VARCHAR(32) NOT NULL,
    `started_at` DATETIME(3) NOT NULL,
    `first_response_at` DATETIME(3) NULL,
    `ended_at` DATETIME(3) NULL,
    `end_reason` VARCHAR(64) NULL,
    `error_code` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `model_sessions_companion_session_id_started_at_idx`(`companion_session_id`, `started_at`),
    INDEX `model_sessions_status_started_at_idx`(`status`, `started_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `conversation_utterances` (
    `id` CHAR(26) NOT NULL,
    `model_session_id` CHAR(26) NOT NULL,
    `sequence_no` INTEGER NOT NULL,
    `speaker` VARCHAR(32) NOT NULL,
    `member_id` CHAR(26) NULL,
    `binding_id` CHAR(26) NULL,
    `provider_event_id` VARCHAR(200) NULL,
    `start_offset_ms` INTEGER NULL,
    `end_offset_ms` INTEGER NULL,
    `is_final` BOOLEAN NOT NULL DEFAULT true,
    `language` VARCHAR(16) NULL,
    `confidence` DOUBLE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `conversation_utterances_model_session_id_sequence_no_key`(`model_session_id`, `sequence_no`),
    UNIQUE INDEX `conversation_utterances_model_session_id_provider_event_id_key`(`model_session_id`, `provider_event_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `conversation_utterance_contents` (
    `utterance_id` CHAR(26) NOT NULL,
    `raw_text_ciphertext` LONGBLOB NOT NULL,
    `nonce` VARBINARY(24) NOT NULL,
    `encryption_key_id` VARCHAR(64) NOT NULL,
    `content_hash` BINARY(32) NOT NULL,
    `char_count` INTEGER NOT NULL,
    `retention_until` DATETIME(3) NULL,
    `purged_at` DATETIME(3) NULL,

    INDEX `conversation_utterance_contents_retention_until_purged_at_idx`(`retention_until`, `purged_at`),
    PRIMARY KEY (`utterance_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `conversation_assets` (
    `utterance_id` CHAR(26) NOT NULL,
    `asset_id` CHAR(26) NOT NULL,

    PRIMARY KEY (`utterance_id`, `asset_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `memory_usage_records` (
    `id` CHAR(26) NOT NULL,
    `model_session_id` CHAR(26) NOT NULL,
    `utterance_id` CHAR(26) NULL,
    `memory_revision_id` CHAR(26) NOT NULL,
    `usage_type` VARCHAR(32) NOT NULL,
    `rank` INTEGER NULL,
    `retrieval_score` DOUBLE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `memory_usage_records_model_session_id_created_at_idx`(`model_session_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `model_session_events` (
    `id` CHAR(26) NOT NULL,
    `model_session_id` CHAR(26) NOT NULL,
    `event_type` VARCHAR(64) NOT NULL,
    `metrics_json` JSON NULL,
    `error_code` VARCHAR(64) NULL,
    `occurred_at` DATETIME(3) NOT NULL,

    INDEX `model_session_events_model_session_id_occurred_at_idx`(`model_session_id`, `occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `remote_access_policies` (
    `id` CHAR(26) NOT NULL,
    `household_id` CHAR(26) NOT NULL,
    `recipient_id` CHAR(26) NOT NULL,
    `binding_id` CHAR(26) NOT NULL,
    `mode` VARCHAR(32) NOT NULL,
    `camera_allowed` BOOLEAN NOT NULL DEFAULT false,
    `microphone_allowed` BOOLEAN NOT NULL DEFAULT true,
    `send_family_audio_allowed` BOOLEAN NOT NULL DEFAULT true,
    `countdown_seconds` INTEGER NOT NULL DEFAULT 10,
    `valid_from` DATETIME(3) NOT NULL,
    `valid_until` DATETIME(3) NULL,
    `local_confirmed_at` DATETIME(3) NULL,
    `consent_event_id` CHAR(26) NULL,
    `status` VARCHAR(32) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `remote_access_policies_binding_id_key`(`binding_id`),
    INDEX `remote_access_policies_household_id_recipient_id_status_idx`(`household_id`, `recipient_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `remote_access_policy_members` (
    `policy_id` CHAR(26) NOT NULL,
    `household_member_id` CHAR(26) NOT NULL,
    `allowed_video` BOOLEAN NOT NULL DEFAULT false,
    `allowed_receive_audio` BOOLEAN NOT NULL DEFAULT true,
    `allowed_send_audio` BOOLEAN NOT NULL DEFAULT true,
    `valid_until` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `remote_access_policy_members_household_member_id_revoked_at_idx`(`household_member_id`, `revoked_at`),
    PRIMARY KEY (`policy_id`, `household_member_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `remote_assistance_sessions` (
    `id` CHAR(26) NOT NULL,
    `household_id` CHAR(26) NOT NULL,
    `recipient_id` CHAR(26) NOT NULL,
    `binding_id` CHAR(26) NOT NULL,
    `initiated_by_member_id` CHAR(26) NOT NULL,
    `access_policy_id` CHAR(26) NULL,
    `answer_mode` VARCHAR(32) NOT NULL,
    `requested_media` VARCHAR(32) NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `livekit_room_name` VARCHAR(128) NOT NULL,
    `requested_at` DATETIME(3) NOT NULL,
    `accepted_at` DATETIME(3) NULL,
    `connected_at` DATETIME(3) NULL,
    `ended_at` DATETIME(3) NULL,
    `ended_by_type` VARCHAR(16) NULL,
    `ended_by_id` CHAR(26) NULL,
    `end_reason` VARCHAR(64) NULL,
    `consent_snapshot_json` JSON NOT NULL,
    `trace_id` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `remote_assistance_sessions_livekit_room_name_key`(`livekit_room_name`),
    INDEX `remote_assistance_sessions_binding_id_status_requested_at_idx`(`binding_id`, `status`, `requested_at`),
    INDEX `remote_assistance_sessions_household_id_requested_at_idx`(`household_id`, `requested_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `remote_session_participants` (
    `id` CHAR(26) NOT NULL,
    `session_id` CHAR(26) NOT NULL,
    `principal_type` VARCHAR(16) NOT NULL,
    `user_id` CHAR(26) NULL,
    `binding_id` CHAR(26) NULL,
    `role` VARCHAR(16) NOT NULL,
    `client_type` VARCHAR(16) NOT NULL,
    `joined_at` DATETIME(3) NULL,
    `left_at` DATETIME(3) NULL,
    `published_audio` BOOLEAN NOT NULL DEFAULT false,
    `published_video` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `remote_session_participants_session_id_joined_at_idx`(`session_id`, `joined_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `remote_session_events` (
    `id` CHAR(26) NOT NULL,
    `session_id` CHAR(26) NOT NULL,
    `event_type` VARCHAR(64) NOT NULL,
    `actor_type` VARCHAR(16) NULL,
    `actor_id` CHAR(26) NULL,
    `metadata_json` JSON NULL,
    `occurred_at` DATETIME(3) NOT NULL,

    INDEX `remote_session_events_session_id_occurred_at_idx`(`session_id`, `occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inspection_grants` (
    `id` CHAR(26) NOT NULL,
    `environment` VARCHAR(16) NOT NULL,
    `requested_by_user_id` CHAR(26) NOT NULL,
    `approved_by_user_id` CHAR(26) NULL,
    `household_id` CHAR(26) NOT NULL,
    `recipient_id` CHAR(26) NULL,
    `data_categories_json` JSON NOT NULL,
    `reason` VARCHAR(1000) NOT NULL,
    `ticket_reference` VARCHAR(100) NULL,
    `status` VARCHAR(32) NOT NULL,
    `valid_from` DATETIME(3) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `inspection_grants_household_id_status_expires_at_idx`(`household_id`, `status`, `expires_at`),
    INDEX `inspection_grants_requested_by_user_id_created_at_idx`(`requested_by_user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_inspections` (
    `id` CHAR(26) NOT NULL,
    `grant_id` CHAR(26) NOT NULL,
    `operator_user_id` CHAR(26) NOT NULL,
    `resource_type` VARCHAR(64) NOT NULL,
    `resource_id` CHAR(26) NOT NULL,
    `original_revealed` BOOLEAN NOT NULL DEFAULT false,
    `request_id` VARCHAR(64) NOT NULL,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `content_inspections_grant_id_occurred_at_idx`(`grant_id`, `occurred_at`),
    INDEX `content_inspections_resource_type_resource_id_occurred_at_idx`(`resource_type`, `resource_id`, `occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` CHAR(26) NOT NULL,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `environment` VARCHAR(16) NOT NULL,
    `actor_type` VARCHAR(16) NOT NULL,
    `actor_user_id` CHAR(26) NULL,
    `actor_binding_id` CHAR(26) NULL,
    `actor_session_id` CHAR(26) NULL,
    `actor_role_snapshot` JSON NULL,
    `source_ip_hash` BINARY(32) NULL,
    `user_agent` VARCHAR(512) NULL,
    `action` VARCHAR(100) NOT NULL,
    `resource_type` VARCHAR(64) NOT NULL,
    `resource_id` CHAR(26) NULL,
    `household_id` CHAR(26) NULL,
    `recipient_id` CHAR(26) NULL,
    `target_device_id` CHAR(26) NULL,
    `request_id` VARCHAR(64) NOT NULL,
    `trace_id` VARCHAR(64) NULL,
    `purpose` VARCHAR(100) NULL,
    `reason_code` VARCHAR(64) NULL,
    `ticket_id` CHAR(26) NULL,
    `approval_actor_id` CHAR(26) NULL,
    `decision` VARCHAR(16) NOT NULL,
    `failure_code` VARCHAR(64) NULL,
    `policy_version` VARCHAR(32) NULL,
    `changed_field_names` JSON NULL,
    `before_hash` BINARY(32) NULL,
    `after_hash` BINARY(32) NULL,
    `previous_event_hash` BINARY(32) NULL,
    `event_hash` BINARY(32) NOT NULL,
    `retention_until` DATETIME(3) NULL,

    INDEX `audit_logs_household_id_occurred_at_idx`(`household_id`, `occurred_at`),
    INDEX `audit_logs_actor_user_id_occurred_at_idx`(`actor_user_id`, `occurred_at`),
    INDEX `audit_logs_resource_type_resource_id_occurred_at_idx`(`resource_type`, `resource_id`, `occurred_at`),
    INDEX `audit_logs_ticket_id_occurred_at_idx`(`ticket_id`, `occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_endpoints` (
    `id` CHAR(26) NOT NULL,
    `user_id` CHAR(26) NULL,
    `device_id` CHAR(26) NULL,
    `channel` VARCHAR(16) NOT NULL,
    `provider` VARCHAR(32) NOT NULL,
    `endpoint_ciphertext` BLOB NOT NULL,
    `endpoint_hash` BINARY(32) NOT NULL,
    `verified_at` DATETIME(3) NULL,
    `status` VARCHAR(32) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `notification_endpoints_user_id_status_idx`(`user_id`, `status`),
    UNIQUE INDEX `notification_endpoints_channel_endpoint_hash_key`(`channel`, `endpoint_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` CHAR(26) NOT NULL,
    `household_id` CHAR(26) NOT NULL,
    `recipient_id` CHAR(26) NULL,
    `type` VARCHAR(64) NOT NULL,
    `priority` VARCHAR(16) NOT NULL,
    `template_code` VARCHAR(100) NOT NULL,
    `template_variables_json` JSON NOT NULL,
    `scheduled_at` DATETIME(3) NOT NULL,
    `dedupe_key` VARCHAR(128) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_scheduled_at_idx`(`scheduled_at`),
    UNIQUE INDEX `notifications_household_id_dedupe_key_key`(`household_id`, `dedupe_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_deliveries` (
    `id` CHAR(26) NOT NULL,
    `notification_id` CHAR(26) NOT NULL,
    `endpoint_id` CHAR(26) NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `attempt_count` INTEGER NOT NULL DEFAULT 0,
    `next_attempt_at` DATETIME(3) NULL,
    `provider_message_id` VARCHAR(200) NULL,
    `sent_at` DATETIME(3) NULL,
    `delivered_at` DATETIME(3) NULL,
    `last_error_code` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `notification_deliveries_status_next_attempt_at_idx`(`status`, `next_attempt_at`),
    UNIQUE INDEX `notification_deliveries_notification_id_endpoint_id_key`(`notification_id`, `endpoint_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `outbox_events` (
    `id` CHAR(26) NOT NULL,
    `aggregate_type` VARCHAR(64) NOT NULL,
    `aggregate_id` CHAR(26) NOT NULL,
    `event_type` VARCHAR(100) NOT NULL,
    `payload_json` JSON NOT NULL,
    `headers_json` JSON NULL,
    `occurred_at` DATETIME(3) NOT NULL,
    `available_at` DATETIME(3) NOT NULL,
    `lease_owner` VARCHAR(100) NULL,
    `lease_until` DATETIME(3) NULL,
    `published_at` DATETIME(3) NULL,
    `attempt_count` INTEGER NOT NULL DEFAULT 0,
    `last_error` VARCHAR(1000) NULL,

    INDEX `outbox_events_published_at_available_at_idx`(`published_at`, `available_at`),
    INDEX `outbox_events_lease_until_idx`(`lease_until`),
    INDEX `outbox_events_aggregate_type_aggregate_id_occurred_at_idx`(`aggregate_type`, `aggregate_id`, `occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inbox_receipts` (
    `consumer` VARCHAR(100) NOT NULL,
    `event_id` CHAR(26) NOT NULL,
    `processed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`consumer`, `event_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `login_identities` ADD CONSTRAINT `login_identities_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `password_credentials` ADD CONSTRAINT `password_credentials_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_sessions` ADD CONSTRAINT `user_sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `one_time_tokens` ADD CONSTRAINT `one_time_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permission_id_fkey` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `platform_role_assignments` ADD CONSTRAINT `platform_role_assignments_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `platform_role_assignments` ADD CONSTRAINT `platform_role_assignments_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `platform_role_assignments` ADD CONSTRAINT `platform_role_assignments_assigned_by_id_fkey` FOREIGN KEY (`assigned_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `households` ADD CONSTRAINT `households_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `household_members` ADD CONSTRAINT `household_members_household_id_fkey` FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `household_members` ADD CONSTRAINT `household_members_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `household_members` ADD CONSTRAINT `household_members_invited_by_member_id_fkey` FOREIGN KEY (`invited_by_member_id`) REFERENCES `household_members`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `household_member_roles` ADD CONSTRAINT `household_member_roles_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `household_members`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `household_member_roles` ADD CONSTRAINT `household_member_roles_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `household_invitations` ADD CONSTRAINT `household_invitations_household_id_fkey` FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `household_invitations` ADD CONSTRAINT `household_invitations_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `household_invitations` ADD CONSTRAINT `household_invitations_household_id_issued_by_member_id_fkey` FOREIGN KEY (`household_id`, `issued_by_member_id`) REFERENCES `household_members`(`household_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `care_recipients` ADD CONSTRAINT `care_recipients_household_id_fkey` FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `care_recipients` ADD CONSTRAINT `care_recipients_linked_user_id_fkey` FOREIGN KEY (`linked_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recipient_members` ADD CONSTRAINT `recipient_members_household_id_recipient_id_fkey` FOREIGN KEY (`household_id`, `recipient_id`) REFERENCES `care_recipients`(`household_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recipient_members` ADD CONSTRAINT `recipient_members_household_id_household_member_id_fkey` FOREIGN KEY (`household_id`, `household_member_id`) REFERENCES `household_members`(`household_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `trusted_contacts` ADD CONSTRAINT `trusted_contacts_household_id_recipient_id_fkey` FOREIGN KEY (`household_id`, `recipient_id`) REFERENCES `care_recipients`(`household_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `trusted_contacts` ADD CONSTRAINT `trusted_contacts_household_id_household_member_id_fkey` FOREIGN KEY (`household_id`, `household_member_id`) REFERENCES `household_members`(`household_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `companion_bindings` ADD CONSTRAINT `companion_bindings_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `companion_bindings` ADD CONSTRAINT `companion_bindings_household_id_fkey` FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `companion_bindings` ADD CONSTRAINT `companion_bindings_household_id_recipient_id_fkey` FOREIGN KEY (`household_id`, `recipient_id`) REFERENCES `care_recipients`(`household_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `companion_bindings` ADD CONSTRAINT `companion_bindings_household_id_activated_by_member_id_fkey` FOREIGN KEY (`household_id`, `activated_by_member_id`) REFERENCES `household_members`(`household_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `device_binding_events` ADD CONSTRAINT `device_binding_events_binding_id_fkey` FOREIGN KEY (`binding_id`) REFERENCES `companion_bindings`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `device_activation_challenges` ADD CONSTRAINT `device_activation_challenges_household_id_fkey` FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `device_activation_challenges` ADD CONSTRAINT `device_activation_challenges_household_id_recipient_id_fkey` FOREIGN KEY (`household_id`, `recipient_id`) REFERENCES `care_recipients`(`household_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `device_activation_challenges` ADD CONSTRAINT `device_activation_challenges_pending_device_id_fkey` FOREIGN KEY (`pending_device_id`) REFERENCES `devices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `device_activation_challenges` ADD CONSTRAINT `device_activation_challenges_household_id_issued_by_member__fkey` FOREIGN KEY (`household_id`, `issued_by_member_id`) REFERENCES `household_members`(`household_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `device_activation_challenges` ADD CONSTRAINT `device_activation_challenges_household_id_approved_by_membe_fkey` FOREIGN KEY (`household_id`, `approved_by_member_id`) REFERENCES `household_members`(`household_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `device_credentials` ADD CONSTRAINT `device_credentials_binding_id_fkey` FOREIGN KEY (`binding_id`) REFERENCES `companion_bindings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recipient_consent_states` ADD CONSTRAINT `recipient_consent_states_household_id_fkey` FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recipient_consent_states` ADD CONSTRAINT `recipient_consent_states_household_id_recipient_id_fkey` FOREIGN KEY (`household_id`, `recipient_id`) REFERENCES `care_recipients`(`household_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recipient_consent_states` ADD CONSTRAINT `recipient_consent_states_last_event_id_fkey` FOREIGN KEY (`last_event_id`) REFERENCES `recipient_consent_events`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recipient_consent_events` ADD CONSTRAINT `recipient_consent_events_household_id_fkey` FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recipient_consent_events` ADD CONSTRAINT `recipient_consent_events_household_id_recipient_id_fkey` FOREIGN KEY (`household_id`, `recipient_id`) REFERENCES `care_recipients`(`household_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recipient_consent_events` ADD CONSTRAINT `recipient_consent_events_document_version_id_fkey` FOREIGN KEY (`document_version_id`) REFERENCES `consent_document_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recipient_consent_events` ADD CONSTRAINT `recipient_consent_events_household_id_decided_by_member_id_fkey` FOREIGN KEY (`household_id`, `decided_by_member_id`) REFERENCES `household_members`(`household_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recipient_consent_events` ADD CONSTRAINT `recipient_consent_events_supersedes_event_id_fkey` FOREIGN KEY (`supersedes_event_id`) REFERENCES `recipient_consent_events`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `memories` ADD CONSTRAINT `memories_household_id_fkey` FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `memories` ADD CONSTRAINT `memories_recipient_id_fkey` FOREIGN KEY (`recipient_id`) REFERENCES `care_recipients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `memory_revisions` ADD CONSTRAINT `memory_revisions_memory_id_fkey` FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `memory_tags` ADD CONSTRAINT `memory_tags_memory_id_fkey` FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `memory_tags` ADD CONSTRAINT `memory_tags_tag_id_fkey` FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assets` ADD CONSTRAINT `assets_household_id_fkey` FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assets` ADD CONSTRAINT `assets_recipient_id_fkey` FOREIGN KEY (`recipient_id`) REFERENCES `care_recipients`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `memory_assets` ADD CONSTRAINT `memory_assets_memory_id_fkey` FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `memory_assets` ADD CONSTRAINT `memory_assets_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recipient_assets` ADD CONSTRAINT `recipient_assets_recipient_id_fkey` FOREIGN KEY (`recipient_id`) REFERENCES `care_recipients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recipient_assets` ADD CONSTRAINT `recipient_assets_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `medications` ADD CONSTRAINT `medications_household_id_fkey` FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `medications` ADD CONSTRAINT `medications_recipient_id_fkey` FOREIGN KEY (`recipient_id`) REFERENCES `care_recipients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `medication_assets` ADD CONSTRAINT `medication_assets_medication_id_fkey` FOREIGN KEY (`medication_id`) REFERENCES `medications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `medication_assets` ADD CONSTRAINT `medication_assets_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `routines` ADD CONSTRAINT `routines_household_id_fkey` FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `routines` ADD CONSTRAINT `routines_recipient_id_fkey` FOREIGN KEY (`recipient_id`) REFERENCES `care_recipients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `routines` ADD CONSTRAINT `routines_medication_id_fkey` FOREIGN KEY (`medication_id`) REFERENCES `medications`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `routine_schedules` ADD CONSTRAINT `routine_schedules_routine_id_fkey` FOREIGN KEY (`routine_id`) REFERENCES `routines`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `routine_occurrences` ADD CONSTRAINT `routine_occurrences_household_id_fkey` FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `routine_occurrences` ADD CONSTRAINT `routine_occurrences_recipient_id_fkey` FOREIGN KEY (`recipient_id`) REFERENCES `care_recipients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `routine_occurrences` ADD CONSTRAINT `routine_occurrences_routine_id_fkey` FOREIGN KEY (`routine_id`) REFERENCES `routines`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `routine_occurrences` ADD CONSTRAINT `routine_occurrences_schedule_id_fkey` FOREIGN KEY (`schedule_id`) REFERENCES `routine_schedules`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `routine_confirmations` ADD CONSTRAINT `routine_confirmations_occurrence_id_fkey` FOREIGN KEY (`occurrence_id`) REFERENCES `routine_occurrences`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `care_events` ADD CONSTRAINT `care_events_household_id_fkey` FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `care_events` ADD CONSTRAINT `care_events_recipient_id_fkey` FOREIGN KEY (`recipient_id`) REFERENCES `care_recipients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `care_events` ADD CONSTRAINT `care_events_routine_occurrence_id_fkey` FOREIGN KEY (`routine_occurrence_id`) REFERENCES `routine_occurrences`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `care_event_assets` ADD CONSTRAINT `care_event_assets_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `care_events`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `care_event_assets` ADD CONSTRAINT `care_event_assets_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `family_tasks` ADD CONSTRAINT `family_tasks_household_id_fkey` FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `family_tasks` ADD CONSTRAINT `family_tasks_recipient_id_fkey` FOREIGN KEY (`recipient_id`) REFERENCES `care_recipients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `family_tasks` ADD CONSTRAINT `family_tasks_source_event_id_fkey` FOREIGN KEY (`source_event_id`) REFERENCES `care_events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `family_task_actions` ADD CONSTRAINT `family_task_actions_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `family_tasks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `companion_sessions` ADD CONSTRAINT `companion_sessions_household_id_fkey` FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `companion_sessions` ADD CONSTRAINT `companion_sessions_recipient_id_fkey` FOREIGN KEY (`recipient_id`) REFERENCES `care_recipients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `companion_sessions` ADD CONSTRAINT `companion_sessions_binding_id_fkey` FOREIGN KEY (`binding_id`) REFERENCES `companion_bindings`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `model_sessions` ADD CONSTRAINT `model_sessions_companion_session_id_fkey` FOREIGN KEY (`companion_session_id`) REFERENCES `companion_sessions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `model_sessions` ADD CONSTRAINT `model_sessions_prompt_version_id_fkey` FOREIGN KEY (`prompt_version_id`) REFERENCES `prompt_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conversation_utterances` ADD CONSTRAINT `conversation_utterances_model_session_id_fkey` FOREIGN KEY (`model_session_id`) REFERENCES `model_sessions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conversation_utterance_contents` ADD CONSTRAINT `conversation_utterance_contents_utterance_id_fkey` FOREIGN KEY (`utterance_id`) REFERENCES `conversation_utterances`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conversation_assets` ADD CONSTRAINT `conversation_assets_utterance_id_fkey` FOREIGN KEY (`utterance_id`) REFERENCES `conversation_utterances`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conversation_assets` ADD CONSTRAINT `conversation_assets_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `memory_usage_records` ADD CONSTRAINT `memory_usage_records_model_session_id_fkey` FOREIGN KEY (`model_session_id`) REFERENCES `model_sessions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `memory_usage_records` ADD CONSTRAINT `memory_usage_records_utterance_id_fkey` FOREIGN KEY (`utterance_id`) REFERENCES `conversation_utterances`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `memory_usage_records` ADD CONSTRAINT `memory_usage_records_memory_revision_id_fkey` FOREIGN KEY (`memory_revision_id`) REFERENCES `memory_revisions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `model_session_events` ADD CONSTRAINT `model_session_events_model_session_id_fkey` FOREIGN KEY (`model_session_id`) REFERENCES `model_sessions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remote_access_policies` ADD CONSTRAINT `remote_access_policies_binding_id_fkey` FOREIGN KEY (`binding_id`) REFERENCES `companion_bindings`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remote_access_policy_members` ADD CONSTRAINT `remote_access_policy_members_policy_id_fkey` FOREIGN KEY (`policy_id`) REFERENCES `remote_access_policies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remote_access_policy_members` ADD CONSTRAINT `remote_access_policy_members_household_member_id_fkey` FOREIGN KEY (`household_member_id`) REFERENCES `household_members`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remote_assistance_sessions` ADD CONSTRAINT `remote_assistance_sessions_household_id_fkey` FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remote_assistance_sessions` ADD CONSTRAINT `remote_assistance_sessions_recipient_id_fkey` FOREIGN KEY (`recipient_id`) REFERENCES `care_recipients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remote_assistance_sessions` ADD CONSTRAINT `remote_assistance_sessions_binding_id_fkey` FOREIGN KEY (`binding_id`) REFERENCES `companion_bindings`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remote_assistance_sessions` ADD CONSTRAINT `remote_assistance_sessions_access_policy_id_fkey` FOREIGN KEY (`access_policy_id`) REFERENCES `remote_access_policies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remote_session_participants` ADD CONSTRAINT `remote_session_participants_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `remote_assistance_sessions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remote_session_events` ADD CONSTRAINT `remote_session_events_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `remote_assistance_sessions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inspection_grants` ADD CONSTRAINT `inspection_grants_requested_by_user_id_fkey` FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inspection_grants` ADD CONSTRAINT `inspection_grants_approved_by_user_id_fkey` FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inspection_grants` ADD CONSTRAINT `inspection_grants_household_id_fkey` FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inspection_grants` ADD CONSTRAINT `inspection_grants_household_id_recipient_id_fkey` FOREIGN KEY (`household_id`, `recipient_id`) REFERENCES `care_recipients`(`household_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `content_inspections` ADD CONSTRAINT `content_inspections_grant_id_fkey` FOREIGN KEY (`grant_id`) REFERENCES `inspection_grants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `content_inspections` ADD CONSTRAINT `content_inspections_operator_user_id_fkey` FOREIGN KEY (`operator_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_endpoints` ADD CONSTRAINT `notification_endpoints_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_household_id_fkey` FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_recipient_id_fkey` FOREIGN KEY (`recipient_id`) REFERENCES `care_recipients`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_deliveries` ADD CONSTRAINT `notification_deliveries_notification_id_fkey` FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_deliveries` ADD CONSTRAINT `notification_deliveries_endpoint_id_fkey` FOREIGN KEY (`endpoint_id`) REFERENCES `notification_endpoints`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inbox_receipts` ADD CONSTRAINT `inbox_receipts_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `outbox_events`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

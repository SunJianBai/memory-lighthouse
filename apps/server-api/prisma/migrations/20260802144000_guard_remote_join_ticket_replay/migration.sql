ALTER TABLE `remote_session_participants`
    ADD COLUMN `join_ticket_consumed_event_id` VARCHAR(64) NULL,
    ADD COLUMN `livekit_participant_sid` VARCHAR(64) NULL;

-- Keep the utterance envelope for sequence/timing metrics after the configured
-- transcript retention period, while making the sensitive plaintext
-- irrecoverable by removing every encrypted payload component.
ALTER TABLE `conversation_utterance_contents`
  MODIFY `raw_text_ciphertext` LONGBLOB NULL,
  MODIFY `nonce` VARBINARY(24) NULL,
  MODIFY `encryption_key_id` VARCHAR(64) NULL,
  MODIFY `content_hash` BINARY(32) NULL;

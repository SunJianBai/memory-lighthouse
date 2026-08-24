import 'reflect-metadata';

import { describe, expect, it } from '@jest/globals';
import { validate } from 'class-validator';

import { PublishCompanionPromptDto } from './platform-operations.dto';

function dto(content: string): PublishCompanionPromptDto {
  const value = new PublishCompanionPromptDto();
  value.expectedCurrentPromptId = '01K1P000000000000000000001';
  value.content = content;
  value.reason = '调整回复长度';
  return value;
}

describe('PublishCompanionPromptDto', () => {
  it('accepts 4000 Unicode characters and rejects 4001', async () => {
    await expect(validate(dto('🙂'.repeat(4_000)))).resolves.toHaveLength(0);

    const errors = await validate(dto('🙂'.repeat(4_001)));
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('content');
  });
});

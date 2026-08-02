import { BadRequestException } from '@nestjs/common';

export function requireMatchingIdempotencyKey(
  headerValue: string | undefined,
  bodyValue?: string,
): string {
  const key = headerValue?.trim() ?? '';
  if (key.length < 1 || key.length > 100 || /[\r\n]/.test(key)) {
    throw new BadRequestException({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: '写操作必须提供有效的 Idempotency-Key 请求头',
    });
  }
  if (bodyValue !== undefined && bodyValue !== key) {
    throw new BadRequestException({
      code: 'IDEMPOTENCY_KEY_MISMATCH',
      message: '请求头与请求体中的幂等键不一致',
    });
  }
  return key;
}

import { BadRequestException } from '@nestjs/common';

import { EMAIL_IDENTITY, USERNAME_IDENTITY } from '../identity.constants';

const USERNAME_PATTERN = /^[\p{L}\p{N}._-]+$/u;

export interface NormalizedIdentity {
  type: typeof EMAIL_IDENTITY | typeof USERNAME_IDENTITY;
  value: string;
  normalizedValue: string;
}

function invalidIdentity(message: string): never {
  throw new BadRequestException({
    code: 'INVALID_IDENTITY',
    message,
  });
}

export function normalizeEmail(input: string): NormalizedIdentity {
  const value = input.trim().normalize('NFKC');
  const normalizedValue = value.toLowerCase();
  const at = normalizedValue.lastIndexOf('@');

  if (
    normalizedValue.length > 320 ||
    at < 1 ||
    at === normalizedValue.length - 1 ||
    normalizedValue.includes(' ')
  ) {
    return invalidIdentity('请输入有效的邮箱地址');
  }

  return { type: EMAIL_IDENTITY, value, normalizedValue };
}

export function normalizeUsername(input: string): NormalizedIdentity {
  const value = input.trim().normalize('NFKC');
  const normalizedValue = value.toLowerCase();

  if (
    normalizedValue.length < 3 ||
    normalizedValue.length > 32 ||
    !USERNAME_PATTERN.test(normalizedValue)
  ) {
    return invalidIdentity(
      '用户名需为 3–32 个字符，可包含字母、数字、点、下划线和连字符',
    );
  }

  return { type: USERNAME_IDENTITY, value, normalizedValue };
}

export function normalizeLoginIdentifier(input: string): NormalizedIdentity {
  return input.includes('@') ? normalizeEmail(input) : normalizeUsername(input);
}

import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from '@jest/globals';

import {
  normalizeEmail,
  normalizeLoginIdentifier,
  normalizeUsername,
} from './identity-normalization';

describe('identity normalization', () => {
  it('normalizes email and username deterministically', () => {
    expect(normalizeEmail('  Family@Example.COM ')).toMatchObject({
      type: 'EMAIL',
      value: 'Family@Example.COM',
      normalizedValue: 'family@example.com',
    });
    expect(normalizeUsername('  Alice.ZH ')).toMatchObject({
      type: 'USERNAME',
      value: 'Alice.ZH',
      normalizedValue: 'alice.zh',
    });
  });

  it('uses the identifier form to select a single lookup namespace', () => {
    expect(normalizeLoginIdentifier('a@example.com').type).toBe('EMAIL');
    expect(normalizeLoginIdentifier('家属_01').type).toBe('USERNAME');
  });

  it('rejects whitespace and unsupported username punctuation', () => {
    expect(() => normalizeUsername('a b')).toThrow(BadRequestException);
    expect(() => normalizeUsername('ab')).toThrow(BadRequestException);
  });
});

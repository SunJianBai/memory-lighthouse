import { describe, expect, it } from '@jest/globals';

import {
  COMPANION_PROMPT_TEMPLATE_MAX_CHARS,
  normalizeCompanionPromptTemplate,
} from './companion-prompt';

describe('normalizeCompanionPromptTemplate', () => {
  it('canonicalizes line endings and unsafe control characters before storage', () => {
    expect(
      normalizeCompanionPromptTemplate('  第一行\r\n第二\u0000行\r  '),
    ).toBe('第一行\n第二 行');
  });

  it('measures the template limit in Unicode characters', () => {
    const accepted = '🙂'.repeat(COMPANION_PROMPT_TEMPLATE_MAX_CHARS);
    expect(normalizeCompanionPromptTemplate(accepted)).toBe(accepted);
    expect(() => normalizeCompanionPromptTemplate(`${accepted}🙂`)).toThrow(
      `1-${COMPANION_PROMPT_TEMPLATE_MAX_CHARS} characters`,
    );
  });

  it('rejects an empty configured template instead of persisting a hidden fallback', () => {
    expect(() => normalizeCompanionPromptTemplate(' \r\n ')).toThrow(
      `1-${COMPANION_PROMPT_TEMPLATE_MAX_CHARS} characters`,
    );
  });
});

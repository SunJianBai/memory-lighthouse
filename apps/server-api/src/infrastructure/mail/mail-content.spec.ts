import { describe, expect, it } from '@jest/globals';

import {
  assertSafeOutboundMail,
  buildPublicAppLink,
  escapeHtml,
  sanitizePlainText,
} from './mail-content';

describe('mail content safety', () => {
  it('keeps action links under /openBMB and URL-encodes bearer tokens', () => {
    const link = buildPublicAppLink(
      'https://sun227454.online/some/base',
      '/openBMB/auth/verify-email',
      'raw+token/&?',
    );
    const parsed = new URL(link);

    expect(parsed.pathname).toBe('/openBMB/auth/verify-email');
    expect(new URLSearchParams(parsed.hash.slice(1)).get('token')).toBe(
      'raw+token/&?',
    );
    expect(link).not.toContain('raw+token/&?');
  });

  it('escapes HTML and removes control/newline injection from plain labels', () => {
    expect(escapeHtml('<script>"x" & y</script>')).toBe(
      '&lt;script&gt;&quot;x&quot; &amp; y&lt;/script&gt;',
    );
    expect(sanitizePlainText('family\r\nBcc: victim@example.com')).toBe(
      'family Bcc: victim@example.com',
    );
  });

  it('rejects unsafe recipients and header injection before transport', () => {
    const valid = {
      to: 'family@example.com',
      subject: 'fixed subject',
      text: 'plain',
      html: '<p>html</p>',
    };
    expect(() => assertSafeOutboundMail(valid)).not.toThrow();
    expect(() =>
      assertSafeOutboundMail({
        ...valid,
        to: 'family@example.com\r\nBcc: victim@example.com',
      }),
    ).toThrow('recipient');
    expect(() =>
      assertSafeOutboundMail({ ...valid, subject: 'hello\r\nBcc: victim' }),
    ).toThrow('subject');
  });

  it('refuses mail routes outside the public application prefix', () => {
    expect(() =>
      buildPublicAppLink(
        'https://sun227454.online',
        '/admin/token-leak',
        'secret',
      ),
    ).toThrow('/openBMB/');
  });
});

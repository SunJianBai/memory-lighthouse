const EMAIL_ADDRESS = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

function removeControlCharacters(value: string): string {
  return [...value]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join('');
}

export function sanitizePlainText(value: string): string {
  return value
    .normalize('NFKC')
    .split(/\r?\n/)
    .map(removeControlCharacters)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function escapeHtml(value: string): string {
  return sanitizePlainText(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function isSafeEmailAddress(value: string): boolean {
  return (
    value.length <= 254 &&
    !value.includes('[') &&
    !value.includes(']') &&
    !value.includes('\\') &&
    EMAIL_ADDRESS.test(value)
  );
}

export function assertSafeOutboundMail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): void {
  if (!isSafeEmailAddress(input.to)) {
    throw new Error('Outbound mail recipient is invalid');
  }
  if (
    input.subject.length === 0 ||
    input.subject.length > 200 ||
    /[\r\n\0]/.test(input.subject)
  ) {
    throw new Error('Outbound mail subject is invalid');
  }
  if (input.text.length > 1_000_000 || input.html.length > 1_000_000) {
    throw new Error('Outbound mail body is too large');
  }
}

export function buildPublicAppLink(
  publicAppUrl: string,
  route: string,
  token: string,
): string {
  if (!route.startsWith('/openBMB/')) {
    throw new Error('Public mail routes must stay below /openBMB/');
  }
  const url = new URL(route, publicAppUrl);
  // URL fragments are not sent in HTTP requests or Referer headers. The Web
  // client consumes the one-time secret, clears the fragment with
  // history.replaceState, then submits it in a JSON request body.
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

import { InvitationTokenService } from './invitation-token.service';

describe('InvitationTokenService', () => {
  const service = new InvitationTokenService({
    environment: 'test',
    invitationTokenPepper: Buffer.from('p'.repeat(48)),
    invitationTtlSeconds: 3600,
  });

  it('issues an opaque token and only a deterministic peppered hash for storage', () => {
    const issued = service.issue();

    expect(issued.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(issued.tokenHash).toString('utf8')).not.toContain(
      issued.rawToken,
    );
    expect(service.hash(issued.rawToken)).toEqual(issued.tokenHash);
  });
});

import { describe, expect, it, jest } from '@jest/globals';

import { EmailVerificationRequiredException } from '../identity.errors';
import { VerifiedEmailPolicy } from './verified-email.policy';

function makeHarness() {
  const client = {
    loginIdentity: {
      findFirst: jest.fn<() => Promise<{ id: string } | null>>(),
    },
  };
  const policy = new VerifiedEmailPolicy();

  return { client, policy };
}

describe('VerifiedEmailPolicy', () => {
  it('accepts a user with at least one verified EMAIL identity', async () => {
    const { client, policy } = makeHarness();
    client.loginIdentity.findFirst.mockResolvedValue({ id: 'email-1' });

    await expect(
      policy.requireVerifiedEmail(client as never, 'user-1'),
    ).resolves.toBeUndefined();
    expect(client.loginIdentity.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        type: 'EMAIL',
        verifiedAt: { not: null },
      },
      select: { id: true },
    });
  });

  it('rejects an account that has no verified EMAIL identity', async () => {
    const { client, policy } = makeHarness();
    client.loginIdentity.findFirst.mockResolvedValue(null);

    const error = await policy
      .requireVerifiedEmail(client as never, 'user-1')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(EmailVerificationRequiredException);
    expect((error as EmailVerificationRequiredException).getResponse()).toEqual(
      {
        code: 'EMAIL_VERIFICATION_REQUIRED',
        message: '请先验证邮箱后再执行此操作',
      },
    );
  });
});

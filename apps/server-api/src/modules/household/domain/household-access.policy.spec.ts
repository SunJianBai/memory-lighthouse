import {
  HouseholdAccessDeniedException,
  RecipientAccessDeniedException,
} from '../household.errors';
import { HouseholdAccessPolicy } from './household-access.policy';

function makeClient(
  roleCodes: string[],
  authority: Record<string, boolean> | null,
) {
  return {
    householdMember: {
      findFirst: jest.fn(async () => ({
        id: 'member-1',
        householdId: 'household-1',
        userId: 'user-1',
        roles: roleCodes.map((code) => ({ role: { code } })),
      })),
    },
    recipientMember: {
      findFirst: jest.fn(async () => authority),
    },
    careRecipient: {
      findFirst: jest.fn(async () => ({ id: 'recipient-1' })),
    },
  };
}

const fullAuthority = {
  canManageProfile: true,
  canManageConsent: true,
  canManageRoutine: true,
  canViewEvents: true,
  canViewConversation: true,
  canActivateDevice: true,
  canRemoteCall: true,
};

describe('HouseholdAccessPolicy', () => {
  const policy = new HouseholdAccessPolicy();

  it('reserves household and member administration for OWNER', async () => {
    const owner = makeClient(['OWNER'], fullAuthority);
    await expect(
      policy.requireHouseholdAction(
        owner as never,
        'user-1',
        'household-1',
        'MANAGE_MEMBERS',
      ),
    ).resolves.toMatchObject({ id: 'member-1' });

    const caregiver = makeClient(['CAREGIVER'], fullAuthority);
    await expect(
      policy.requireHouseholdAction(
        caregiver as never,
        'user-1',
        'household-1',
        'MANAGE_MEMBERS',
      ),
    ).rejects.toBeInstanceOf(HouseholdAccessDeniedException);
  });

  it('allows a CAREGIVER only when the recipient Care Authority grants the action', async () => {
    const granted = makeClient(['CAREGIVER'], fullAuthority);
    await expect(
      policy.requireRecipientAction(
        granted as never,
        'user-1',
        'household-1',
        'recipient-1',
        'MANAGE_RECIPIENT',
      ),
    ).resolves.toMatchObject({ id: 'member-1' });

    const denied = makeClient(['CAREGIVER'], {
      ...fullAuthority,
      canManageProfile: false,
    });
    await expect(
      policy.requireRecipientAction(
        denied as never,
        'user-1',
        'household-1',
        'recipient-1',
        'MANAGE_RECIPIENT',
      ),
    ).rejects.toBeInstanceOf(RecipientAccessDeniedException);
  });

  it('does not let a VIEWER acquire write access through boolean authority fields', async () => {
    const client = makeClient(['VIEWER'], fullAuthority);

    await expect(
      policy.requireRecipientAction(
        client as never,
        'user-1',
        'household-1',
        'recipient-1',
        'MANAGE_RECIPIENT',
      ),
    ).rejects.toBeInstanceOf(RecipientAccessDeniedException);
  });

  it('requires explicit high-risk Care Authority even for an OWNER', async () => {
    const client = makeClient(['OWNER'], null);

    await expect(
      policy.requireRecipientAction(
        client as never,
        'user-1',
        'household-1',
        'recipient-1',
        'REMOTE_CALL',
      ),
    ).rejects.toBeInstanceOf(RecipientAccessDeniedException);
  });

  it('rejects a principal with no active membership in the explicit household', async () => {
    const client = makeClient(['OWNER'], fullAuthority);
    client.householdMember.findFirst.mockResolvedValueOnce(null as never);

    await expect(
      policy.requireHouseholdAction(
        client as never,
        'user-1',
        'different-household',
        'MANAGE_MEMBERS',
      ),
    ).rejects.toBeInstanceOf(HouseholdAccessDeniedException);
  });

  it('rejects a recipient id that does not belong to the explicit household', async () => {
    const client = makeClient(['OWNER'], fullAuthority);
    client.careRecipient.findFirst.mockResolvedValueOnce(null as never);

    await expect(
      policy.requireRecipientAction(
        client as never,
        'user-1',
        'household-1',
        'recipient-from-household-2',
        'MANAGE_RECIPIENT',
      ),
    ).rejects.toBeInstanceOf(RecipientAccessDeniedException);
  });
});

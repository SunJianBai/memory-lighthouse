import { describe, expect, it, jest } from '@jest/globals';
import type { ExecutionContext } from '@nestjs/common';

import type { DeviceActivationApplicationService } from '../device-activation.application.service';
import { DeviceAuthGuard } from './device-auth.guard';

jest.mock('../device-activation.application.service', () => ({
  DeviceActivationApplicationService: class DeviceActivationApplicationService {},
}));

function contextFor(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('DeviceAuthGuard', () => {
  it('resolves a short-lived bearer access token into a device-only principal', async () => {
    const accessToken = `${'a'.repeat(30)}.${'b'.repeat(80)}.${'c'.repeat(43)}`;
    const principal = {
      kind: 'DEVICE' as const,
      tokenId: 'token-id',
      credentialId: 'credential-id',
      credentialFamilyId: 'family-id',
      deviceId: 'device-id',
      bindingId: 'binding-id',
      householdId: 'household-id',
      recipientId: 'recipient-id',
      bindingVersion: 1,
      capabilities: ['COMPANION' as const],
    };
    const resolveDevicePrincipal = jest
      .fn<(raw: string) => Promise<typeof principal>>()
      .mockResolvedValue(principal);
    const guard = new DeviceAuthGuard({
      resolveDevicePrincipal,
    } as unknown as DeviceActivationApplicationService);
    const request = {
      headers: { authorization: `Bearer ${accessToken}` },
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(resolveDevicePrincipal).toHaveBeenCalledWith(accessToken);
    expect(request).toMatchObject({
      devicePrincipal: principal,
    });
  });

  it('rejects malformed credentials before hitting storage', async () => {
    const resolveDevicePrincipal = jest.fn<() => Promise<never>>();
    const guard = new DeviceAuthGuard({
      resolveDevicePrincipal,
    } as unknown as DeviceActivationApplicationService);

    await expect(
      guard.canActivate(
        contextFor({ headers: { authorization: 'Bearer short' } }),
      ),
    ).rejects.toMatchObject({
      response: { code: 'DEVICE_CREDENTIAL_INVALID' },
    });
    expect(resolveDevicePrincipal).not.toHaveBeenCalled();
  });
});

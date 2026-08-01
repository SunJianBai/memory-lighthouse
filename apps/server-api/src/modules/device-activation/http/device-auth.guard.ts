import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

import { DeviceActivationApplicationService } from '../device-activation.application.service';
import { InvalidDeviceCredentialException } from '../device-activation.errors';
import type { DeviceAuthenticatedRequest } from './current-device.decorator';

@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(
    private readonly deviceActivation: DeviceActivationApplicationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<DeviceAuthenticatedRequest>();
    const authorization = request.headers.authorization;
    if (!authorization || Array.isArray(authorization)) {
      throw new InvalidDeviceCredentialException();
    }
    const match = /^Bearer ([A-Za-z0-9._~-]{80,4096})$/.exec(authorization);
    if (!match) {
      throw new InvalidDeviceCredentialException();
    }
    request.devicePrincipal =
      await this.deviceActivation.resolveDevicePrincipal(match[1]);
    return true;
  }
}

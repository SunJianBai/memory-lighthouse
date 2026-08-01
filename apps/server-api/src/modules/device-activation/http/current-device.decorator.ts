import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Request } from 'express';

import type { DevicePrincipal } from '../device-activation.types';

export type DeviceAuthenticatedRequest = Request & {
  devicePrincipal?: DevicePrincipal;
};

export const CurrentDevice = createParamDecorator(
  (_data: unknown, context: ExecutionContext): DevicePrincipal => {
    const request = context
      .switchToHttp()
      .getRequest<DeviceAuthenticatedRequest>();
    if (!request.devicePrincipal) {
      throw new InternalServerErrorException('Device principal is missing');
    }
    return request.devicePrincipal;
  },
);

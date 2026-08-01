import { SetMetadata } from '@nestjs/common';

import {
  REQUIRED_PLATFORM_ROLES_KEY,
  type PlatformRoleCode,
} from '../platform-operations.constants';

export const RequirePlatformRoles = (...roles: PlatformRoleCode[]) =>
  SetMetadata(REQUIRED_PLATFORM_ROLES_KEY, roles);

import type { PlatformRoleCode } from './platform-operations.constants';

export const PLATFORM_CAPABILITY_CODES = [
  'PLATFORM_DASHBOARD_READ',
  'PLATFORM_USERS_READ',
  'PLATFORM_HOUSEHOLDS_READ',
  'PLATFORM_DEVICES_READ',
  'PLATFORM_MODEL_SESSIONS_READ',
  'PLATFORM_REMOTE_SESSIONS_READ',
  'PLATFORM_AUDIT_LOGS_READ',
  'PLATFORM_PROMPTS_READ',
  'PLATFORM_PROMPTS_PUBLISH',
  'INSPECTION_GRANTS_READ',
  'INSPECTION_GRANTS_REQUEST',
  'INSPECTION_GRANTS_APPROVE',
  'INSPECTION_GRANTS_REVOKE',
  'CONTENT_INSPECTION_READ',
] as const;

export type PlatformCapabilityCode = (typeof PLATFORM_CAPABILITY_CODES)[number];

const CAPABILITIES_BY_ROLE: Readonly<
  Record<PlatformRoleCode, readonly PlatformCapabilityCode[]>
> = {
  ADMIN: [
    'PLATFORM_DASHBOARD_READ',
    'PLATFORM_USERS_READ',
    'PLATFORM_HOUSEHOLDS_READ',
    'PLATFORM_DEVICES_READ',
    'PLATFORM_MODEL_SESSIONS_READ',
    'PLATFORM_REMOTE_SESSIONS_READ',
    'PLATFORM_AUDIT_LOGS_READ',
    'PLATFORM_PROMPTS_READ',
    'PLATFORM_PROMPTS_PUBLISH',
    'INSPECTION_GRANTS_READ',
    'INSPECTION_GRANTS_APPROVE',
    'INSPECTION_GRANTS_REVOKE',
  ],
  CONTENT_AUDITOR: [
    'PLATFORM_AUDIT_LOGS_READ',
    'INSPECTION_GRANTS_READ',
    'INSPECTION_GRANTS_REQUEST',
    'INSPECTION_GRANTS_REVOKE',
    'CONTENT_INSPECTION_READ',
  ],
};

export function capabilitiesForPlatformRoles(
  roles: readonly PlatformRoleCode[],
): PlatformCapabilityCode[] {
  const capabilities = new Set<PlatformCapabilityCode>();
  for (const role of roles) {
    for (const capability of CAPABILITIES_BY_ROLE[role]) {
      capabilities.add(capability);
    }
  }
  return [...capabilities];
}

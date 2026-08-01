import type { AdminIdentity, PlatformCapability } from '../types/platform'

export function hasPlatformCapability(
  identity: AdminIdentity | null,
  capability: PlatformCapability
): boolean {
  return identity?.capabilities.includes(capability) === true
}

export function routeIsPermitted(
  identity: AdminIdentity | null,
  capability: PlatformCapability
): boolean {
  return hasPlatformCapability(identity, capability)
}

export function defaultAdminRoute(identity: AdminIdentity | null): string {
  if (hasPlatformCapability(identity, 'PLATFORM_DASHBOARD_READ')) return '/dashboard'
  if (hasPlatformCapability(identity, 'PLATFORM_AUDIT_LOGS_READ')) return '/audit-logs'
  if (hasPlatformCapability(identity, 'INSPECTION_GRANTS_READ')) return '/content-inspection'
  return '/login'
}

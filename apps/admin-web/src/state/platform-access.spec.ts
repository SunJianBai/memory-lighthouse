import { describe, expect, it } from 'vitest'

import type { AdminIdentity } from '../types/platform'
import { defaultAdminRoute, hasPlatformCapability, routeIsPermitted } from './platform-access'

function identity(
  platformRoles: AdminIdentity['platformRoles'],
  capabilities: AdminIdentity['capabilities']
): AdminIdentity {
  return {
    user: {
      id: 'user-1',
      displayName: 'Operator',
      status: 'ACTIVE',
      locale: 'zh-CN',
      timezone: 'Asia/Shanghai',
      identities: [],
      createdAt: '2026-08-01T00:00:00.000Z'
    },
    platformRoles,
    capabilities
  }
}

describe('platform access helpers', () => {
  it('selects the dashboard for administrators', () => {
    const current = identity(['ADMIN'], ['PLATFORM_DASHBOARD_READ', 'PLATFORM_AUDIT_LOGS_READ'])

    expect(defaultAdminRoute(current)).toBe('/dashboard')
    expect(routeIsPermitted(current, 'PLATFORM_USERS_READ')).toBe(false)
  })

  it('selects audit logs for content auditors without administrator access', () => {
    const current = identity(
      ['CONTENT_AUDITOR'],
      ['PLATFORM_AUDIT_LOGS_READ', 'INSPECTION_GRANTS_READ', 'CONTENT_INSPECTION_READ']
    )

    expect(defaultAdminRoute(current)).toBe('/audit-logs')
    expect(hasPlatformCapability(current, 'CONTENT_INSPECTION_READ')).toBe(true)
    expect(routeIsPermitted(current, 'PLATFORM_DASHBOARD_READ')).toBe(false)
  })

  it('rejects a missing admin identity from every protected route', () => {
    expect(routeIsPermitted(null, 'PLATFORM_AUDIT_LOGS_READ')).toBe(false)
  })
})

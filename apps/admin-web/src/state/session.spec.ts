import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdminIdentity, SessionToken } from '../types/platform'

const api = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  refreshAccessToken: vi.fn(),
  setAccessToken: vi.fn(),
  setAuthenticationFailureHandler: vi.fn()
}))

vi.mock('../api/client', () => api)

const token: SessionToken = {
  accessToken: 'access-token',
  accessTokenExpiresAt: '2026-08-01T00:05:00.000Z',
  expiresInSeconds: 300,
  clientType: 'WEB',
  refreshTokenExpiresAt: '2026-08-08T00:00:00.000Z',
  sessionId: 'session-1'
}

const adminIdentity: AdminIdentity = {
  user: {
    id: 'admin-1',
    displayName: 'Admin',
    status: 'ACTIVE',
    locale: 'zh-CN',
    timezone: 'Asia/Shanghai',
    identities: [],
    createdAt: '2026-08-01T00:00:00.000Z'
  },
  platformRoles: ['ADMIN'],
  capabilities: ['PLATFORM_DASHBOARD_READ', 'PLATFORM_AUDIT_LOGS_READ']
}

describe('admin session', () => {
  beforeEach(() => {
    vi.resetModules()
    api.apiRequest.mockReset()
    api.refreshAccessToken.mockReset()
    api.setAccessToken.mockReset()
    api.setAuthenticationFailureHandler.mockReset()
  })

  it('restores a session only after the secure admin identity endpoint succeeds', async () => {
    api.refreshAccessToken.mockResolvedValue(token)
    api.apiRequest.mockResolvedValue(adminIdentity)
    const { restoreSession, sessionState } = await import('./session')

    await restoreSession()

    expect(api.apiRequest).toHaveBeenCalledWith('/admin/identity')
    expect(sessionState.status).toBe('authenticated')
    expect(sessionState.identity).toEqual(adminIdentity)
    expect(sessionState.user).toEqual(adminIdentity.user)
  })

  it('clears a password login when the identity response has no platform role', async () => {
    api.apiRequest.mockImplementation(async (path: string) => {
      if (path === '/auth/login') return token
      return { ...adminIdentity, platformRoles: [], capabilities: [] }
    })
    const { login, sessionState } = await import('./session')

    await expect(login('household-user', 'password')).rejects.toThrow(
      '当前账号没有管理中心访问权限'
    )

    expect(api.apiRequest).toHaveBeenLastCalledWith('/admin/identity')
    expect(api.setAccessToken).toHaveBeenLastCalledWith(null)
    expect(sessionState.status).toBe('anonymous')
    expect(sessionState.identity).toBeNull()
  })
})

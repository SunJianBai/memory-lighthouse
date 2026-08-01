import { reactive } from 'vue'

import {
  apiRequest,
  refreshAccessToken,
  setAccessToken,
  setAuthenticationFailureHandler
} from '../api/client'
import type { AdminIdentity, CurrentUser, SessionToken } from '../types/platform'

type SessionStatus = 'booting' | 'anonymous' | 'authenticated'

interface SessionState {
  status: SessionStatus
  user: CurrentUser | null
  identity: AdminIdentity | null
}

export const sessionState = reactive<SessionState>({
  status: 'booting',
  user: null,
  identity: null
})

let restorePromise: Promise<void> | null = null

function clearSession(): void {
  setAccessToken(null)
  sessionState.status = 'anonymous'
  sessionState.user = null
  sessionState.identity = null
}

setAuthenticationFailureHandler(clearSession)

async function loadAdminIdentity(): Promise<AdminIdentity> {
  const identity = await apiRequest<AdminIdentity>('/admin/identity')
  if (!identity.platformRoles.some((role) => role === 'ADMIN' || role === 'CONTENT_AUDITOR')) {
    throw new Error('当前账号没有管理中心访问权限')
  }
  return identity
}

function setAuthenticated(identity: AdminIdentity): void {
  sessionState.identity = identity
  sessionState.user = identity.user
  sessionState.status = 'authenticated'
}

export async function restoreSession(): Promise<void> {
  if (sessionState.status !== 'booting') return
  if (restorePromise) return restorePromise

  restorePromise = (async () => {
    try {
      await refreshAccessToken()
      setAuthenticated(await loadAdminIdentity())
    } catch {
      clearSession()
    }
  })()

  return restorePromise
}

export async function login(identifier: string, password: string): Promise<void> {
  const token = await apiRequest<SessionToken>('/admin/auth/login', {
    method: 'POST',
    body: { identifier, password },
    authenticated: false,
    retryAuthentication: false
  })
  setAccessToken(token.accessToken)

  try {
    setAuthenticated(await loadAdminIdentity())
  } catch (error) {
    clearSession()
    throw error
  }
}

export async function logout(): Promise<void> {
  try {
    if (sessionState.status === 'authenticated') {
      await apiRequest('/admin/auth/logout', { method: 'POST' })
    }
  } finally {
    clearSession()
  }
}

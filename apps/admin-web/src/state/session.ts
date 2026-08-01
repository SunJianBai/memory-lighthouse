import { reactive } from 'vue'

import {
  apiRequest,
  refreshAccessToken,
  setAccessToken,
  setAuthenticationFailureHandler
} from '../api/client'
import type { CurrentUser, SessionToken } from '../types/platform'

type SessionStatus = 'booting' | 'anonymous' | 'authenticated'

interface SessionState {
  status: SessionStatus
  user: CurrentUser | null
}

export const sessionState = reactive<SessionState>({
  status: 'booting',
  user: null
})

let restorePromise: Promise<void> | null = null

function clearSession(): void {
  setAccessToken(null)
  sessionState.status = 'anonymous'
  sessionState.user = null
}

setAuthenticationFailureHandler(clearSession)

async function loadCurrentUser(): Promise<CurrentUser> {
  return apiRequest<CurrentUser>('/me')
}

export async function restoreSession(): Promise<void> {
  if (sessionState.status !== 'booting') return
  if (restorePromise) return restorePromise

  restorePromise = (async () => {
    try {
      await refreshAccessToken()
      const user = await loadCurrentUser()
      sessionState.user = user
      sessionState.status = 'authenticated'
    } catch {
      clearSession()
    }
  })()

  return restorePromise
}

export async function login(identifier: string, password: string): Promise<void> {
  const token = await apiRequest<SessionToken>('/auth/login', {
    method: 'POST',
    body: { identifier, password, clientType: 'WEB' },
    authenticated: false,
    retryAuthentication: false
  })
  setAccessToken(token.accessToken)

  try {
    const user = await loadCurrentUser()
    sessionState.user = user
    sessionState.status = 'authenticated'
  } catch (error) {
    clearSession()
    throw error
  }
}

export async function logout(): Promise<void> {
  try {
    if (sessionState.status === 'authenticated') {
      await apiRequest('/auth/logout', { method: 'POST' })
    }
  } finally {
    clearSession()
  }
}

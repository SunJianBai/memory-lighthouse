import { API_BASE } from '../config/runtime'
import type { ApiErrorPayload, ApiSuccess, SessionToken } from '../types/platform'

export class ApiRequestError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId?: string
  readonly details?: Record<string, unknown>

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message || '请求失败')
    this.name = 'ApiRequestError'
    this.status = status
    this.code = payload.code || 'REQUEST_FAILED'
    this.requestId = payload.requestId
    this.details = payload.details
  }
}

interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  authenticated?: boolean
  retryAuthentication?: boolean
}

let accessToken: string | null = null
let refreshInFlight: Promise<SessionToken> | null = null
let authenticationFailureHandler: (() => void) | null = null

export function setAccessToken(token: string | null): void {
  accessToken = token
}

export function setAuthenticationFailureHandler(handler: () => void): void {
  authenticationFailureHandler = handler
}

export function isApiRequestError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError
}

function requestUrl(path: string): string {
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`
}

async function readPayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    return null
  }

  try {
    return await response.json()
  } catch {
    return null
  }
}

function errorPayload(value: unknown, status: number): ApiErrorPayload {
  if (typeof value === 'object' && value !== null) {
    const candidate = value as Partial<ApiErrorPayload>
    return {
      code: typeof candidate.code === 'string' ? candidate.code : `HTTP_${status}`,
      message:
        typeof candidate.message === 'string' ? candidate.message : `请求失败（HTTP ${status}）`,
      ...(typeof candidate.requestId === 'string' ? { requestId: candidate.requestId } : {}),
      ...(candidate.details && typeof candidate.details === 'object'
        ? { details: candidate.details }
        : {})
    }
  }

  return { code: `HTTP_${status}`, message: `请求失败（HTTP ${status}）` }
}

async function performRequest<T>(path: string, options: ApiRequestOptions): Promise<T> {
  const {
    body,
    authenticated = true,
    retryAuthentication = true,
    ...requestOptions
  } = options
  const headers = new Headers(requestOptions.headers)
  const hasBody = body !== undefined

  if (hasBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  headers.set('Accept', 'application/json')
  if (authenticated && accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  }

  let response: Response
  try {
    response = await fetch(requestUrl(path), {
      ...requestOptions,
      headers,
      body: hasBody ? JSON.stringify(body) : undefined,
      credentials: 'include',
      cache: 'no-store'
    })
  } catch {
    throw new ApiRequestError(0, {
      code: 'NETWORK_ERROR',
      message: '无法连接服务器，请检查网络与 API 服务状态。'
    })
  }

  if (response.status === 401 && authenticated && retryAuthentication) {
    try {
      await refreshAccessToken()
      return performRequest<T>(path, { ...options, retryAuthentication: false })
    } catch {
      setAccessToken(null)
      authenticationFailureHandler?.()
    }
  }

  const payload = await readPayload(response)
  if (!response.ok) {
    throw new ApiRequestError(response.status, errorPayload(payload, response.status))
  }

  if (
    typeof payload !== 'object' ||
    payload === null ||
    (payload as Partial<ApiSuccess<T>>).code !== 'OK' ||
    !('data' in payload)
  ) {
    throw new ApiRequestError(response.status, {
      code: 'INVALID_API_RESPONSE',
      message: '服务器返回了无法识别的数据格式。'
    })
  }

  return (payload as ApiSuccess<T>).data
}

export function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  return performRequest<T>(path, options)
}

export function refreshAccessToken(): Promise<SessionToken> {
  if (!refreshInFlight) {
    refreshInFlight = performRequest<SessionToken>('/admin/auth/refresh', {
      method: 'POST',
      authenticated: false,
      retryAuthentication: false
    })
      .then((token) => {
        setAccessToken(token.accessToken)
        return token
      })
      .finally(() => {
        refreshInFlight = null
      })
  }

  return refreshInFlight
}

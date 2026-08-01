import { ApiRequestError } from '../api/client'

export function formatDate(value: unknown): string {
  if (typeof value !== 'string' || !value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date)
}

export function formatNumber(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat('zh-CN').format(value)
    : '—'
}

export function safeText(value: unknown, fallback = '—'): string {
  if (typeof value === 'string') return value || fallback
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return fallback
}

export function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function compactId(value: unknown): string {
  const id = safeText(value)
  if (id.length <= 16) return id
  return `${id.slice(0, 8)}…${id.slice(-6)}`
}

export function formatError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    const messages: Record<string, string> = {
      INVALID_CREDENTIALS: '用户名或密码错误，请重新输入。',
      PLATFORM_ACCESS_DENIED: '当前账号无权访问此数据，请使用具备对应平台角色的账号。',
      INSPECTION_GRANT_SELF_APPROVAL_FORBIDDEN: '申请人不能审批自己的检查授权，请由另一名管理员处理。',
      INSPECTION_GRANT_STATE_INVALID: '授权状态已经变化，请刷新列表后重试。',
      INSPECTION_GRANT_SCOPE_DENIED: '所选授权不覆盖该资源或数据类别。',
      CONTENT_INSPECTION_CONSENT_REQUIRED: '长者当前未授予内容检查同意，不能查看原文。',
      INSPECTION_RESOURCE_NOT_FOUND: '没有找到指定资源，请核对 ID。',
      INSPECTION_CONTENT_UNAVAILABLE: '原文不存在、已清除或超过保留期限。',
      RATE_LIMITED: '请求过于频繁，请稍后再试。'
    }
    const knownMessage = messages[error.code]
    if (knownMessage) return knownMessage
    if (error.status === 403) return '当前账号无权访问此数据，请使用具备对应平台角色的账号。'
    if (error.status === 404 && error.code === 'DEVELOPMENT_CONTENT_INSPECTION_UNAVAILABLE') {
      return '原文检查能力已关闭；这是生产环境的预期安全状态。'
    }
    return `${error.message}${error.requestId ? `（请求号：${error.requestId}）` : ''}`
  }
  return '发生未知错误，请重试。'
}

export function statusTone(status: unknown): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  const normalized = safeText(status, '').toUpperCase()
  if (['ACTIVE', 'CONNECTED', 'COMPLETED', 'ALLOW', 'ONLINE'].includes(normalized)) {
    return 'success'
  }
  if (['PENDING', 'REQUESTED', 'RINGING', 'ACCEPTED'].includes(normalized)) return 'warning'
  if (['FAILED', 'REVOKED', 'REJECTED', 'DENY', 'DISABLED', 'EXPIRED'].includes(normalized)) {
    return 'danger'
  }
  if (['RUNNING', 'CONNECTING', 'BOUND'].includes(normalized)) return 'info'
  return 'neutral'
}

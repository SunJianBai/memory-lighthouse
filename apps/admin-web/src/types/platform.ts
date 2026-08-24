export interface ApiSuccess<T> {
  code: 'OK'
  message: string
  data: T
  requestId: string
}

export interface ApiErrorPayload {
  code: string
  message: string
  requestId?: string
  details?: Record<string, unknown>
}

export interface SessionToken {
  accessToken: string
  accessTokenExpiresAt: string
  expiresInSeconds: number
  purpose: 'ADMIN_WEB'
  refreshTokenExpiresAt: string
  sessionId: string
}

export interface LoginIdentity {
  type: string
  value: string
  verifiedAt: string | null
  isPrimary: boolean
}

export interface CurrentUser {
  id: string
  displayName: string
  status: string
  locale: string
  timezone: string
  identities: LoginIdentity[]
  createdAt: string
}

export type PlatformRole = 'ADMIN' | 'CONTENT_AUDITOR'

export type PlatformCapability =
  | 'PLATFORM_DASHBOARD_READ'
  | 'PLATFORM_USERS_READ'
  | 'PLATFORM_HOUSEHOLDS_READ'
  | 'PLATFORM_DEVICES_READ'
  | 'PLATFORM_MODEL_SESSIONS_READ'
  | 'PLATFORM_REMOTE_SESSIONS_READ'
  | 'PLATFORM_AUDIT_LOGS_READ'
  | 'PLATFORM_PROMPTS_READ'
  | 'PLATFORM_PROMPTS_PUBLISH'
  | 'INSPECTION_GRANTS_READ'
  | 'INSPECTION_GRANTS_REQUEST'
  | 'INSPECTION_GRANTS_APPROVE'
  | 'INSPECTION_GRANTS_REVOKE'
  | 'CONTENT_INSPECTION_READ'

export interface AdminIdentity {
  user: CurrentUser
  platformRoles: PlatformRole[]
  capabilities: PlatformCapability[]
}

export interface PlatformPage<T = Record<string, unknown>> {
  items: T[]
  page: number
  limit: number
  total: number
  hasNext: boolean
}

export interface OperationsDashboard {
  generatedAt: string
  users: { total: number; active: number }
  households: { total: number }
  devices: { total: number; activelyBound: number }
  modelSessions: { last24Hours: number; failedLast24Hours: number }
  remoteSessions: { last24Hours: number }
  inspectionGrants: { pending: number }
}

export type InspectionDataCategory = 'MEMORY_REVISION' | 'CONVERSATION_UTTERANCE'
export type InspectionGrantStatus = 'PENDING' | 'ACTIVE' | 'REVOKED' | 'EXPIRED'

export interface InspectionGrant {
  id: string
  environment: string
  requestedByUserId: string
  approvedByUserId: string | null
  householdId: string
  recipientId: string | null
  dataCategories: InspectionDataCategory[]
  reason: string
  ticketReference: string | null
  status: InspectionGrantStatus
  validFrom: string
  expiresAt: string
  revokedAt: string | null
  createdAt: string
}

export interface InspectionWatermark {
  operatorUserId: string
  grantId: string
  requestId: string
  occurredAt: string
}

export interface MemoryInspectionResult {
  id: string
  memoryId: string
  revisionNo: number
  kind: string
  title: string
  sensitivity: string
  verificationStatus: string
  source: string
  content: string
  createdAt: string
  watermark: InspectionWatermark
}

export interface UtteranceInspectionResult {
  id: string
  modelSessionId: string
  sequenceNo: number
  speaker: string
  isFinal: boolean
  language: string | null
  confidence: number | null
  rawText: string
  charCount: number
  createdAt: string
  watermark: InspectionWatermark
}

export interface CompanionPrompt {
  id: string
  code: string
  composerVersion: number
  provider: string
  model: string
  content: string
  contentHash: string
  publishedAt: string
}

export interface PublishCompanionPromptInput {
  expectedCurrentPromptId: string
  content: string
  reason: string
}

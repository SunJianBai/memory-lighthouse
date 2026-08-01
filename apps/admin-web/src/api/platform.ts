import { apiRequest } from './client'
import type {
  InspectionDataCategory,
  InspectionGrant,
  MemoryInspectionResult,
  OperationsDashboard,
  PlatformPage,
  UtteranceInspectionResult
} from '../types/platform'

export interface PageQuery {
  page?: number
  limit?: number
  search?: string
  status?: string
  householdId?: string
}

export interface RequestInspectionGrantInput {
  householdId: string
  recipientId?: string
  dataCategories: InspectionDataCategory[]
  reason: string
  ticketReference?: string
  expiresInSeconds: number
}

function queryString(query: PageQuery): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value))
    }
  }
  const encoded = search.toString()
  return encoded ? `?${encoded}` : ''
}

export function getDashboard(): Promise<OperationsDashboard> {
  return apiRequest('/admin/operations/dashboard')
}

export function listPlatformResource(
  endpoint: string,
  query: PageQuery
): Promise<PlatformPage> {
  return apiRequest(`/admin/${endpoint}${queryString(query)}`)
}

export function listInspectionGrants(query: PageQuery): Promise<PlatformPage<InspectionGrant>> {
  return apiRequest(`/admin/inspection-grants${queryString(query)}`)
}

export function requestInspectionGrant(
  input: RequestInspectionGrantInput
): Promise<InspectionGrant> {
  return apiRequest('/admin/inspection-grants', { method: 'POST', body: input })
}

export function approveInspectionGrant(grantId: string): Promise<InspectionGrant> {
  return apiRequest(`/admin/inspection-grants/${encodeURIComponent(grantId)}/approve`, {
    method: 'POST'
  })
}

export function revokeInspectionGrant(grantId: string): Promise<InspectionGrant> {
  return apiRequest(`/admin/inspection-grants/${encodeURIComponent(grantId)}/revoke`, {
    method: 'POST'
  })
}

export function inspectMemory(
  memoryId: string,
  grantId: string,
  revisionId?: string
): Promise<MemoryInspectionResult> {
  const params = new URLSearchParams({ grantId })
  if (revisionId) params.set('revisionId', revisionId)
  return apiRequest(
    `/admin/inspections/memories/${encodeURIComponent(memoryId)}?${params.toString()}`
  )
}

export function inspectUtterance(
  utteranceId: string,
  grantId: string
): Promise<UtteranceInspectionResult> {
  const params = new URLSearchParams({ grantId })
  return apiRequest(
    `/admin/inspections/utterances/${encodeURIComponent(utteranceId)}?${params.toString()}`
  )
}

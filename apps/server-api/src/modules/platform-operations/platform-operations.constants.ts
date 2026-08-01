export const PLATFORM_ROLE_CODES = ['ADMIN', 'CONTENT_AUDITOR'] as const;
export type PlatformRoleCode = (typeof PLATFORM_ROLE_CODES)[number];

export const INSPECTION_DATA_CATEGORIES = [
  'MEMORY_REVISION',
  'CONVERSATION_UTTERANCE',
] as const;
export type InspectionDataCategory =
  (typeof INSPECTION_DATA_CATEGORIES)[number];

export const INSPECTION_GRANT_STATUS = {
  pending: 'PENDING',
  active: 'ACTIVE',
  revoked: 'REVOKED',
} as const;

export const CONTENT_INSPECTION_ENVIRONMENT = 'development';
export const CONTENT_INSPECTION_CONSENT_SCOPE = 'CONTENT_INSPECTION';
export const CONTENT_INSPECTION_MAX_TTL_SECONDS = 15 * 60;
export const PLATFORM_PAGE_DEFAULT = 20;
export const PLATFORM_PAGE_MAX = 100;
export const AUDIT_SERIALIZABLE_RETRY_LIMIT = 3;

export const REQUIRED_PLATFORM_ROLES_KEY = Symbol(
  'REQUIRED_PLATFORM_ROLES_KEY',
);

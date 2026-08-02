export const DATA_ENCRYPTION_PORT = Symbol('DATA_ENCRYPTION_PORT');
export const OBJECT_STORAGE_PORT = Symbol('OBJECT_STORAGE_PORT');
export const MALWARE_SCANNER_PORT = Symbol('MALWARE_SCANNER_PORT');

export const MEMORY_STATUS = {
  active: 'ACTIVE',
  deleted: 'DELETED',
} as const;

export const MEMORY_SENSITIVITIES = ['HOUSEHOLD', 'SENSITIVE'] as const;

export const MEMORY_VERIFICATION_STATUSES = [
  'UNVERIFIED',
  'FAMILY_REPORTED',
  'FAMILY_VERIFIED',
] as const;

export const ASSET_STATUS = {
  pendingUpload: 'PENDING_UPLOAD',
  active: 'ACTIVE',
  pendingDelete: 'PENDING_DELETE',
  deleted: 'DELETED',
} as const;

export const ASSET_SCAN_STATUS = {
  pending: 'PENDING',
  clean: 'CLEAN',
  quarantined: 'QUARANTINED',
  failed: 'FAILED',
} as const;

export const MEDICATION_STATUS = {
  active: 'ACTIVE',
  deleted: 'DELETED',
} as const;

export const MEMORY_PAGE_DEFAULT = 20;
export const MEMORY_PAGE_MAX = 50;
export const ASSET_UPLOAD_TTL_SECONDS = 300;
export const ASSET_DOWNLOAD_TTL_SECONDS = 60;
export const MAX_ASSET_BYTES = 100 * 1024 * 1024;

export const ASSET_LIFECYCLE_EVENT = {
  scanRequested: 'asset.scan-requested',
  deleteRequested: 'asset.delete-requested',
} as const;

export const ASSET_LIFECYCLE_CONSUMER = 'asset-lifecycle-v1';

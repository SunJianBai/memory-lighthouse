export const CONSENT_ACCESS_PORT = Symbol('CONSENT_ACCESS_PORT');

/**
 * The complete set of consent scopes supported by this release.
 *
 * REMOTE_ASSISTANCE_* authorizes live media transport only. Recording and
 * remote-call transcription deliberately have no scope, so they cannot be
 * enabled accidentally by accepting an unknown string.
 */
export const CONSENT_SCOPES = [
  'CAMERA_CAPTURE',
  'MICROPHONE_CAPTURE',
  'MODEL_PROCESSING',
  'MODEL_INPUT_TRANSCRIPTION',
  'REMOTE_ASSISTANCE_AUDIO',
  'REMOTE_ASSISTANCE_VIDEO',
  'MEMORY_STORAGE',
  'CONTENT_INSPECTION',
] as const;

export type ConsentScope = (typeof CONSENT_SCOPES)[number];

export const CONSENT_DECISIONS = {
  granted: 'GRANTED',
  revoked: 'REVOKED',
  notGranted: 'NOT_GRANTED',
} as const;

export type PersistedConsentDecision =
  typeof CONSENT_DECISIONS.granted | typeof CONSENT_DECISIONS.revoked;

export const CONSENT_EVENT_PAGE_DEFAULT = 50;
export const CONSENT_EVENT_PAGE_MAX = 100;

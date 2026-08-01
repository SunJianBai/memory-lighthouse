export const COMPANION_SESSION_STATUS = {
  active: 'ACTIVE',
  ended: 'ENDED',
} as const;

export const MODEL_SESSION_STATUS = {
  active: 'ACTIVE',
  ended: 'ENDED',
  failed: 'FAILED',
} as const;

export const COMPANION_MODES = ['AUDIO', 'AUDIO_VIDEO'] as const;
export type CompanionMode = (typeof COMPANION_MODES)[number];

export const UTTERANCE_SPEAKERS = ['USER', 'ASSISTANT'] as const;
export type UtteranceSpeaker = (typeof UTTERANCE_SPEAKERS)[number];

export const UTTERANCE_SOURCES = ['ASR', 'MODEL'] as const;
export type UtteranceSource = (typeof UTTERANCE_SOURCES)[number];

export const MODEL_EVENT_TYPES = [
  'CONNECTING',
  'CONNECTED',
  'QUEUED',
  'FIRST_RESPONSE',
  'INTERRUPTED',
  'PROVIDER_ERROR',
  'DISCONNECTED',
] as const;
export type ModelEventType = (typeof MODEL_EVENT_TYPES)[number];

export const DEFAULT_PROMPT_CODE = 'COMPANION_SYSTEM';

export function promptEncryptionContext(
  promptId: string,
  version: number,
): string {
  return `prompt:${promptId}:version:${version}`;
}

export function utteranceEncryptionContext(utteranceId: string): string {
  return `conversation-utterance:${utteranceId}:content:v1`;
}

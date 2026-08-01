import { z } from 'zod';

export const consentScopes = [
  'CAMERA_CAPTURE',
  'MICROPHONE_CAPTURE',
  'MODEL_PROCESSING',
  'MODEL_INPUT_TRANSCRIPTION',
  'REMOTE_ASSISTANCE_AUDIO',
  'REMOTE_ASSISTANCE_VIDEO',
  'MEMORY_STORAGE',
  'CONTENT_INSPECTION',
] as const;

export const consentScopeSchema = z.enum(consentScopes);
export type ConsentScope = z.infer<typeof consentScopeSchema>;

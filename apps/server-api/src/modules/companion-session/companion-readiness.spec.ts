import { describe, expect, it } from '@jest/globals';
import {
  companionReadiness,
  requiredCompanionConsent,
} from './companion-readiness';

const configuration = {
  provider: 'modelbest',
  model: 'MiniCPM-o',
  realtimeUrl: 'wss://model.example/realtime?secret=private',
};
const check = (decisions: Record<string, boolean>, model = configuration) =>
  companionReadiness(
    'device',
    'binding',
    { capturedAt: '2026-09-20T04:00:00Z', decisions },
    model,
  );

describe('companion startup checks', () => {
  it('defaults to denied and uses the same ordered scopes as runtime startup', () => {
    const result = check({});
    expect(result.authorization.audio).toEqual({
      allowed: false,
      missingScopes: requiredCompanionConsent('AUDIO'),
    });
    expect(result.authorization.audioVideo).toEqual({
      allowed: false,
      missingScopes: requiredCompanionConsent('AUDIO_VIDEO'),
    });
  });
  it('keeps camera consent separate from audio', () => {
    const result = check({ MICROPHONE_CAPTURE: true, MODEL_PROCESSING: true });
    expect(result.authorization.audio.allowed).toBe(true);
    expect(result.authorization.audioVideo).toEqual({
      allowed: false,
      missingScopes: ['CAMERA_CAPTURE'],
    });
  });
  it('reports configuration only, without model URLs or private configuration', () => {
    const result = check({
      MICROPHONE_CAPTURE: true,
      CAMERA_CAPTURE: true,
      MODEL_PROCESSING: true,
    });
    expect(result.authorization.audioVideo.allowed).toBe(true);
    expect(result.model).toEqual({
      configurationStatus: 'CONFIGURED',
      connectionStatus: 'NOT_TESTED',
    });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(JSON.stringify(result)).not.toContain('model.example');
  });
  it.each([
    '',
    'https://example.com',
    'not a url',
    'wss://user:secret@example.com',
  ])('rejects unusable WebSocket configuration %s', (realtimeUrl) => {
    expect(
      check({}, { ...configuration, realtimeUrl }).model.configurationStatus,
    ).toBe('INVALID');
  });
  it('rejects empty model configuration but permits local WebSocket configuration', () => {
    expect(
      check({}, { ...configuration, model: ' ' }).model.configurationStatus,
    ).toBe('INVALID');
    expect(
      check({}, { ...configuration, realtimeUrl: 'ws://127.0.0.1:8000' }).model
        .configurationStatus,
    ).toBe('CONFIGURED');
  });
});

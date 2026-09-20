import type {
  ConsentSnapshot,
  DeviceReadinessView,
} from './companion-session.types';

export function requiredCompanionConsent(mode: string): string[] {
  return [
    'MICROPHONE_CAPTURE',
    'MODEL_PROCESSING',
    ...(mode === 'AUDIO_VIDEO' ? ['CAMERA_CAPTURE'] : []),
  ];
}

export function companionReadiness(
  deviceId: string,
  bindingId: string,
  consent: ConsentSnapshot,
  model: { provider: string; model: string; realtimeUrl: string },
): DeviceReadinessView {
  const authorization = (mode: string) => {
    const missingScopes = requiredCompanionConsent(mode).filter(
      (scope) => consent.decisions[scope] !== true,
    );
    return { allowed: missingScopes.length === 0, missingScopes };
  };
  let configured = false;
  try {
    const url = new URL(model.realtimeUrl);
    configured =
      Boolean(model.provider.trim() && model.model.trim() && url.hostname) &&
      ['ws:', 'wss:'].includes(url.protocol) &&
      !url.username &&
      !url.password;
  } catch {
    // Configuration validation is not a connection or credential probe.
  }
  return {
    schemaVersion: 1,
    deviceId,
    bindingId,
    checkedAt: consent.capturedAt,
    authorization: {
      audio: authorization('AUDIO'),
      audioVideo: authorization('AUDIO_VIDEO'),
    },
    model: {
      configurationStatus: configured ? 'CONFIGURED' : 'INVALID',
      connectionStatus: 'NOT_TESTED',
    },
  };
}

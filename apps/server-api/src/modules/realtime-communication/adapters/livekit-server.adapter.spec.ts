import { describe, expect, it, jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';

import { LiveKitServerAdapter } from './livekit-server.adapter';

function adapter() {
  const values: Record<string, string> = {
    NODE_ENV: 'test',
    LIVEKIT_URL: 'ws://127.0.0.1:17880',
    LIVEKIT_PUBLIC_URL: 'wss://rtc.example.test',
    LIVEKIT_API_KEY: 'test-api-key',
    LIVEKIT_API_SECRET: '0123456789abcdef0123456789abcdef',
  };
  const config = {
    get: jest.fn((key: string) => values[key]),
  };
  return new LiveKitServerAdapter(config as unknown as ConfigService);
}

function claims(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  if (!payload) {
    throw new Error('JWT payload missing');
  }
  return JSON.parse(
    Buffer.from(payload, 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
}

describe('LiveKitServerAdapter least-privilege tickets', () => {
  it('limits a family ticket to the requested room and microphone source', async () => {
    const result = await adapter().issueJoinTicket({
      roomName: 'ml_private_room',
      identity: 'family_session_participant',
      displayName: '家属甲',
      ttlSeconds: 120,
      publishMicrophone: true,
      publishCamera: false,
      canSubscribe: true,
      metadata: {
        remoteSessionId: 'session-1',
        recording: 'false',
        transcription: 'false',
      },
    });

    const payload = claims(result.token);
    expect(payload.sub).toBe('family_session_participant');
    expect(payload.video).toEqual({
      roomJoin: true,
      room: 'ml_private_room',
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      canUpdateOwnMetadata: false,
      canPublishSources: ['microphone'],
    });
    expect(JSON.parse(payload.metadata as string)).toEqual(
      expect.objectContaining({
        recording: 'false',
        transcription: 'false',
      }),
    );
    expect(payload).not.toHaveProperty('roomAdmin');
  });

  it('explicitly disables publishing when a participant has no source grant', async () => {
    const result = await adapter().issueJoinTicket({
      roomName: 'ml_receive_only',
      identity: 'receive_only',
      displayName: '只接收',
      ttlSeconds: 60,
      publishMicrophone: false,
      publishCamera: false,
      canSubscribe: true,
      metadata: {},
    });

    expect(claims(result.token).video).toEqual(
      expect.objectContaining({
        canPublish: false,
        canPublishSources: [],
        canPublishData: false,
        canSubscribe: true,
      }),
    );
  });
});

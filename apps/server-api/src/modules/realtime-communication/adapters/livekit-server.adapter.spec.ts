import { describe, expect, it, jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import { ServerError } from 'livekit-server-sdk';

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
  it('uses a provider deadline shorter than the room-fencing transaction', () => {
    const instance = adapter();
    const roomClient = Reflect.get(instance, 'rooms') as unknown as {
      rpc: { requestTimeout: number; failover: boolean };
    };

    expect(roomClient.rpc.requestTimeout).toBe(3);
    expect(roomClient.rpc.failover).toBe(false);
  });

  it('explicitly creates a two-participant room before clients join', async () => {
    const instance = adapter();
    const createRoom = jest.fn(async () => ({ name: 'ml_private_room' }));
    Reflect.set(instance, 'rooms', { createRoom });

    await expect(
      instance.ensureRoom('ml_private_room'),
    ).resolves.toBeUndefined();

    expect(createRoom).toHaveBeenCalledWith({
      name: 'ml_private_room',
      maxParticipants: 2,
      emptyTimeout: 60,
    });
  });

  it('treats LiveKit AlreadyExists as an idempotent room ensure', async () => {
    const instance = adapter();
    Reflect.set(instance, 'rooms', {
      createRoom: jest.fn(async () => {
        throw new ServerError(
          'Conflict',
          'room already exists',
          409,
          'already_exists',
        );
      }),
    });

    await expect(
      instance.ensureRoom('ml_private_room'),
    ).resolves.toBeUndefined();
  });

  it('maps room creation failures other than AlreadyExists to provider unavailability', async () => {
    const instance = adapter();
    Reflect.set(instance, 'rooms', {
      createRoom: jest.fn(async () => {
        throw new ServerError(
          'Internal Server Error',
          'provider failed',
          500,
          'internal',
        );
      }),
    });

    await expect(instance.ensureRoom('ml_private_room')).rejects.toMatchObject({
      response: { code: 'MEDIA_PROVIDER_UNAVAILABLE' },
    });
  });

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

  it('carries the webhook event id, connection SID and signed ticket metadata', async () => {
    const instance = adapter();
    Reflect.set(instance, 'webhooks', {
      receive: jest.fn(async () => ({
        id: 'EV_webhook_uuid',
        event: 'participant_joined',
        createdAt: BigInt(1_785_552_000),
        room: { name: 'ml_private_room' },
        participant: {
          identity: 'family_session_participant',
          sid: 'PA_connection_sid',
          metadata: JSON.stringify({
            participantId: '01J00000000000000000000001',
            ticketId: '01J00000000000000000000002',
          }),
        },
      })),
    });

    await expect(
      instance.verifyWebhook('signed-body', 'Bearer signed-webhook'),
    ).resolves.toEqual(
      expect.objectContaining({
        eventId: 'EV_webhook_uuid',
        participantSid: 'PA_connection_sid',
        participantId: '01J00000000000000000000001',
        participantTicketId: '01J00000000000000000000002',
      }),
    );
  });

  it('keeps malformed participant metadata non-authoritative', async () => {
    const instance = adapter();
    Reflect.set(instance, 'webhooks', {
      receive: jest.fn(async () => ({
        id: 'EV_malformed_metadata',
        event: 'participant_joined',
        createdAt: BigInt(1_785_552_000),
        room: { name: 'ml_private_room' },
        participant: {
          identity: 'family_session_participant',
          sid: 'PA_connection_sid',
          metadata: '{not-json',
        },
      })),
    });

    await expect(
      instance.verifyWebhook('signed-body', 'Bearer signed-webhook'),
    ).resolves.toEqual(
      expect.objectContaining({
        participantId: null,
        participantTicketId: null,
      }),
    );
  });

  it('removes a participant without claiming self-hosted token revocation', async () => {
    const instance = adapter();
    const removeParticipant = jest.fn(async () => undefined);
    Reflect.set(instance, 'rooms', { removeParticipant });

    await instance.removeParticipant('ml_private_room', 'family_identity');

    expect(removeParticipant).toHaveBeenCalledWith(
      'ml_private_room',
      'family_identity',
    );
  });

  it('treats an already absent room as successful terminal cleanup', async () => {
    const instance = adapter();
    Reflect.set(instance, 'rooms', {
      deleteRoom: jest.fn(async () => {
        throw new ServerError('Not Found', 'room not found', 404, 'not_found');
      }),
    });

    await expect(
      instance.deleteRoom('ml_terminal_room'),
    ).resolves.toBeUndefined();
  });
});

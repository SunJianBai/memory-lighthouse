import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TrackSource } from '@livekit/protocol';
import {
  AccessToken,
  RoomServiceClient,
  ServerError,
  WebhookReceiver,
} from 'livekit-server-sdk';

import type { LiveKitPort } from '../ports/livekit.port';
import {
  LIVEKIT_RPC_TIMEOUT_SECONDS,
  REMOTE_JOIN_TICKET_TTL_SECONDS,
} from '../realtime.constants';
import {
  LiveKitUnavailableException,
  LiveKitWebhookInvalidException,
} from '../realtime.errors';
import type {
  LiveKitJoinTicketCommand,
  VerifiedLiveKitWebhook,
} from '../realtime.types';

@Injectable()
export class LiveKitServerAdapter implements LiveKitPort {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly publicUrl: string;
  private readonly rooms: RoomServiceClient;
  private readonly webhooks: WebhookReceiver;

  constructor(config: ConfigService) {
    const internalUrl = config.get<string>('LIVEKIT_URL')?.trim();
    const publicUrl =
      config.get<string>('LIVEKIT_PUBLIC_URL')?.trim() || internalUrl;
    const apiKey = config.get<string>('LIVEKIT_API_KEY')?.trim();
    const apiSecret = config.get<string>('LIVEKIT_API_SECRET')?.trim();
    if (!internalUrl || !publicUrl || !apiKey || !apiSecret) {
      throw new Error(
        'LIVEKIT_URL, LIVEKIT_PUBLIC_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET are required',
      );
    }
    if (!/^wss?:\/\//.test(publicUrl)) {
      throw new Error('LIVEKIT_PUBLIC_URL must use ws:// or wss://');
    }
    if (
      config.get<string>('NODE_ENV') === 'production' &&
      !publicUrl.startsWith('wss://')
    ) {
      throw new Error('LIVEKIT_PUBLIC_URL must use wss:// in production');
    }
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.publicUrl = publicUrl;
    this.rooms = new RoomServiceClient(
      toHttpUrl(internalUrl),
      apiKey,
      apiSecret,
      {
        requestTimeout: LIVEKIT_RPC_TIMEOUT_SECONDS,
        failover: false,
      },
    );
    this.webhooks = new WebhookReceiver(apiKey, apiSecret);
  }

  async ensureRoom(roomName: string): Promise<void> {
    try {
      await this.rooms.createRoom({
        name: roomName,
        maxParticipants: 2,
        emptyTimeout: REMOTE_JOIN_TICKET_TTL_SECONDS,
      });
    } catch (error) {
      // Family and device ticket requests may race. Creating the same named
      // room is therefore deliberately idempotent; no other provider error is
      // safe to ignore because auto-creation is disabled.
      if (error instanceof ServerError && error.code === 'already_exists') {
        return;
      }
      throw new LiveKitUnavailableException();
    }
  }

  async issueJoinTicket(command: LiveKitJoinTicketCommand): Promise<{
    token: string;
    url: string;
    expiresAt: Date;
  }> {
    try {
      const token = new AccessToken(this.apiKey, this.apiSecret, {
        identity: command.identity,
        name: command.displayName,
        ttl: command.ttlSeconds,
        metadata: JSON.stringify(command.metadata),
      });
      const publishSources: TrackSource[] = [];
      if (command.publishMicrophone) {
        publishSources.push(TrackSource.MICROPHONE);
      }
      if (command.publishCamera) {
        publishSources.push(TrackSource.CAMERA);
      }
      token.addGrant({
        roomJoin: true,
        room: command.roomName,
        // Be explicit here: LiveKit defaults publish and subscribe to enabled
        // when both fields are omitted. `canPublishSources` narrows the source
        // list, while `canPublish` prevents an empty list from inheriting a
        // permissive server default on version changes.
        canPublish: publishSources.length > 0,
        canSubscribe: command.canSubscribe,
        canPublishData: false,
        canUpdateOwnMetadata: false,
        canPublishSources: publishSources,
      });
      return {
        token: await token.toJwt(),
        url: this.publicUrl,
        expiresAt: new Date(Date.now() + command.ttlSeconds * 1_000),
      };
    } catch {
      throw new LiveKitUnavailableException();
    }
  }

  async removeParticipant(roomName: string, identity: string): Promise<void> {
    try {
      // On self-hosted LiveKit this disconnects the current participant but
      // does not revoke refreshed access tokens. Disabled room auto-creation
      // plus deleteRoom provide the terminal-session boundary.
      await this.rooms.removeParticipant(roomName, identity);
    } catch {
      throw new LiveKitUnavailableException();
    }
  }

  async deleteRoom(roomName: string): Promise<void> {
    try {
      await this.rooms.deleteRoom(roomName);
    } catch (error) {
      // Cleanup is retried from every terminal reconciliation. An already
      // absent room satisfies the same fail-closed postcondition.
      if (error instanceof ServerError && error.code === 'not_found') {
        return;
      }
      throw new LiveKitUnavailableException();
    }
  }

  async verifyWebhook(
    rawBody: string,
    authorization: string | undefined,
  ): Promise<VerifiedLiveKitWebhook> {
    try {
      const event = await this.webhooks.receive(rawBody, authorization);
      const createdAtSeconds = Number(event.createdAt);
      const participantMetadata = parseParticipantMetadata(
        event.participant?.metadata,
      );
      return {
        eventId: event.id.trim(),
        event: event.event,
        roomName: event.room?.name || null,
        participantIdentity: event.participant?.identity || null,
        participantSid: event.participant?.sid || null,
        participantId: participantMetadata.participantId,
        participantTicketId: participantMetadata.ticketId,
        trackSource:
          event.track?.source === TrackSource.MICROPHONE
            ? 'microphone'
            : event.track?.source === TrackSource.CAMERA
              ? 'camera'
              : event.track
                ? 'unknown'
                : null,
        occurredAt:
          Number.isSafeInteger(createdAtSeconds) && createdAtSeconds > 0
            ? new Date(createdAtSeconds * 1_000)
            : new Date(),
      };
    } catch {
      throw new LiveKitWebhookInvalidException();
    }
  }
}

function parseParticipantMetadata(value: string | undefined): {
  participantId: string | null;
  ticketId: string | null;
} {
  if (!value) {
    return { participantId: null, ticketId: null };
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { participantId: null, ticketId: null };
    }
    const metadata = parsed as Record<string, unknown>;
    return {
      participantId:
        typeof metadata.participantId === 'string'
          ? metadata.participantId
          : null,
      ticketId:
        typeof metadata.ticketId === 'string' ? metadata.ticketId : null,
    };
  } catch {
    return { participantId: null, ticketId: null };
  }
}

function toHttpUrl(value: string): string {
  if (value.startsWith('wss://')) {
    return `https://${value.slice('wss://'.length)}`;
  }
  if (value.startsWith('ws://')) {
    return `http://${value.slice('ws://'.length)}`;
  }
  if (/^https?:\/\//.test(value)) {
    return value;
  }
  throw new Error('LIVEKIT_URL must use http(s) or ws(s)');
}

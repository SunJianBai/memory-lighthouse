import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type RedisClientType } from 'redis';

import { MediaLeaseUnavailableException } from '../realtime.errors';
import type {
  MediaLeaseOwner,
  MediaLeasePort,
} from '../ports/media-lease.port';

const KEY_PREFIX = 'openbmb:media-owner:';
const VALID_BINDING_ID = /^[A-Z0-9]{26}$/;

const ACQUIRE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return 1
end
if current == ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return 1
end
return 0
`;

const RENEW_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return 1
end
return 0
`;

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const TRANSFER_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
  return 1
end
return 0
`;

@Injectable()
export class RedisMediaLeaseAdapter
  implements MediaLeasePort, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RedisMediaLeaseAdapter.name);
  private readonly client: RedisClientType;

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL')?.trim();
    if (!url && config.get<string>('NODE_ENV') === 'production') {
      throw new Error('REDIS_URL is required for production media leases');
    }
    this.client = createClient({
      url: url || 'redis://127.0.0.1:16379/0',
      socket: {
        connectTimeout: 5_000,
        reconnectStrategy: (retries) => Math.min(100 * 2 ** retries, 3_000),
      },
      disableOfflineQueue: true,
    });
    this.client.on('error', (error: unknown) => {
      this.logger.error(
        `Redis media lease connection error: ${error instanceof Error ? error.name : 'unknown'}`,
      );
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
    } catch (error) {
      this.logger.error(
        `Unable to connect media lease Redis: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      throw new MediaLeaseUnavailableException();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.close();
    }
  }

  async acquire(
    bindingId: string,
    owner: MediaLeaseOwner,
    ttlSeconds: number,
  ): Promise<boolean> {
    return this.evalBoolean(
      ACQUIRE_SCRIPT,
      this.key(bindingId),
      owner,
      ttlSeconds,
    );
  }

  async renew(
    bindingId: string,
    owner: MediaLeaseOwner,
    ttlSeconds: number,
  ): Promise<boolean> {
    return this.evalBoolean(
      RENEW_SCRIPT,
      this.key(bindingId),
      owner,
      ttlSeconds,
    );
  }

  async transfer(
    bindingId: string,
    currentOwner: MediaLeaseOwner,
    nextOwner: MediaLeaseOwner,
    ttlSeconds: number,
  ): Promise<boolean> {
    if (
      !Number.isSafeInteger(ttlSeconds) ||
      ttlSeconds < 10 ||
      ttlSeconds > 300 ||
      !isMediaLeaseOwner(currentOwner) ||
      !isMediaLeaseOwner(nextOwner)
    ) {
      throw new MediaLeaseUnavailableException();
    }
    try {
      const result = await this.client.eval(TRANSFER_SCRIPT, {
        keys: [this.key(bindingId)],
        arguments: [
          this.serialize(currentOwner),
          this.serialize(nextOwner),
          String(ttlSeconds * 1_000),
        ],
      });
      return result === 1;
    } catch {
      throw new MediaLeaseUnavailableException();
    }
  }

  async release(bindingId: string, owner: MediaLeaseOwner): Promise<void> {
    try {
      await this.client.eval(RELEASE_SCRIPT, {
        keys: [this.key(bindingId)],
        arguments: [this.serialize(owner)],
      });
    } catch {
      throw new MediaLeaseUnavailableException();
    }
  }

  async current(bindingId: string): Promise<MediaLeaseOwner | null> {
    try {
      const value = await this.client.get(this.key(bindingId));
      if (!value) {
        return null;
      }
      const parsed = JSON.parse(value) as unknown;
      return isMediaLeaseOwner(parsed) ? parsed : null;
    } catch {
      throw new MediaLeaseUnavailableException();
    }
  }

  private async evalBoolean(
    script: string,
    key: string,
    owner: MediaLeaseOwner,
    ttlSeconds: number,
  ): Promise<boolean> {
    if (
      !Number.isSafeInteger(ttlSeconds) ||
      ttlSeconds < 10 ||
      ttlSeconds > 300
    ) {
      throw new MediaLeaseUnavailableException();
    }
    try {
      const result = await this.client.eval(script, {
        keys: [key],
        arguments: [this.serialize(owner), String(ttlSeconds * 1_000)],
      });
      return result === 1;
    } catch {
      throw new MediaLeaseUnavailableException();
    }
  }

  private key(bindingId: string): string {
    if (!VALID_BINDING_ID.test(bindingId)) {
      throw new MediaLeaseUnavailableException();
    }
    return `${KEY_PREFIX}${bindingId}`;
  }

  private serialize(owner: MediaLeaseOwner): string {
    if (!isMediaLeaseOwner(owner)) {
      throw new MediaLeaseUnavailableException();
    }
    return JSON.stringify({
      leaseId: owner.leaseId,
      ownerId: owner.ownerId,
      ownerType: owner.ownerType,
    });
  }
}

function isMediaLeaseOwner(value: unknown): value is MediaLeaseOwner {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const owner = value as Record<string, unknown>;
  return (
    (owner.ownerType === 'REMOTE_ASSISTANCE' ||
      owner.ownerType === 'AI_COMPANION') &&
    typeof owner.ownerId === 'string' &&
    owner.ownerId.length > 0 &&
    owner.ownerId.length <= 128 &&
    typeof owner.leaseId === 'string' &&
    owner.leaseId.length > 0 &&
    owner.leaseId.length <= 128
  );
}

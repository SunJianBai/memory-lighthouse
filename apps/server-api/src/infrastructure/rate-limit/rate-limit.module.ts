import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { InMemoryRateLimitStoreAdapter } from './adapters/in-memory-rate-limit-store.adapter';
import { RedisRateLimitStoreAdapter } from './adapters/redis-rate-limit-store.adapter';
import { createRateLimitConfig } from './rate-limit.config';
import { RATE_LIMIT_CONFIG, RATE_LIMIT_STORE } from './rate-limit.constants';
import { RateLimitApplicationService } from './rate-limit.application.service';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimitKeyFactory } from './rate-limit-key.factory';
import { RateLimitRequestSubjectFactory } from './rate-limit-request-subject.factory';
import type { RateLimitStore } from './rate-limit-store.port';
import type { RateLimitConfig } from './rate-limit.types';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: RATE_LIMIT_CONFIG,
      inject: [ConfigService],
      useFactory: createRateLimitConfig,
    },
    {
      provide: RATE_LIMIT_STORE,
      inject: [RATE_LIMIT_CONFIG],
      useFactory: (config: RateLimitConfig): RateLimitStore => {
        if (config.backend === 'redis') {
          if (!config.redisUrl) {
            throw new Error('Rate limit Redis URL is missing');
          }
          return new RedisRateLimitStoreAdapter(
            config.redisUrl,
            config.redisConnectTimeoutMs,
          );
        }
        return new InMemoryRateLimitStoreAdapter();
      },
    },
    RateLimitKeyFactory,
    RateLimitRequestSubjectFactory,
    RateLimitApplicationService,
    RateLimitGuard,
  ],
  exports: [RateLimitApplicationService, RateLimitGuard],
})
export class RateLimitModule {}

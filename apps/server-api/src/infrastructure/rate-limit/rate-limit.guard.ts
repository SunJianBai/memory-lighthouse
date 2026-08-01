import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';

import { RATE_LIMIT_POLICY_METADATA } from './rate-limit.constants';
import { RateLimitExceededException } from './rate-limit.errors';
import { RateLimitApplicationService } from './rate-limit.application.service';
import type { RateLimitPolicy } from './rate-limit.types';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitApplicationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.getAllAndOverride<RateLimitPolicy>(
      RATE_LIMIT_POLICY_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (!policy) {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const decision = await this.limiter.consume(policy, request);
    response.setHeader('RateLimit-Remaining', decision.remaining.toString(10));
    if (!decision.allowed) {
      response.setHeader(
        'Retry-After',
        decision.retryAfterSeconds.toString(10),
      );
      throw new RateLimitExceededException(decision.retryAfterSeconds);
    }
    return true;
  }
}

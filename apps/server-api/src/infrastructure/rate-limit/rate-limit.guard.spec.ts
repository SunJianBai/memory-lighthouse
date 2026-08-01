import { describe, expect, it, jest } from '@jest/globals';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';

import { RATE_LIMIT_POLICY_METADATA } from './rate-limit.constants';
import { RateLimitExceededException } from './rate-limit.errors';
import type { RateLimitApplicationService } from './rate-limit.application.service';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimitPolicy } from './rate-limit.types';

describe('RateLimitGuard', () => {
  it('emits RATE_LIMITED and Retry-After when a policy is exhausted', async () => {
    class Target {}
    const request = {} as Request;
    const setHeader = jest.fn();
    const response = { setHeader } as unknown as Response;
    const handler = () => undefined;
    Reflect.defineMetadata(
      RATE_LIMIT_POLICY_METADATA,
      RateLimitPolicy.AUTH_LOGIN,
      handler,
    );
    const context = {
      getHandler: () => handler,
      getClass: () => Target,
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
    const limiter = {
      consume: jest.fn(() =>
        Promise.resolve({
          allowed: false,
          remaining: 0,
          retryAfterSeconds: 37,
        }),
      ),
    } as unknown as RateLimitApplicationService;
    const guard = new RateLimitGuard(new Reflector(), limiter);

    let captured: unknown;
    try {
      await guard.canActivate(context);
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(RateLimitExceededException);
    expect((captured as RateLimitExceededException).getResponse()).toEqual({
      code: 'RATE_LIMITED',
      message: '请求过于频繁，请稍后再试',
      details: { retryAfterSeconds: 37 },
    });
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '37');
    expect(setHeader).toHaveBeenCalledWith('RateLimit-Remaining', '0');
  });
});

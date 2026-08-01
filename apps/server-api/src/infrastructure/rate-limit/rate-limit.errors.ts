import { HttpException, HttpStatus } from '@nestjs/common';

export class RateLimitExceededException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super(
      {
        code: 'RATE_LIMITED',
        message: '请求过于频繁，请稍后再试',
        details: { retryAfterSeconds },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export class RateLimitUnavailableException extends HttpException {
  constructor() {
    super(
      {
        code: 'RATE_LIMIT_UNAVAILABLE',
        message: '请求保护服务暂时不可用，请稍后再试',
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

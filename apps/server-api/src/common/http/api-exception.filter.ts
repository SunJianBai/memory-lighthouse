import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

import type { RequestWithContext } from './request-context';

interface ExceptionPayload {
  code?: unknown;
  details?: unknown;
  message?: unknown;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithContext>();
    const response = http.getResponse<Response>();
    const requestId = request.requestId ?? 'unavailable';

    if (!(exception instanceof HttpException)) {
      this.logger.error(
        `Unhandled ${exception instanceof Error ? exception.name : 'error'} requestId=${requestId}`,
      );
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        code: 'INTERNAL_SERVER_ERROR',
        message: '服务暂时不可用，请稍后重试',
        requestId,
      });
      return;
    }

    const status = exception.getStatus();
    const raw = exception.getResponse();
    const payload: ExceptionPayload =
      typeof raw === 'object' && raw !== null ? raw : { message: raw };
    const validationMessages = Array.isArray(payload.message)
      ? payload.message.filter(
          (item): item is string => typeof item === 'string',
        )
      : undefined;
    const code =
      typeof payload.code === 'string'
        ? payload.code
        : validationMessages
          ? 'VALIDATION_FAILED'
          : `HTTP_${status}`;
    const message =
      validationMessages?.[0] ??
      (typeof payload.message === 'string'
        ? payload.message
        : exception.message || '请求失败');
    const details =
      payload.details !== undefined
        ? payload.details
        : validationMessages
          ? { errors: validationMessages }
          : undefined;

    response.status(status).json({
      code,
      message,
      requestId,
      ...(details === undefined ? {} : { details }),
    });
  }
}

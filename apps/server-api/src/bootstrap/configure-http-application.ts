import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import helmet from 'helmet';
import { ApiExceptionFilter } from '../common/http/api-exception.filter';
import { ApiResponseInterceptor } from '../common/http/api-response.interceptor';
import { requestIdMiddleware } from '../common/http/request-id.middleware';

export const API_GLOBAL_PREFIX = 'openBMB/api/v1';

export function configureHttpApplication(
  app: INestApplication,
  config: ConfigService,
): void {
  if ((config.get<number>('RATE_LIMIT_TRUST_PROXY_HOPS') ?? 0) === 1) {
    const express = app.getHttpAdapter().getInstance() as {
      set(name: string, value: string): void;
    };
    // Only a loopback peer (the local Caddy process) may supply forwarding
    // headers used by audit metadata. Direct public clients are never trusted.
    express.set('trust proxy', 'loopback');
  }

  const allowedOrigins = config
    .getOrThrow<string>('CORS_ORIGINS')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => new URL(origin).origin);

  app.setGlobalPrefix(API_GLOBAL_PREFIX);
  app.use(helmet());
  app.use(requestIdMiddleware);
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      whitelist: true,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ApiResponseInterceptor(app.get(Reflector)));
}

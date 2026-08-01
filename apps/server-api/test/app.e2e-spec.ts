import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureHttpApplication } from '../src/bootstrap/configure-http-application';
import { AppModule } from './../src/app.module';

describe('server-api foundation (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    configureHttpApplication(app, moduleFixture.get(ConfigService));
    await app.init();
  });

  it('serves liveness under the versioned global prefix', () => {
    return request(app.getHttpServer())
      .get('/openBMB/api/v1/health/live')
      .set('X-Request-Id', 'foundation-e2e-request')
      .expect('X-Request-Id', 'foundation-e2e-request')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          status: 'ok',
          service: 'server-api',
          timestamp: expect.any(String),
        });
      });
  });

  it('serves readiness under the versioned global prefix', () => {
    return request(app.getHttpServer())
      .get('/openBMB/api/v1/health/ready')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          status: 'ready',
          checks: { process: { status: 'up' } },
        });
      });
  });

  it('does not expose the removed default root endpoint', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(404)
      .expect(({ body, headers }) => {
        expect(body).toMatchObject({
          code: 'HTTP_404',
          requestId: headers['x-request-id'],
        });
      });
  });

  it('adds baseline security headers', () => {
    return request(app.getHttpServer())
      .get('/openBMB/api/v1/health/live')
      .expect('x-content-type-options', 'nosniff')
      .expect(200);
  });

  it('rate-limits public authentication traffic before application work', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app.getHttpServer())
        .post('/openBMB/api/v1/auth/register')
        .send({})
        .expect(400);
    }

    await request(app.getHttpServer())
      .post('/openBMB/api/v1/auth/register')
      .send({})
      .expect('Retry-After', /\d+/)
      .expect(429)
      .expect(({ body, headers }) => {
        expect(body).toMatchObject({
          code: 'RATE_LIMITED',
          requestId: headers['x-request-id'],
          details: { retryAfterSeconds: expect.any(Number) },
        });
      });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });
});

import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { AuthenticatedRequest } from '../../identity/http/current-user.decorator';
import { UserAccessGuard } from '../../identity/http/user-access.guard';
import { CareHistoryService } from '../care-history.service';
import { CareHistoryController } from './care-history.controller';

describe('CareHistoryController HTTP cache policy', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CareHistoryController],
      providers: [
        {
          provide: CareHistoryService,
          useValue: { read: jest.fn().mockResolvedValue({ items: [] }) },
        },
      ],
    })
      .overrideGuard(UserAccessGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context
            .switchToHttp()
            .getRequest<AuthenticatedRequest>().userPrincipal = {
            kind: 'USER',
            userId: 'user',
            sessionId: 'session',
            tokenId: 'token',
            status: 'ACTIVE',
          };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => app?.close());

  it.each(['occurrences', 'events'])(
    'prevents caching private %s history responses',
    async (kind) => {
      await request(app.getHttpServer())
        .get(`/households/home/care-recipients/recipient/${kind}/history`)
        .expect(200)
        .expect('Cache-Control', 'no-store');
    },
  );
});

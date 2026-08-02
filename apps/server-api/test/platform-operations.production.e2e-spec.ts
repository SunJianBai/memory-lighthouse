import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { RateLimitGuard } from '../src/infrastructure/rate-limit/rate-limit.guard';
import type { IdentitySecurityConfig } from '../src/modules/identity/config/identity-security.config';
import { IdentityApplicationService } from '../src/modules/identity/identity.application.service';
import { AdminAccessGuard } from '../src/modules/identity/http/admin-access.guard';
import { IDENTITY_SECURITY_CONFIG } from '../src/modules/identity/identity.constants';
import { AdminAuthenticationApplicationService } from '../src/modules/platform-operations/admin-authentication.application.service';
import { DevelopmentContentInspectionController } from '../src/modules/platform-operations/http/development-content-inspection.controller';
import { PlatformOperationsController } from '../src/modules/platform-operations/http/platform-operations.controller';
import { PlatformRoleGuard } from '../src/modules/platform-operations/http/platform-role.guard';
import { PlatformOperationsApplicationService } from '../src/modules/platform-operations/platform-operations.application.service';
import { PlatformOperationsModule } from '../src/modules/platform-operations/platform-operations.module';

describe('production platform HTTP surface (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const productionControllers =
      PlatformOperationsModule.register('production').controllers ?? [];
    expect(productionControllers).toContain(PlatformOperationsController);
    expect(productionControllers).not.toContain(
      DevelopmentContentInspectionController,
    );
    expect(
      PlatformOperationsModule.register('development').controllers,
    ).toContain(DevelopmentContentInspectionController);
    const operations = {
      dashboard: jest.fn(async () => ({ status: 'ok' })),
      inspectMemoryRevision: jest.fn(async () => ({ revealed: true })),
    };
    const moduleFixture = await Test.createTestingModule({
      controllers: productionControllers,
      providers: [
        {
          provide: PlatformOperationsApplicationService,
          useValue: operations,
        },
        {
          provide: IdentityApplicationService,
          useValue: {},
        },
        {
          provide: AdminAuthenticationApplicationService,
          useValue: {},
        },
        {
          provide: IDENTITY_SECURITY_CONFIG,
          useValue: {
            adminRefreshCookieName: 'test_admin_refresh',
            adminRefreshCookiePath: '/admin/auth',
            secureCookies: true,
          } satisfies Partial<IdentitySecurityConfig>,
        },
      ],
    })
      .overrideGuard(AdminAccessGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PlatformRoleGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('keeps normal admin routes mounted while content-inspection routes are absent', async () => {
    await request(app.getHttpServer())
      .get('/admin/operations/dashboard')
      .expect(200);

    await request(app.getHttpServer())
      .get('/admin/inspections/memories/01K1K000000000000000000005')
      .query({ grantId: '01K1K000000000000000000007' })
      .expect(404);
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });
});

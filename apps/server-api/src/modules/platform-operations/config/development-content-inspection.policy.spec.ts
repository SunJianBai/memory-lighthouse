import { describe, expect, it } from '@jest/globals';
import { ConfigService } from '@nestjs/config';

import { DevelopmentContentInspectionUnavailableException } from '../platform-operations.errors';
import { DevelopmentContentInspectionPolicy } from './development-content-inspection.policy';

describe('DevelopmentContentInspectionPolicy', () => {
  it('enables inspection only for an explicitly enabled development process', () => {
    const policy = new DevelopmentContentInspectionPolicy(
      new ConfigService({
        NODE_ENV: 'development',
        ENABLE_DEVELOPMENT_CONTENT_INSPECTION: 'true',
      }),
    );

    expect(policy.enabled).toBe(true);
    expect(() => policy.requireEnabled()).not.toThrow();
  });

  it('keeps the interface unavailable in test and when the flag is absent', () => {
    const testPolicy = new DevelopmentContentInspectionPolicy(
      new ConfigService({
        NODE_ENV: 'test',
        ENABLE_DEVELOPMENT_CONTENT_INSPECTION: 'true',
      }),
    );
    const defaultPolicy = new DevelopmentContentInspectionPolicy(
      new ConfigService({ NODE_ENV: 'development' }),
    );

    expect(() => testPolicy.requireEnabled()).toThrow(
      DevelopmentContentInspectionUnavailableException,
    );
    expect(() => defaultPolicy.requireEnabled()).toThrow(
      DevelopmentContentInspectionUnavailableException,
    );
  });

  it('fails startup if production is accidentally configured with the flag', () => {
    expect(
      () =>
        new DevelopmentContentInspectionPolicy(
          new ConfigService({
            NODE_ENV: 'production',
            ENABLE_DEVELOPMENT_CONTENT_INSPECTION: 'TRUE',
          }),
        ),
    ).toThrow(
      'ENABLE_DEVELOPMENT_CONTENT_INSPECTION=true is forbidden when NODE_ENV=production',
    );
  });
});

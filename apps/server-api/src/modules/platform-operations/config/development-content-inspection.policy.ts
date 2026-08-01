import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DevelopmentContentInspectionUnavailableException } from '../platform-operations.errors';

const FLAG_NAME = 'ENABLE_DEVELOPMENT_CONTENT_INSPECTION';

@Injectable()
export class DevelopmentContentInspectionPolicy {
  readonly enabled: boolean;

  constructor(config: ConfigService) {
    const environment = config.get<string>('NODE_ENV') ?? 'development';
    const flagEnabled =
      (config.get<string>(FLAG_NAME) ?? '').trim().toLowerCase() === 'true';

    if (environment === 'production' && flagEnabled) {
      throw new Error(
        `${FLAG_NAME}=true is forbidden when NODE_ENV=production`,
      );
    }

    this.enabled = environment === 'development' && flagEnabled;
  }

  requireEnabled(): void {
    if (!this.enabled) {
      throw new DevelopmentContentInspectionUnavailableException();
    }
  }
}

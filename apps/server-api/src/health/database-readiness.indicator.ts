import { Injectable } from '@nestjs/common';

import { PrismaService } from '../infrastructure/database/prisma.service';
import {
  ReadinessCheckResult,
  ReadinessIndicator,
} from './readiness-indicator';

@Injectable()
export class DatabaseReadinessIndicator implements ReadinessIndicator {
  readonly name = 'database';

  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<ReadinessCheckResult> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { name: this.name, status: 'up' };
    } catch {
      return {
        name: this.name,
        status: 'down',
        message: 'Database connectivity check failed',
      };
    }
  }
}

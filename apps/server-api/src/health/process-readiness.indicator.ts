import { Injectable } from '@nestjs/common';
import {
  ReadinessCheckResult,
  ReadinessIndicator,
} from './readiness-indicator';

@Injectable()
export class ProcessReadinessIndicator implements ReadinessIndicator {
  readonly name = 'process';

  check(): Promise<ReadinessCheckResult> {
    return Promise.resolve({ name: this.name, status: 'up' });
  }
}

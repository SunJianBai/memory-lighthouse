import { Injectable } from '@nestjs/common';

import type { ClockPort } from './device-activation.types';

@Injectable()
export class SystemClock implements ClockPort {
  now(): Date {
    return new Date();
  }
}

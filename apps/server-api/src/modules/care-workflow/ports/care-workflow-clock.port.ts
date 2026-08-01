import { Injectable } from '@nestjs/common';

export interface CareWorkflowClock {
  now(): Date;
}

@Injectable()
export class SystemCareWorkflowClock implements CareWorkflowClock {
  now(): Date {
    return new Date();
  }
}

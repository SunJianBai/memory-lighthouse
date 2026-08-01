import { Injectable } from '@nestjs/common';

export interface HouseholdClock {
  now(): Date;
}

@Injectable()
export class SystemHouseholdClock implements HouseholdClock {
  now(): Date {
    return new Date();
  }
}

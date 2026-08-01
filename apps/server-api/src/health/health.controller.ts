import {
  Controller,
  Get,
  HttpCode,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RawResponse } from '../common/http/raw-response.decorator';
import { HealthService, ReadinessSnapshot } from './health.service';

@Controller('health')
@RawResponse()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  @HttpCode(200)
  getLiveness() {
    return this.healthService.getLiveness();
  }

  @Get('ready')
  @HttpCode(200)
  async getReadiness(): Promise<ReadinessSnapshot> {
    const snapshot = await this.healthService.getReadiness();

    if (snapshot.status === 'not_ready') {
      throw new ServiceUnavailableException(snapshot);
    }

    return snapshot;
  }
}

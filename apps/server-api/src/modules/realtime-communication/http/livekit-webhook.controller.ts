import { Controller, Headers, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { RawResponse } from '../../../common/http/raw-response.decorator';
import { RealtimeCommunicationApplicationService } from '../realtime.application.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller('webhooks/livekit')
@RawResponse()
export class LiveKitWebhookController {
  constructor(
    private readonly realtime: RealtimeCommunicationApplicationService,
  ) {}

  @Post()
  receive(
    @Req() request: RawBodyRequest,
    @Headers('authorization') authorization: string | undefined,
  ) {
    if (!request.rawBody) {
      return this.realtime.handleLiveKitWebhook('', authorization);
    }
    return this.realtime.handleLiveKitWebhook(
      request.rawBody.toString('utf8'),
      authorization,
    );
  }
}

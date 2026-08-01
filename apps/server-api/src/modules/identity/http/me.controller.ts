import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  UseGuards,
} from '@nestjs/common';

import { IdentityApplicationService } from '../identity.application.service';
import type { SessionView, UserPrincipal, UserView } from '../identity.types';
import { CurrentUser } from './current-user.decorator';
import { UserAccessGuard } from './user-access.guard';

@Controller('me')
@UseGuards(UserAccessGuard)
export class MeController {
  constructor(private readonly identity: IdentityApplicationService) {}

  @Get()
  getMe(@CurrentUser() principal: UserPrincipal): Promise<UserView> {
    return this.identity.getMe(principal);
  }

  @Get('sessions')
  listSessions(
    @CurrentUser() principal: UserPrincipal,
  ): Promise<SessionView[]> {
    return this.identity.listSessions(principal);
  }

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @CurrentUser() principal: UserPrincipal,
    @Param('sessionId') sessionId: string,
  ): Promise<void> {
    await this.identity.revokeSession(principal.userId, sessionId);
  }
}

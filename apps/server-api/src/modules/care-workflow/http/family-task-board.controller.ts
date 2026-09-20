import { Controller, Get, Header, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../identity/http/current-user.decorator';
import { UserAccessGuard } from '../../identity/http/user-access.guard';
import type { UserPrincipal } from '../../identity/identity.types';
import { FamilyTaskBoardService } from '../family-task-board.service';

@Controller(
  'households/:householdId/care-recipients/:recipientId/family-task-board',
)
@UseGuards(UserAccessGuard)
export class FamilyTaskBoardController {
  constructor(private readonly board: FamilyTaskBoardService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  read(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('recipientId') recipientId: string,
  ) {
    return this.board.read(principal, householdId, recipientId);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import {
  CurrentUser,
  UserAccessGuard,
  type UserPrincipal,
} from '../../identity';
import { MemoryApplicationService } from '../memory.application.service';
import type {
  MemoryPage,
  MemoryRevisionView,
  MemoryView,
} from '../memory.types';
import {
  CreateMemoryDto,
  ListMemoriesQueryDto,
  UpdateMemoryDto,
  VersionQueryDto,
} from './memory.dto';

@Controller('households/:householdId')
@UseGuards(UserAccessGuard)
export class MemoryController {
  constructor(private readonly memories: MemoryApplicationService) {}

  @Get('care-recipients/:recipientId/memories')
  list(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('recipientId') recipientId: string,
    @Query() query: ListMemoriesQueryDto,
  ): Promise<MemoryPage> {
    return this.memories.list({
      principal,
      householdId,
      recipientId,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Post('care-recipients/:recipientId/memories')
  create(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('recipientId') recipientId: string,
    @Body() input: CreateMemoryDto,
  ): Promise<MemoryView> {
    return this.memories.create({
      principal,
      householdId,
      recipientId,
      ...input,
    });
  }

  @Get('memories/:memoryId')
  get(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('memoryId') memoryId: string,
  ): Promise<MemoryView> {
    return this.memories.get(principal.userId, householdId, memoryId);
  }

  @Patch('memories/:memoryId')
  update(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('memoryId') memoryId: string,
    @Body() input: UpdateMemoryDto,
  ): Promise<MemoryView> {
    return this.memories.update({
      principal,
      householdId,
      memoryId,
      ...input,
    });
  }

  @Delete('memories/:memoryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('memoryId') memoryId: string,
    @Query() query: VersionQueryDto,
  ): Promise<void> {
    return this.memories.remove(
      principal.userId,
      householdId,
      memoryId,
      query.version,
    );
  }

  @Get('memories/:memoryId/revisions')
  revisions(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('memoryId') memoryId: string,
  ): Promise<MemoryRevisionView[]> {
    return this.memories.listRevisions(principal.userId, householdId, memoryId);
  }
}

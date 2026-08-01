import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import {
  CurrentUser,
  UserAccessGuard,
  type UserPrincipal,
} from '../../identity';
import {
  AssetApplicationService,
  type AssetDownloadGrantView,
} from '../asset.application.service';
import type {
  AssetDeletionView,
  AssetView,
  UploadIntentView,
} from '../memory.types';
import {
  CompleteUploadDto,
  CreateUploadIntentDto,
  OptionalVersionQueryDto,
} from './memory.dto';

@Controller('households/:householdId/assets')
@UseGuards(UserAccessGuard)
export class AssetController {
  constructor(private readonly assets: AssetApplicationService) {}

  @Post('upload-intents')
  createUploadIntent(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Body() input: CreateUploadIntentDto,
  ): Promise<UploadIntentView> {
    return this.assets.beginUpload({ principal, householdId, ...input });
  }

  @Post(':assetId/complete')
  @HttpCode(HttpStatus.OK)
  complete(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('assetId') assetId: string,
    @Body() input: CompleteUploadDto,
  ): Promise<AssetView> {
    return this.assets.completeUpload({
      principal,
      householdId,
      assetId,
      version: input.version,
    });
  }

  @Get(':assetId/download-grant')
  downloadGrant(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('assetId') assetId: string,
  ): Promise<AssetDownloadGrantView> {
    return this.assets.authorizeDownload(
      principal.userId,
      householdId,
      assetId,
    );
  }

  @Delete(':assetId')
  @HttpCode(HttpStatus.ACCEPTED)
  remove(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('assetId') assetId: string,
    @Query() query: OptionalVersionQueryDto,
  ): Promise<AssetDeletionView> {
    return this.assets.requestDeletion(
      principal.userId,
      householdId,
      assetId,
      query.version,
    );
  }
}

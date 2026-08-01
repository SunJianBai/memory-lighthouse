import {
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';

export class PlatformAccessDeniedException extends ForbiddenException {
  constructor() {
    super({
      code: 'PLATFORM_ACCESS_DENIED',
      message: '当前账号没有所需的平台角色',
    });
  }
}

export class DevelopmentContentInspectionUnavailableException extends NotFoundException {
  constructor() {
    super({
      code: 'DEVELOPMENT_CONTENT_INSPECTION_UNAVAILABLE',
      message: '开发期内容检查接口不可用',
    });
  }
}

export class InspectionGrantNotFoundException extends NotFoundException {
  constructor() {
    super({
      code: 'INSPECTION_GRANT_NOT_FOUND',
      message: '内容检查授权不存在',
    });
  }
}

export class InspectionGrantStateException extends ConflictException {
  constructor(message = '内容检查授权当前状态不允许此操作') {
    super({ code: 'INSPECTION_GRANT_STATE_INVALID', message });
  }
}

export class InspectionGrantSelfApprovalException extends ConflictException {
  constructor() {
    super({
      code: 'INSPECTION_GRANT_SELF_APPROVAL_FORBIDDEN',
      message: '内容检查申请必须由另一名平台人员批准',
    });
  }
}

export class InspectionGrantScopeDeniedException extends ForbiddenException {
  constructor() {
    super({
      code: 'INSPECTION_GRANT_SCOPE_DENIED',
      message: '内容检查授权与当前资源或数据类别不匹配',
    });
  }
}

export class ContentInspectionConsentRequiredException extends ForbiddenException {
  constructor() {
    super({
      code: 'CONTENT_INSPECTION_CONSENT_REQUIRED',
      message: '当前陪伴对象未授予内容检查同意',
    });
  }
}

export class InspectionResourceNotFoundException extends NotFoundException {
  constructor() {
    super({
      code: 'INSPECTION_RESOURCE_NOT_FOUND',
      message: '待检查的记录不存在',
    });
  }
}

export class InspectionContentUnavailableException extends GoneException {
  constructor() {
    super({
      code: 'INSPECTION_CONTENT_UNAVAILABLE',
      message: '原文不存在、已清除或已超过保留期限',
    });
  }
}

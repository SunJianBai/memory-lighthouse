import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';

export class HouseholdAccessDeniedException extends ForbiddenException {
  constructor() {
    super({
      code: 'HOUSEHOLD_ACCESS_DENIED',
      message: '没有访问该家庭或执行此操作的权限',
    });
  }
}

export class RecipientAccessDeniedException extends ForbiddenException {
  constructor() {
    super({
      code: 'RECIPIENT_ACCESS_DENIED',
      message: '没有访问该陪伴对象或执行此操作的权限',
    });
  }
}

export class HouseholdNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'HOUSEHOLD_NOT_FOUND', message: '家庭不存在' });
  }
}

export class RecipientNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'RECIPIENT_NOT_FOUND', message: '陪伴对象不存在' });
  }
}

export class HouseholdMemberNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'HOUSEHOLD_MEMBER_NOT_FOUND', message: '家庭成员不存在' });
  }
}

export class VersionConflictException extends ConflictException {
  constructor() {
    super({
      code: 'VERSION_CONFLICT',
      message: '数据已被其他操作更新，请刷新后重试',
    });
  }
}

export class LastOwnerException extends ConflictException {
  constructor() {
    super({
      code: 'LAST_HOUSEHOLD_OWNER',
      message: '不能移除家庭中最后一名 OWNER',
    });
  }
}

export class InvalidInvitationException extends BadRequestException {
  constructor() {
    super({
      code: 'INVALID_HOUSEHOLD_INVITATION',
      message: '邀请无效、已过期或与当前账号不匹配',
    });
  }
}

export class InvalidHouseholdRoleException extends BadRequestException {
  constructor() {
    super({
      code: 'INVALID_HOUSEHOLD_ROLE',
      message: '家庭角色无效',
    });
  }
}

export class HouseholdRoleConfigurationException extends InternalServerErrorException {
  constructor() {
    super({
      code: 'HOUSEHOLD_ROLE_CONFIGURATION_INVALID',
      message: '家庭角色尚未正确初始化',
    });
  }
}

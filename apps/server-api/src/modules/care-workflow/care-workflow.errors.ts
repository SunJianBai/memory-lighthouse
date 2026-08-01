import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

export class RoutineNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'ROUTINE_NOT_FOUND', message: '日程不存在' });
  }
}

export class OccurrenceNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'OCCURRENCE_NOT_FOUND', message: '日程实例不存在' });
  }
}

export class DeviceOccurrenceAccessDeniedException extends ForbiddenException {
  constructor() {
    super({
      code: 'DEVICE_OCCURRENCE_ACCESS_DENIED',
      message: '当前陪伴设备无权确认此日程实例',
    });
  }
}

export class FamilyTaskNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'FAMILY_TASK_NOT_FOUND', message: '家属待办不存在' });
  }
}

export class CareWorkflowVersionConflictException extends ConflictException {
  constructor() {
    super({
      code: 'CARE_WORKFLOW_VERSION_CONFLICT',
      message: '数据已被其他操作更新，请刷新后重试',
    });
  }
}

export class InvalidOccurrenceTransitionException extends ConflictException {
  constructor(from: string, to: string) {
    super({
      code: 'INVALID_OCCURRENCE_TRANSITION',
      message: `不能将日程实例从 ${from} 迁移到 ${to}`,
    });
  }
}

export class InvalidFamilyTaskTransitionException extends ConflictException {
  constructor(from: string, action: string) {
    super({
      code: 'INVALID_FAMILY_TASK_TRANSITION',
      message: `状态为 ${from} 的待办不能执行 ${action}`,
    });
  }
}

export class FamilyTaskClaimConflictException extends ConflictException {
  constructor() {
    super({
      code: 'FAMILY_TASK_CLAIM_CONFLICT',
      message: '该待办已被其他家属认领',
    });
  }
}

export class FamilyTaskAssigneeConflictException extends ForbiddenException {
  constructor() {
    super({
      code: 'FAMILY_TASK_ASSIGNEE_CONFLICT',
      message: '该待办由其他家属认领，当前账号不能处理',
    });
  }
}

export class InvalidScheduleException extends BadRequestException {
  constructor(message = '日程触发规则无效') {
    super({ code: 'INVALID_ROUTINE_SCHEDULE', message });
  }
}

export class InvalidRoutineTypeException extends BadRequestException {
  constructor() {
    super({ code: 'INVALID_ROUTINE_TYPE', message: '日程类型无效' });
  }
}

export class InvalidMedicationReferenceException extends BadRequestException {
  constructor() {
    super({
      code: 'INVALID_MEDICATION_REFERENCE',
      message: '药物引用必须属于当前家庭和陪伴对象，且只能用于药物日程',
    });
  }
}

export class IdempotencyConflictException extends ConflictException {
  constructor() {
    super({
      code: 'IDEMPOTENCY_CONFLICT',
      message: '幂等键已用于其他操作',
    });
  }
}

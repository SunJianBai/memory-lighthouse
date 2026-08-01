import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

export class CompanionBindingUnavailableException extends ForbiddenException {
  constructor() {
    super({
      code: 'DEVICE_BINDING_UNAVAILABLE',
      message: '陪伴设备绑定已失效',
    });
  }
}

export class CompanionConsentRequiredException extends ForbiddenException {
  constructor(public readonly scope: string) {
    super({
      code: 'CONSENT_REQUIRED',
      message: '当前能力尚未获得有效授权',
      details: { scope },
    });
  }
}

export class CompanionSessionNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'COMPANION_SESSION_NOT_FOUND', message: '陪伴会话不存在' });
  }
}

export class ModelSessionNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'MODEL_SESSION_NOT_FOUND', message: '模型会话不存在' });
  }
}

export class CompanionSessionBusyException extends ConflictException {
  constructor() {
    super({
      code: 'COMPANION_SESSION_BUSY',
      message: '该设备已有进行中的陪伴会话',
    });
  }
}

export class CompanionSessionTerminalException extends ConflictException {
  constructor() {
    super({
      code: 'COMPANION_SESSION_TERMINAL',
      message: '陪伴会话已经结束',
    });
  }
}

export class ModelSessionBusyException extends ConflictException {
  constructor() {
    super({
      code: 'MODEL_SESSION_BUSY',
      message: '当前陪伴会话已有进行中的模型连接',
    });
  }
}

export class ModelPromptUnavailableException extends ServiceUnavailableException {
  constructor() {
    super({
      code: 'MODEL_PROMPT_UNAVAILABLE',
      message: '模型提示词尚未配置',
    });
  }
}

export class CareSnapshotChangedException extends ConflictException {
  constructor() {
    super({
      code: 'CARE_SNAPSHOT_CHANGED',
      message: '陪伴资料或授权已变化，请重新开始会话',
    });
  }
}

export class InvalidIdempotencyKeyException extends BadRequestException {
  constructor() {
    super({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: '该命令必须提供有效的 Idempotency-Key',
    });
  }
}

export class InvalidUtteranceSourceException extends BadRequestException {
  constructor() {
    super({
      code: 'UTTERANCE_SOURCE_INVALID',
      message: '对话原文来源与说话人不匹配',
    });
  }
}

export class UtteranceSequenceConflictException extends ConflictException {
  constructor() {
    super({
      code: 'UTTERANCE_SEQUENCE_CONFLICT',
      message: '对话事件序号或提供方事件标识冲突',
    });
  }
}

export class ModelEventInvalidException extends BadRequestException {
  constructor() {
    super({
      code: 'MODEL_EVENT_INVALID',
      message: '模型事件不在允许范围内',
    });
  }
}

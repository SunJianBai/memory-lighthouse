import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';

export class InvalidConsentScopeException extends BadRequestException {
  constructor() {
    super({
      code: 'CONSENT_SCOPE_INVALID',
      message: '授权范围无效',
    });
  }
}

export class ConsentDocumentVersionInvalidException extends BadRequestException {
  constructor() {
    super({
      code: 'CONSENT_DOCUMENT_VERSION_INVALID',
      message: '授权文档版本不存在或尚未生效',
    });
  }
}

export class IdempotencyKeyRequiredException extends BadRequestException {
  constructor() {
    super({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: '该命令必须提供有效的 Idempotency-Key',
    });
  }
}

export class IdempotencyConflictException extends ConflictException {
  constructor() {
    super({
      code: 'IDEMPOTENCY_CONFLICT',
      message: '该 Idempotency-Key 已用于不同的授权命令',
    });
  }
}

export class InvalidConsentEventCursorException extends BadRequestException {
  constructor() {
    super({
      code: 'CONSENT_EVENT_CURSOR_INVALID',
      message: '授权事件游标无效',
    });
  }
}

export class ConsentWriteConflictException extends ServiceUnavailableException {
  constructor() {
    super({
      code: 'CONSENT_WRITE_RETRY_REQUIRED',
      message: '授权状态正在更新，请稍后重试',
    });
  }
}

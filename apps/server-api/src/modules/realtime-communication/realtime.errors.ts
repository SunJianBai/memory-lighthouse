import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

export class RemoteCallNotAllowedException extends ForbiddenException {
  constructor(details?: Record<string, unknown>) {
    super({
      code: 'REMOTE_CALL_NOT_ALLOWED',
      message: '当前授权或接听策略不允许发起远程陪伴',
      ...(details ? { details } : {}),
    });
  }
}

export class RemoteConsentRequiredException extends ForbiddenException {
  constructor(scope: string) {
    super({
      code: 'CONSENT_REQUIRED',
      message: '远程陪伴媒体尚未获得有效授权',
      details: { scope },
    });
  }
}

export class RemoteDeviceOfflineException extends ConflictException {
  constructor() {
    super({
      code: 'REMOTE_DEVICE_OFFLINE',
      message: '陪伴设备当前不在线',
    });
  }
}

export class RemoteDeviceBusyException extends ConflictException {
  constructor() {
    super({ code: 'REMOTE_DEVICE_BUSY', message: '陪伴设备正在使用媒体能力' });
  }
}

export class RemoteSessionNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'REMOTE_SESSION_NOT_FOUND', message: '远程陪伴会话不存在' });
  }
}

export class RemoteSessionTerminalException extends ConflictException {
  constructor() {
    super({
      code: 'REMOTE_SESSION_TERMINAL',
      message: '远程陪伴会话已经结束',
    });
  }
}

export class RemoteSessionStateException extends ConflictException {
  constructor(expected: readonly string[]) {
    super({
      code: 'REMOTE_SESSION_STATE_CONFLICT',
      message: '远程陪伴会话当前状态不能执行此操作',
      details: { expected },
    });
  }
}

export class RemoteMediaInvalidException extends BadRequestException {
  constructor() {
    super({
      code: 'REMOTE_MEDIA_INVALID',
      message: '远程陪伴媒体范围无效',
    });
  }
}

export class RemoteIdempotencyKeyException extends BadRequestException {
  constructor() {
    super({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: '发起来电必须提供有效的 Idempotency-Key',
    });
  }
}

export class RemoteIdempotencyConflictException extends ConflictException {
  constructor() {
    super({
      code: 'IDEMPOTENCY_CONFLICT',
      message: '同一 Idempotency-Key 已用于不同的远程陪伴请求',
    });
  }
}

export class MediaLeaseUnavailableException extends ServiceUnavailableException {
  constructor() {
    super({ code: 'MEDIA_LEASE_UNAVAILABLE', message: '媒体协调服务暂不可用' });
  }
}

export class LiveKitUnavailableException extends ServiceUnavailableException {
  constructor() {
    super({
      code: 'MEDIA_PROVIDER_UNAVAILABLE',
      message: '音视频服务暂不可用',
    });
  }
}

export class LiveKitWebhookInvalidException extends ForbiddenException {
  constructor() {
    super({ code: 'LIVEKIT_WEBHOOK_INVALID', message: '媒体回调签名无效' });
  }
}

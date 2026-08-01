import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

abstract class CodedBadRequest extends BadRequestException {
  protected constructor(code: string, message: string) {
    super({ code, message });
  }
}

export class InvalidInstallationKeyException extends CodedBadRequest {
  constructor() {
    super('DEVICE_INSTALLATION_KEY_INVALID', '设备安装公钥无效');
  }
}

export class UnsupportedDeviceKeyProtectionException extends CodedBadRequest {
  constructor() {
    super(
      'DEVICE_KEY_PROTECTION_UNSUPPORTED',
      '设备客户端不支持当前要求的不可导出密钥保护协议，请升级客户端后重试',
    );
  }
}

export class UnsupportedInstallationKeyAlgorithmException extends CodedBadRequest {
  constructor() {
    super(
      'DEVICE_INSTALLATION_KEY_ALGORITHM_UNSUPPORTED',
      '设备安装密钥算法不受支持，请升级客户端后重试',
    );
  }
}

export class ActivationNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'ACTIVATION_NOT_FOUND', message: '激活请求不存在' });
  }
}

export class ActivationExpiredException extends GoneException {
  constructor() {
    super({
      code: 'ACTIVATION_EXPIRED',
      message: '激活请求已过期，请重新生成',
    });
  }
}

export class ActivationAlreadyConsumedException extends ConflictException {
  constructor() {
    super({
      code: 'ACTIVATION_ALREADY_CONSUMED',
      message: '激活请求已经结束，不能重复使用',
    });
  }
}

export class ActivationAttemptsExceededException extends GoneException {
  constructor() {
    super({
      code: 'ACTIVATION_ATTEMPTS_EXCEEDED',
      message: '激活尝试次数过多，请重新生成激活码',
    });
  }
}

export class ActivationProofInvalidException extends UnauthorizedException {
  constructor() {
    super({ code: 'ACTIVATION_PROOF_INVALID', message: '设备激活证明无效' });
  }
}

export class ActivationStateConflictException extends ConflictException {
  constructor(expected: string) {
    super({
      code: 'ACTIVATION_STATE_CONFLICT',
      message: `激活请求当前不能执行此操作，需要处于 ${expected} 状态`,
    });
  }
}

export class ActivationApprovalRevokedException extends ForbiddenException {
  constructor() {
    super({
      code: 'ACTIVATION_APPROVAL_REVOKED',
      message: '批准人的权限、家庭或陪伴对象状态已变化，请重新发起激活',
    });
  }
}

export class ActivationApprovalSnapshotChangedException extends ConflictException {
  constructor() {
    super({
      code: 'ACTIVATION_APPROVAL_SNAPSHOT_CHANGED',
      message: '待批准设备信息已经变化，请刷新确认页后重试',
    });
  }
}

export class ActivationIdempotencyKeyException extends CodedBadRequest {
  constructor() {
    super(
      'ACTIVATION_IDEMPOTENCY_KEY_INVALID',
      '批准设备必须提供有效的 Idempotency-Key',
    );
  }
}

export class ActivationIdempotencyConflictException extends ConflictException {
  constructor() {
    super({
      code: 'ACTIVATION_IDEMPOTENCY_CONFLICT',
      message: '同一 Idempotency-Key 已用于其他设备激活操作',
    });
  }
}

export class RecipientActivationDeniedException extends ForbiddenException {
  constructor() {
    super({
      code: 'RECIPIENT_ACCESS_DENIED',
      message: '无权激活此陪伴对象的设备',
    });
  }
}

export class CompanionBindingConflictException extends ConflictException {
  constructor() {
    super({
      code: 'DEVICE_ALREADY_BOUND',
      message: '此设备已经绑定陪伴对象，不能重复绑定',
    });
  }
}

export class CompanionBindingNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'DEVICE_BINDING_NOT_FOUND', message: '陪伴设备绑定不存在' });
  }
}

export class VersionConflictException extends ConflictException {
  constructor() {
    super({ code: 'VERSION_CONFLICT', message: '数据已经变化，请刷新后重试' });
  }
}

export class InvalidDeviceCredentialException extends UnauthorizedException {
  constructor() {
    super({ code: 'DEVICE_CREDENTIAL_INVALID', message: '设备凭据无效' });
  }
}

export class DeviceCredentialReplayedException extends UnauthorizedException {
  constructor() {
    super({
      code: 'DEVICE_CREDENTIAL_REPLAYED',
      message: '检测到设备凭据重放，当前凭据族已撤销',
    });
  }
}

export class DeviceRevokedException extends UnauthorizedException {
  constructor() {
    super({ code: 'DEVICE_REVOKED', message: '设备绑定已停用或撤销' });
  }
}

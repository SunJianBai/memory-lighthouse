import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';

export class MemoryNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'MEMORY_NOT_FOUND', message: '记忆不存在' });
  }
}

export class AssetNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'ASSET_NOT_FOUND', message: '文件不存在' });
  }
}

export class MedicationNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'MEDICATION_NOT_FOUND', message: '用药记录不存在' });
  }
}

export class TrustedContactNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'TRUSTED_CONTACT_NOT_FOUND', message: '可信联系人不存在' });
  }
}

export class MemoryVersionConflictException extends ConflictException {
  constructor() {
    super({
      code: 'VERSION_CONFLICT',
      message: '数据已被其他操作更新，请刷新后重试',
    });
  }
}

export class InvalidMemoryCursorException extends BadRequestException {
  constructor() {
    super({ code: 'INVALID_MEMORY_CURSOR', message: '分页游标无效' });
  }
}

export class DataEncryptionConfigurationException extends InternalServerErrorException {
  constructor() {
    super({
      code: 'DATA_ENCRYPTION_CONFIGURATION_INVALID',
      message: '数据加密配置无效',
    });
  }
}

export class DataDecryptionException extends InternalServerErrorException {
  constructor() {
    super({
      code: 'DATA_DECRYPTION_FAILED',
      message: '敏感数据解密失败',
    });
  }
}

export class ObjectStorageConfigurationException extends InternalServerErrorException {
  constructor() {
    super({
      code: 'OBJECT_STORAGE_CONFIGURATION_INVALID',
      message: '私有对象存储配置无效',
    });
  }
}

export class AssetUploadStateException extends ConflictException {
  constructor() {
    super({
      code: 'ASSET_UPLOAD_STATE_INVALID',
      message: '文件当前状态不允许完成上传',
    });
  }
}

export class AssetUploadIncompleteException extends ConflictException {
  constructor() {
    super({
      code: 'ASSET_UPLOAD_INCOMPLETE',
      message: '对象尚未上传完成',
    });
  }
}

export class AssetUploadMismatchException extends BadRequestException {
  constructor(details: Record<string, unknown>) {
    super({
      code: 'ASSET_UPLOAD_MISMATCH',
      message: '上传对象与声明的文件信息不一致',
      details,
    });
  }
}

export class AssetScanPendingException extends ConflictException {
  constructor() {
    super({
      code: 'ASSET_SCAN_PENDING',
      message: '文件安全扫描尚未完成',
    });
  }
}

export class AssetUnavailableException extends ConflictException {
  constructor() {
    super({
      code: 'ASSET_UNAVAILABLE',
      message: '文件当前不可用',
    });
  }
}

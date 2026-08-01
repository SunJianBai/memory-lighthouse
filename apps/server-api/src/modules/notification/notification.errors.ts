import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

export class InvalidAdminAccessCursorException extends BadRequestException {
  constructor() {
    super({
      code: 'ADMIN_ACCESS_CURSOR_INVALID',
      message: '管理员访问记录游标无效',
    });
  }
}

export class AdminAccessReceiptNotFoundException extends NotFoundException {
  constructor() {
    super({
      code: 'ADMIN_ACCESS_RECEIPT_NOT_FOUND',
      message: '该历史记录没有当前用户的可读通知',
    });
  }
}

export class InspectionNotificationRecipientUnavailableException extends ServiceUnavailableException {
  constructor() {
    super({
      code: 'INSPECTION_NOTIFICATION_RECIPIENT_UNAVAILABLE',
      message: '家庭隐私通知暂时无法送达',
    });
  }
}

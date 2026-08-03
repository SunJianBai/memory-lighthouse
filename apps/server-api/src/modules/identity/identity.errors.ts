import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';

export class InvalidCredentialsException extends UnauthorizedException {
  constructor() {
    super({
      code: 'INVALID_CREDENTIALS',
      message: '用户名、邮箱或密码错误',
    });
  }
}

export class InvalidAccessTokenException extends UnauthorizedException {
  constructor() {
    super({
      code: 'INVALID_ACCESS_TOKEN',
      message: '登录状态已失效，请重新登录',
    });
  }
}

export class InvalidRefreshTokenException extends UnauthorizedException {
  constructor() {
    super({
      code: 'INVALID_REFRESH_TOKEN',
      message: '刷新凭据已失效，请重新登录',
    });
  }
}

export class InvalidOneTimeTokenException extends BadRequestException {
  constructor() {
    super({
      code: 'INVALID_ONE_TIME_TOKEN',
      message: '验证码或链接无效、已过期或尝试次数过多，请重新申请',
    });
  }
}

export class RegistrationUnavailableException extends ConflictException {
  constructor() {
    super({
      code: 'REGISTRATION_UNAVAILABLE',
      message: '无法使用当前信息完成注册',
    });
  }
}

export class EmailVerificationRequiredException extends ForbiddenException {
  constructor() {
    super({
      code: 'EMAIL_VERIFICATION_REQUIRED',
      message: '请先验证邮箱后再执行此操作',
    });
  }
}

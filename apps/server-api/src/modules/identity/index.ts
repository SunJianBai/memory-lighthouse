export { IdentityModule } from './identity.module';
export { IdentityApplicationService } from './identity.application.service';
export { VerifiedEmailPolicy } from './domain/verified-email.policy';
export { CurrentUser } from './http/current-user.decorator';
export { UserAccessGuard } from './http/user-access.guard';
export { AdminAccessGuard } from './http/admin-access.guard';
export type { UserPrincipal } from './identity.types';
export {
  IDENTITY_SECURITY_CONFIG,
  NOTIFICATION_PORT,
  PASSWORD_HASHER_PORT,
} from './identity.constants';
export type { NotificationPort } from './ports/notification.port';

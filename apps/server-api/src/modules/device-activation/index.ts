export { DeviceActivationModule } from './device-activation.module';
export { DeviceActivationApplicationService } from './device-activation.application.service';
export { DeviceAuthGuard } from './http/device-auth.guard';
export { CurrentDevice } from './http/current-device.decorator';
export { DeviceAccessTokenService } from './device-access-token.service';
export type {
  DeviceCapability,
  DevicePrincipal,
} from './device-activation.types';
export {
  buildClaimProofMessage,
  buildExchangeProofMessage,
  buildRefreshProofMessage,
} from './device-activation.crypto';

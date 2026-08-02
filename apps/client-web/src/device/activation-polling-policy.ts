import { ApiError, NetworkError } from "../api/api-client";
import { DeviceCredentialPersistenceError } from "./device-storage-error";

export const ACTIVATION_TERMINAL_STATUSES = new Set([
  "CANCELLED",
  "EXPIRED",
  "ATTEMPTS_EXCEEDED",
]);

export const activationTerminalMessage = (status: string): string => {
  if (status === "CANCELLED")
    return "本次设备激活已取消，请重新扫描二维码或输入新的动态激活码";
  if (status === "EXPIRED")
    return "本次设备激活已过期，请由家属生成新的激活凭据";
  if (status === "ATTEMPTS_EXCEEDED")
    return "本次设备激活尝试次数已用尽，请由家属生成新的激活凭据";
  return "本次设备激活无法继续，请重新发起激活";
};

export const isActivationRecoveryConflict = (error: unknown): boolean =>
  error instanceof ApiError &&
  ["ACTIVATION_ALREADY_CONSUMED", "ACTIVATION_STATE_CONFLICT"].includes(
    error.code,
  );

export const shouldPreserveActivationChallenge = (error: unknown): boolean =>
  error instanceof DeviceCredentialPersistenceError;

export const activationPollingRetryDelayMillis = (error: unknown): number =>
  error instanceof ApiError && error.status === 429 ? 10_000 : 2_000;

export class ActivationPollingRetryBudget {
  private recoveryConflicts = 0;

  reset(): void {
    this.recoveryConflicts = 0;
  }

  shouldRetry(error: unknown): boolean {
    if (error instanceof NetworkError) return true;
    if (!(error instanceof ApiError)) return false;
    if (error.status >= 500 || error.status === 408 || error.status === 429)
      return true;
    if (!isActivationRecoveryConflict(error)) return false;
    this.recoveryConflicts += 1;
    return this.recoveryConflicts < 5;
  }
}

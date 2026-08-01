export type ActivationProofType = 'QR_SECRET' | 'DYNAMIC_CODE';

export interface DevicePrincipal {
  kind: 'DEVICE';
  tokenId: string;
  credentialId: string;
  credentialFamilyId: string;
  deviceId: string;
  bindingId: string;
  householdId: string;
  recipientId: string;
  bindingVersion: number;
  capabilities: readonly DeviceCapability[];
}

export type DeviceCapability = 'COMPANION' | 'REMOTE_ASSISTANCE';

export interface DeviceInstallationView {
  installationId: string;
  keyFingerprint: string;
  serverNonce: string;
}

export interface ActivationPresentation {
  challengeId: string;
  publicId: string;
  dynamicCode: string;
  qrPayload: string;
  expiresAt: string;
}

export interface PublicActivationStatus {
  status: string;
  expiresAt: string;
  claimedAt: string | null;
  approvedAt: string | null;
}

export interface DeviceCredentialPresentation {
  /** Long-lived rotating refresh credential. Never use it as a Bearer token. */
  credential: string;
  credentialId: string;
  credentialFamilyId: string;
  bindingId: string;
  householdId: string;
  recipientId: string;
  expiresAt: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  accessTokenExpiresInSeconds: number;
}

export interface CompanionBindingView {
  id: string;
  deviceId: string;
  householdId: string;
  recipientId: string;
  displayName: string;
  status: string;
  activatedAt: string;
  revokedAt: string | null;
  bindingVersion: number;
  version: number;
}

export interface ClockPort {
  now(): Date;
}

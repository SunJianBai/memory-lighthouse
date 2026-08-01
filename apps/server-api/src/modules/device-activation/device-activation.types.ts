export type ActivationProofType = 'QR_SECRET' | 'DYNAMIC_CODE';

export type InstallationKeyAlgorithm = 'ED25519' | 'ECDSA_P256_SHA256';

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

export type ClaimNetworkSource =
  'LOCAL_NETWORK' | 'LOOPBACK' | 'PUBLIC_IPV4' | 'PUBLIC_IPV6' | 'UNKNOWN';

export interface ActivationApprovalDetails {
  challengeId: string;
  status: 'CLAIMED';
  expiresAt: string;
  claimedAt: string;
  claimNetworkSource: ClaimNetworkSource;
  claimSnapshotToken: string;
  device: {
    platform: string;
    installationKeyAlgorithm: InstallationKeyAlgorithm;
    manufacturer: string | null;
    model: string | null;
    osVersion: string | null;
    appVersion: string | null;
    keyFingerprintSuffix: string;
  };
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

export type UserClientType = 'WEB' | 'ANDROID';

export interface RequestMetadata {
  ipAddress?: string;
  userAgent?: string;
}

export interface UserPrincipal {
  kind: 'USER';
  userId: string;
  sessionId: string;
  tokenId: string;
  status: string;
}

export interface AccessTokenResult {
  accessToken: string;
  accessTokenExpiresAt: string;
  expiresInSeconds: number;
}

export interface SessionTokenResult extends AccessTokenResult {
  clientType: UserClientType;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  sessionId: string;
}

export interface PublicSessionTokenResult extends AccessTokenResult {
  clientType: UserClientType;
  refreshToken?: string;
  refreshTokenExpiresAt: string;
  sessionId: string;
}

export interface IdentityView {
  type: string;
  value: string;
  verifiedAt: string | null;
  isPrimary: boolean;
}

export interface UserView {
  id: string;
  displayName: string;
  status: string;
  locale: string;
  timezone: string;
  identities: IdentityView[];
  createdAt: string;
}

export interface SessionView {
  id: string;
  clientType: string;
  current: boolean;
  issuedAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  userAgent: string | null;
}

export interface AcceptedResult {
  accepted: true;
}

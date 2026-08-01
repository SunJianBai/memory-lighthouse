export interface PasswordHasherPort {
  hash(password: string): Promise<Uint8Array<ArrayBuffer>>;

  /**
   * Implementations must perform comparable expensive work even when hash is
   * null. This prevents the missing-account path from becoming a cheap timing
   * oracle.
   */
  verify(
    password: string,
    hash: Uint8Array<ArrayBufferLike> | null,
  ): Promise<boolean>;
}

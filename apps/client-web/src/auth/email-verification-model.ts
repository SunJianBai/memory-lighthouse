export type EmailVerificationConfirmBody = {
  email: string;
  code: string;
};

export type EmailVerificationRequestBody = {
  email: string;
  currentPassword?: string;
};

export type EmailIdentityLike = {
  type: string;
  value: string;
};

export const emailAddressesMatch = (left: string, right: string): boolean => {
  const normalizedLeft = left.trim().toLowerCase();
  return (
    normalizedLeft.length > 0 &&
    normalizedLeft === right.trim().toLowerCase()
  );
};

export const normalizeEmailVerificationCode = (value: string): string =>
  value.replace(/\D/g, "").slice(0, 6);

export const isCompleteEmailVerificationCode = (value: string): boolean =>
  /^\d{6}$/.test(value);

export const emailVerificationConfirmBody = (
  email: string,
  code: string,
): EmailVerificationConfirmBody => ({
  email: email.trim(),
  code: normalizeEmailVerificationCode(code),
});

export const emailVerificationRequestBody = (
  email: string,
  currentPassword?: string,
): EmailVerificationRequestBody => ({
  email: email.trim(),
  ...(currentPassword === undefined ? {} : { currentPassword }),
});

export const ownsEmailIdentity = (
  identities: readonly EmailIdentityLike[],
  email: string,
): boolean => {
  return (
    identities.some(
      (identity) =>
        identity.type === "EMAIL" &&
        emailAddressesMatch(identity.value, email),
    )
  );
};

export const tryRefreshUserAfterAcceptedEmailVerification = async (
  refreshUser: () => Promise<unknown>,
): Promise<boolean> => {
  try {
    await refreshUser();
    return true;
  } catch {
    return false;
  }
};

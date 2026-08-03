export type EmailVerificationConfirmBody = {
  email: string;
  code: string;
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

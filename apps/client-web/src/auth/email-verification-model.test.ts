import { describe, expect, it } from "vitest";
import {
  emailVerificationConfirmBody,
  isCompleteEmailVerificationCode,
  normalizeEmailVerificationCode,
} from "./email-verification-model";

describe("email verification code contract", () => {
  it("accepts pasted codes as one six-digit value", () => {
    expect(normalizeEmailVerificationCode(" 12 34-56 ")).toBe("123456");
    expect(isCompleteEmailVerificationCode("123456")).toBe(true);
    expect(isCompleteEmailVerificationCode("12345")).toBe(false);
  });

  it("submits a trimmed email and the normalized six-digit code", () => {
    expect(
      emailVerificationConfirmBody(" family@example.com ", "12 34-56"),
    ).toEqual({
      email: "family@example.com",
      code: "123456",
    });
  });
});

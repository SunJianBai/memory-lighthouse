import { describe, expect, it } from "vitest";
import {
  emailAddressesMatch,
  emailVerificationConfirmBody,
  emailVerificationRequestBody,
  isCompleteEmailVerificationCode,
  normalizeEmailVerificationCode,
  ownsEmailIdentity,
  tryRefreshUserAfterAcceptedEmailVerification,
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

  it("only sends the current password when attaching a new email identity", () => {
    expect(emailVerificationRequestBody(" family@example.com ")).toEqual({
      email: "family@example.com",
    });
    expect(
      emailVerificationRequestBody(
        " new-address@example.com ",
        " password with spaces ",
      ),
    ).toEqual({
      email: "new-address@example.com",
      currentPassword: " password with spaces ",
    });
  });

  it("requires step-up for a different email, not for an address already owned", () => {
    const identities = [
      { type: "USERNAME", value: "family-user" },
      { type: "EMAIL", value: "Existing@Example.com" },
    ];

    expect(ownsEmailIdentity(identities, " existing@example.COM ")).toBe(true);
    expect(ownsEmailIdentity(identities, "new@example.com")).toBe(false);
    expect(ownsEmailIdentity(identities, "")).toBe(false);
    expect(emailAddressesMatch(" New@Example.com ", "new@example.COM")).toBe(
      true,
    );
    expect(emailAddressesMatch("", "")).toBe(false);
  });

  it("does not turn an accepted email request into a failure when user refresh fails", async () => {
    await expect(
      tryRefreshUserAfterAcceptedEmailVerification(async () => {
        throw new Error("temporary /me failure");
      }),
    ).resolves.toBe(false);
    await expect(
      tryRefreshUserAfterAcceptedEmailVerification(async () => undefined),
    ).resolves.toBe(true);
  });
});

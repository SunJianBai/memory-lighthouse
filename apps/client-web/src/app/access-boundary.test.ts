import { describe, expect, it } from "vitest";
import authContextSource from "../auth/auth-context.tsx?raw";
import companionPageSource from "../pages/product/CompanionPage.tsx?raw";
import { requiresFamilySession } from "./access-boundary";

describe("family session route boundary", () => {
  it("keeps the activated companion shell independent from family login", () => {
    expect(requiresFamilySession("companion")).toBe(false);
  });

  it("protects family workspaces and invitation acceptance", () => {
    expect(requiresFamilySession("workspace-overview")).toBe(true);
    expect(requiresFamilySession("workspace-devices")).toBe(true);
    expect(requiresFamilySession("accept-invitation")).toBe(true);
  });

  it("does not put public or companion routes behind family authentication", () => {
    expect(requiresFamilySession("home")).toBe(false);
    expect(requiresFamilySession("companion")).toBe(false);
  });

  it("revokes even a stale refresh-cookie session before persisting device credentials", () => {
    expect(authContextSource).toContain("/auth/device-mode-lock");
    expect(authContextSource).toMatch(
      /\/auth\/device-mode-lock[\s\S]*authenticated:\s*false[\s\S]*markAnonymous\(\)/,
    );
    expect(companionPageSource).toMatch(
      /if \(!deviceSession\.hasCredential\(\)\) return;[\s\S]*await lockToDeviceMode\(\);[\s\S]*await loadContext\(\)/,
    );
    const transition = companionPageSource.slice(
      companionPageSource.indexOf('setNotice("家属已确认'),
      companionPageSource.indexOf('setNotice("设备激活完成'),
    );
    const lockIndex = transition.indexOf("await lockToDeviceMode()");
    const exchangeIndex = transition.indexOf("await deviceSession.exchange");
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(exchangeIndex).toBeGreaterThanOrEqual(0);
    expect(lockIndex).toBeLessThan(exchangeIndex);
  });

  it("keeps an approved activation retryable across transient failures and reloads", () => {
    expect(companionPageSource).toContain(
      "memory-lighthouse.pending-activation-challenge.v1",
    );
    expect(companionPageSource).toContain("activationExchange.current.run");
    expect(companionPageSource).toMatch(
      /if \(!deviceSession\.hasCredential\(\)\) \{[\s\S]*await deviceSession\.exchange/,
    );
    expect(companionPageSource).toContain('["APPROVED", "CONSUMED"]');
    expect(companionPageSource).toContain("status.recoveryToken");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeSensitiveFragment } from "./sensitive-fragment";

const installWindow = (pathname: string, hash: string) => {
  const replaceState = vi.fn();
  vi.stubGlobal("window", {
    location: { pathname, search: "", hash },
    history: { state: null, replaceState },
  });
  return replaceState;
};

describe("consumeSensitiveFragment", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["/openBMB/auth/verify-email", "verify-email"],
    ["/openBMB/auth/reset-password", "reset-password"],
    ["/openBMB/invitations/accept", "accept-invitation"],
  ] as const)("matches the server mail route %s", (pathname, kind) => {
    const replaceState = installWindow(pathname, "#token=one-time-secret");

    expect(consumeSensitiveFragment()).toEqual({
      kind,
      token: "one-time-secret",
    });
    expect(replaceState).toHaveBeenCalledWith(
      null,
      "",
      pathname,
    );
  });

  it("clears a token fragment even when the route is unknown", () => {
    const replaceState = installWindow("/openBMB/unrelated", "#token=secret");

    expect(consumeSensitiveFragment()).toBeNull();
    expect(replaceState).toHaveBeenCalledOnce();
  });
});

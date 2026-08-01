import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, NetworkError } from "./api-client";

const envelope = <T>(data: T) =>
  new Response(JSON.stringify({ code: "OK", message: "", data, requestId: "req-1" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

describe("ApiClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("unwraps the response envelope and sends an in-memory access token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(envelope({ id: "household-1" }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient("https://example.test/openBMB/api/v1");
    client.setAccessToken("access-only-in-memory");

    await expect(client.request<{ id: string }>("/households")).resolves.toEqual({ id: "household-1" });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(request.headers).get("Authorization")).toBe("Bearer access-only-in-memory");
    expect(request.credentials).toBe("include");
  });

  it("refreshes once and retries a user request after a 401", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "AUTH_SESSION_REVOKED", message: "expired" }), { status: 401 }))
      .mockResolvedValueOnce(envelope({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient("https://example.test/openBMB/api/v1");
    const refresh = vi.fn(async () => {
      client.setAccessToken("rotated-token");
      return true;
    });
    client.setRefreshHandler(refresh);

    await expect(client.request<{ ok: boolean }>("/me")).resolves.toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retry = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(retry.headers).get("Authorization")).toBe("Bearer rotated-token");
  });

  it("reports a clear network failure without manufacturing data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    const client = new ApiClient("https://example.test/openBMB/api/v1");
    await expect(client.request("/households")).rejects.toBeInstanceOf(NetworkError);
  });
});

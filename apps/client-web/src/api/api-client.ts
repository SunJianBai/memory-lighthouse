export type ApiErrorBody = {
  code?: string;
  message?: string;
  requestId?: string;
  details?: unknown;
};

type ApiEnvelope<T> = {
  code: "OK";
  message: "";
  data: T;
  requestId: string;
};

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId?: string;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message || "请求失败，请稍后重试");
    this.name = "ApiError";
    this.status = status;
    this.code = body.code || `HTTP_${status}`;
    this.requestId = body.requestId;
    this.details = body.details;
  }
}

export class NetworkError extends Error {
  constructor(message = "无法连接服务器，请检查网络后重试") {
    super(message);
    this.name = "NetworkError";
  }
}

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  authenticated?: boolean;
  retryAuthentication?: boolean;
  timeoutMs?: number;
};

type RefreshHandler = () => Promise<boolean>;

const defaultBaseUrl =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ||
  "/openBMB/api/v1";

export class ApiClient {
  private accessToken: string | null = null;
  private refreshHandler: RefreshHandler | null = null;
  private refreshInFlight: Promise<boolean> | null = null;

  constructor(private readonly baseUrl = defaultBaseUrl) {}

  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  setRefreshHandler(handler: RefreshHandler | null): void {
    this.refreshHandler = handler;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const authenticated = options.authenticated !== false;
    const response = await this.fetch(path, options, authenticated);

    if (
      response.status === 401 &&
      authenticated &&
      options.retryAuthentication !== false &&
      this.refreshHandler
    ) {
      const refreshed = await this.refreshOnce();
      if (refreshed) {
        const retryResponse = await this.fetch(
          path,
          { ...options, retryAuthentication: false },
          true,
        );
        return this.decode<T>(retryResponse);
      }
    }

    return this.decode<T>(response);
  }

  private async fetch(
    path: string,
    options: RequestOptions,
    authenticated: boolean,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? 15_000,
    );
    const headers = new Headers(options.headers);
    const bodyIsFormData = options.body instanceof FormData;
    if (options.body !== undefined && !bodyIsFormData) {
      headers.set("Content-Type", "application/json");
    }
    headers.set("Accept", "application/json");
    if (authenticated && this.accessToken) {
      headers.set("Authorization", `Bearer ${this.accessToken}`);
    }

    const { body, authenticated: _authenticated, retryAuthentication: _retry, timeoutMs: _timeout, ...requestInit } = options;
    const requestBody: BodyInit | null | undefined =
      body === undefined
        ? undefined
        : bodyIsFormData
          ? (body as FormData)
          : JSON.stringify(body);

    try {
      return await fetch(`${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`, {
        ...requestInit,
        body: requestBody,
        credentials: "include",
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new NetworkError("服务器响应超时，请稍后重试");
      }
      throw new NetworkError();
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }

  private async decode<T>(response: Response): Promise<T> {
    const text = await response.text();
    let body: ApiEnvelope<T> | ApiErrorBody | undefined;
    if (text) {
      try {
        body = JSON.parse(text) as ApiEnvelope<T> | ApiErrorBody;
      } catch {
        if (!response.ok) {
          throw new ApiError(response.status, {
            message: "服务器返回了无法识别的响应",
          });
        }
      }
    }

    if (!response.ok) {
      throw new ApiError(response.status, (body as ApiErrorBody) ?? {});
    }
    if (body && "code" in body && body.code === "OK" && "data" in body) {
      return body.data;
    }
    return undefined as T;
  }

  private refreshOnce(): Promise<boolean> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.refreshHandler!().finally(() => {
        this.refreshInFlight = null;
      });
    }
    return this.refreshInFlight;
  }
}

export const apiClient = new ApiClient();

export const readableError = (error: unknown): string => {
  if (error instanceof ApiError || error instanceof NetworkError) {
    const suffix = error instanceof ApiError && error.requestId
      ? `（请求编号：${error.requestId}）`
      : "";
    return `${error.message}${suffix}`;
  }
  return error instanceof Error ? error.message : "操作失败，请重试";
};

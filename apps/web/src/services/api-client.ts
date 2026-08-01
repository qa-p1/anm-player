const API_BASE_PATH = "/api/v1";
const DEFAULT_TIMEOUT_MS = 30_000;

export interface ApiClientOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isRequestCancelled(error: unknown): boolean {
  return (
    (error instanceof ApiError && error.code === "request_aborted")
    || (error instanceof Error && error.name === "AbortError")
  );
}

export function apiGet<TResponse>(path: string, options?: ApiClientOptions) {
  return apiRequest<TResponse>("GET", path, undefined, options);
}

export function apiPost<TResponse, TBody>(path: string, body?: TBody, options?: ApiClientOptions) {
  return apiRequest<TResponse, TBody>("POST", path, body, options);
}

export function apiPut<TResponse, TBody>(path: string, body?: TBody, options?: ApiClientOptions) {
  return apiRequest<TResponse, TBody>("PUT", path, body, options);
}

export function apiPatch<TResponse, TBody>(path: string, body?: TBody, options?: ApiClientOptions) {
  return apiRequest<TResponse, TBody>("PATCH", path, body, options);
}

export function apiDelete<TResponse>(path: string, options?: ApiClientOptions) {
  return apiRequest<TResponse>("DELETE", path, undefined, options);
}

async function apiRequest<TResponse, TBody = never>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: TBody,
  options: ApiClientOptions = {},
): Promise<TResponse> {
  if (!path.startsWith("/")) throw new ApiError("API paths must start with /", null, "invalid_path");

  const controller = new AbortController();
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", abort, { once: true });

  try {
    const hasBody = body !== undefined;
    const response = await fetch(`${API_BASE_PATH}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
      },
      body: hasBody ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) throw await responseError(response);
    if (response.status === 204) return undefined as TResponse;

    const text = await response.text();
    if (!text) return undefined as TResponse;
    try {
      return JSON.parse(text) as TResponse;
    } catch {
      throw new ApiError("The server returned an invalid response.", response.status, "invalid_response");
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (timedOut) throw new ApiError("The request timed out. Try again.", null, "request_timeout");
    if (controller.signal.aborted) throw new ApiError("The request was cancelled.", null, "request_aborted");
    throw new ApiError("Could not reach ANM Player. Check that the server is running.", null, "network_error");
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}

export function getDownloadEventsUrl(jobId: number) {
  const url = new URL(`${API_BASE_PATH}/downloads/${jobId}/events`, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function upgradeArtworkUrl(url: string | null | undefined, size = 1080): string | null {
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return url;

  try {
    const parsed = new URL(url);
    if (!isProviderArtworkHost(parsed.hostname)) return url;
    parsed.searchParams.delete("sqp");
    parsed.searchParams.delete("rs");
    return parsed.toString()
      .replace(/=w\d+-h\d+(-[a-z0-9-]+)?/i, `=w${size}-h${size}-l90-rj`)
      .replace(/=s\d+(-[a-z0-9-]+)?/i, `=s${size}`);
  } catch {
    return url;
  }
}

export function cachedArtworkUrl(url: string | null | undefined, size = 1080): string | null {
  const localMediaUrl = normalizeLocalMediaUrl(url);
  if (localMediaUrl) return localMediaUrl;

  const upgraded = upgradeArtworkUrl(url, size);
  if (!upgraded) return null;
  if (/^(?:data:image\/|blob:)/i.test(upgraded)) return upgraded;
  if (!/^https:\/\//i.test(upgraded)) return null;
  return `${API_BASE_PATH}/media/remote-artwork?url=${encodeURIComponent(upgraded)}`;
}

function normalizeLocalMediaUrl(url: string | null | undefined, depth = 0): string | null {
  if (depth > 3) return null;
  const value = url?.trim();
  if (!value) return null;
  if (value.startsWith(`${API_BASE_PATH}/media/`)) {
    return unwrapLegacyLocalArtworkProxy(value, depth) ?? value;
  }
  if (value.startsWith("/media/")) return `${API_BASE_PATH}${value}`;
  if (!/^https?:\/\//i.test(value)) return null;

  try {
    const parsed = new URL(value);
    const browserHost = window.location.hostname.toLowerCase();
    const sourceHost = parsed.hostname.toLowerCase();
    const sameHost = sourceHost === browserHost;
    const sameLoopback = isLoopbackHost(sourceHost) && isLoopbackHost(browserHost);
    if (!sameHost && !sameLoopback) return null;

    if (parsed.pathname.startsWith(`${API_BASE_PATH}/media/`)) {
      const relative = `${parsed.pathname}${parsed.search}${parsed.hash}`;
      return unwrapLegacyLocalArtworkProxy(relative, depth) ?? relative;
    }
    if (parsed.pathname.startsWith("/media/")) {
      return `${API_BASE_PATH}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    return null;
  }
  return null;
}

function unwrapLegacyLocalArtworkProxy(value: string, depth: number): string | null {
  try {
    const parsed = new URL(value, window.location.href);
    if (parsed.pathname !== `${API_BASE_PATH}/media/remote-artwork`) return null;
    const target = parsed.searchParams.get("url");
    return target ? normalizeLocalMediaUrl(target, depth + 1) : null;
  } catch {
    return null;
  }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function isProviderArtworkHost(hostname: string): boolean {
  const value = hostname.toLowerCase().replace(/\.$/, "");
  return ["googleusercontent.com", "ggpht.com", "ytimg.com"].some(
    (host) => value === host || value.endsWith(`.${host}`),
  );
}

async function responseError(response: Response): Promise<ApiError> {
  const fallback = `ANM Player request failed (${response.status}).`;
  if (!response.headers.get("content-type")?.includes("application/json")) {
    return new ApiError(fallback, response.status, "http_error");
  }

  try {
    const body = await response.json() as {
      error?: { code?: string; message?: string; details?: { migration?: unknown } };
      detail?: string | { message?: string };
    };
    if (body.error?.code === "storage_migration_in_progress" && body.error.details?.migration) {
      window.dispatchEvent(new CustomEvent("aura-storage-migration-detected", { detail: body.error.details.migration }));
    }
    const message = body.error?.message
      ?? (typeof body.detail === "string" ? body.detail : body.detail?.message)
      ?? fallback;
    return new ApiError(message, response.status, body.error?.code ?? "http_error");
  } catch {
    return new ApiError(fallback, response.status, "invalid_error_response");
  }
}

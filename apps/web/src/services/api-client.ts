const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api/v1";
const apiAccessToken = import.meta.env.VITE_API_ACCESS_TOKEN as string | undefined;

function operatorHeaders(): Record<string, string> {
  return apiAccessToken ? { Authorization: `Bearer ${apiAccessToken}` } : {};
}

export interface ApiClientOptions {
  signal?: AbortSignal;
}

export async function apiGet<TResponse>(path: string, options: ApiClientOptions = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "GET",
    signal: options.signal,
    headers: {
      Accept: "application/json",
      ...operatorHeaders(),
    },
  });

  if (!response.ok) {
    const message = await getErrorMessage(response);
    throw new Error(message);
  }

  return (await response.json()) as TResponse;
}

export async function apiPost<TResponse, TBody>(path: string, body?: TBody, options: ApiClientOptions = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    signal: options.signal,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...operatorHeaders(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const message = await getErrorMessage(response);
    throw new Error(message);
  }

  return (await response.json()) as TResponse;
}

export async function apiPut<TResponse, TBody>(path: string, body?: TBody, options: ApiClientOptions = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "PUT",
    signal: options.signal,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...operatorHeaders(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(await getErrorMessage(response));
  return (await response.json()) as TResponse;
}

export async function apiPatch<TResponse, TBody>(path: string, body?: TBody, options: ApiClientOptions = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "PATCH",
    signal: options.signal,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...operatorHeaders(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const message = await getErrorMessage(response);
    throw new Error(message);
  }

  return (await response.json()) as TResponse;
}

export async function apiDelete<TResponse>(path: string, options: ApiClientOptions = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "DELETE",
    signal: options.signal,
    headers: {
      Accept: "application/json",
      ...operatorHeaders(),
    },
  });

  if (!response.ok) {
    const message = await getErrorMessage(response);
    throw new Error(message);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as TResponse;
  }

  const text = await response.text();
  return text ? (JSON.parse(text) as TResponse) : (undefined as TResponse);
}

export function getDownloadEventsUrl(jobId: number) {
  const url = new URL(apiBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/downloads/${jobId}/events`;
  return url.toString();
}

export function resolveApiMediaUrl(pathOrUrl: string | null | undefined): string | null {
  if (!pathOrUrl) return null;
  if (/^https?:\/\//i.test(pathOrUrl) || pathOrUrl.startsWith("data:")) {
    return pathOrUrl;
  }
  if (!pathOrUrl.startsWith("/")) {
    return pathOrUrl;
  }

  const base = new URL(apiBaseUrl);
  const apiPrefix = base.pathname.replace(/\/$/, "");
  const path = pathOrUrl.startsWith(apiPrefix) ? pathOrUrl : `${apiPrefix}${pathOrUrl}`;
  return `${base.origin}${path}`;
}

export function upgradeArtworkUrl(url: string | null | undefined, size = 1080): string | null {
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return resolveApiMediaUrl(url);

  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("ytimg.com") && !parsed.hostname.includes("googleusercontent.com")) {
      return url;
    }

    parsed.searchParams.delete("sqp");
    parsed.searchParams.delete("rs");
    let value = parsed.toString();
    value = value.replace(/=w\d+-h\d+(-[a-z0-9-]+)?/i, `=w${size}-h${size}-l90-rj`);
    value = value.replace(/=s\d+(-[a-z0-9-]+)?/i, `=s${size}`);

    return value;
  } catch {
    return url;
  }
}

export function cachedArtworkUrl(url: string | null | undefined, size = 1080): string | null {
  const upgraded = upgradeArtworkUrl(url, size);
  if (!upgraded || !/^https?:\/\//i.test(upgraded)) return upgraded;
  const base = new URL(apiBaseUrl);
  const parsed = new URL(upgraded);
  const mediaPrefix = `${base.pathname.replace(/\/$/, "")}/media/`;
  if (parsed.origin === base.origin && parsed.pathname.startsWith(mediaPrefix)) {
    return upgraded;
  }
  const proxy = new URL(`${base.origin}${base.pathname.replace(/\/$/, "")}/media/remote-artwork`);
  proxy.searchParams.set("url", upgraded);
  if (apiAccessToken) proxy.searchParams.set("access_token", apiAccessToken);
  return proxy.toString();
}

async function getErrorMessage(response: Response) {
  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string; details?: { migration?: unknown } };
      detail?: string | { message?: string };
    };
    if (body.error?.code === "storage_migration_in_progress" && body.error.details?.migration) {
      window.dispatchEvent(new CustomEvent("aura-storage-migration-detected", {
        detail: body.error.details.migration,
      }));
    }
    return body.error?.message
      ?? (typeof body.detail === "string" ? body.detail : body.detail?.message)
      ?? `API request failed: ${response.status}`;
  } catch {
    return `API request failed: ${response.status}`;
  }
}

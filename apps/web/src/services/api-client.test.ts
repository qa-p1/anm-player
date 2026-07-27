import { afterEach, describe, expect, it, vi } from "vitest";

import { apiDelete, apiGet, cachedArtworkUrl, isRequestCancelled } from "./api-client";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("API client", () => {
  it("uses same-origin relative URLs and handles 204", async () => {
    const fetchMock = vi.spyOn(window, "fetch").mockResolvedValue(new Response(null, { status: 204 }));

    await expect(apiDelete<void>("/playlists/1")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/playlists/1", expect.objectContaining({ method: "DELETE" }));
  });

  it("preserves a structured JSON error", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ error: { code: "conflict", message: "Already exists" } }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    ));

    await expect(apiGet("/playlists")).rejects.toMatchObject({
      message: "Already exists",
      status: 409,
      code: "conflict",
    });
  });

  it("does not expose a non-JSON upstream response", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(new Response("private upstream detail", { status: 502 }));

    await expect(apiGet("/ytmusic/home")).rejects.toMatchObject({ message: "Aura request failed (502)." });
  });

  it("returns a stable timeout error", async () => {
    vi.useFakeTimers();
    vi.spyOn(window, "fetch").mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const request = apiGet("/slow", { timeoutMs: 10 });
    const assertion = expect(request).rejects.toMatchObject({ code: "request_timeout" });
    await vi.advanceTimersByTimeAsync(11);

    await assertion;
  });

  it("honors caller aborts", async () => {
    const controller = new AbortController();
    vi.spyOn(window, "fetch").mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const request = apiGet("/slow", { signal: controller.signal });
    const assertion = expect(request).rejects.toMatchObject({ code: "request_aborted" });
    controller.abort();

    await assertion;
    await expect(request.catch((error: unknown) => isRequestCancelled(error))).resolves.toBe(true);
  });

  it("normalizes legacy local artwork URLs without proxying them as remote artwork", () => {
    expect(cachedArtworkUrl("/media/artwork/cache/medium/abc.jpg"))
      .toBe("/api/v1/media/artwork/cache/medium/abc.jpg");
    expect(cachedArtworkUrl("http://localhost:8000/api/v1/media/artwork/downloads/abc.jpg"))
      .toBe("/api/v1/media/artwork/downloads/abc.jpg");
    expect(cachedArtworkUrl("http://127.0.0.1:8000/media/artwork/cache/medium/abc.jpg"))
      .toBe("/api/v1/media/artwork/cache/medium/abc.jpg");
    expect(cachedArtworkUrl(
      "/api/v1/media/remote-artwork?url=http%3A%2F%2Flocalhost%3A8000%2Fmedia%2Fartwork%2Fcache%2Fmedium%2Fabc.jpg",
    )).toBe("/api/v1/media/artwork/cache/medium/abc.jpg");
    expect(cachedArtworkUrl(
      "http://localhost:8000/api/v1/media/remote-artwork?url=http%3A%2F%2F127.0.0.1%3A8000%2Fmedia%2Fartwork%2Fdownloads%2Fabc.jpg",
    )).toBe("/api/v1/media/artwork/downloads/abc.jpg");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("createPersistStorage", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function load() {
    return import("@/lib/persist-storage");
  }

  it("coalesces rapid writes into one deferred write of the latest value", async () => {
    const { createPersistStorage } = await load();
    const storage = createPersistStorage<{ position: number }>({ writeDelayMs: 1_000 });
    const setItem = vi.spyOn(localStorage, "setItem");

    for (let position = 1; position <= 40; position += 1) {
      storage.setItem("player", { state: { position }, version: 1 });
    }
    expect(setItem).not.toHaveBeenCalled();
    expect(storage.getItem("player")).toEqual({ state: { position: 40 }, version: 1 });

    vi.advanceTimersByTime(1_000);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem("player") ?? "null")).toEqual({ state: { position: 40 }, version: 1 });
  });

  it("flushes pending writes when the page is hidden", async () => {
    const { createPersistStorage } = await load();
    const storage = createPersistStorage<{ position: number }>({ writeDelayMs: 60_000 });
    storage.setItem("player", { state: { position: 7 }, version: 1 });

    window.dispatchEvent(new Event("pagehide"));

    expect(JSON.parse(localStorage.getItem("player") ?? "null")).toEqual({ state: { position: 7 }, version: 1 });
  });

  it("writes immediately without a delay and reads values back", async () => {
    const { createPersistStorage } = await load();
    const storage = createPersistStorage<{ theme: string }>();
    storage.setItem("prefs", { state: { theme: "dark" }, version: 2 });
    expect(localStorage.getItem("prefs")).toBe(JSON.stringify({ state: { theme: "dark" }, version: 2 }));
    expect(storage.getItem("prefs")).toEqual({ state: { theme: "dark" }, version: 2 });
  });

  it("treats corrupt saved state as missing", async () => {
    const { createPersistStorage } = await load();
    localStorage.setItem("prefs", "{not json");
    expect(createPersistStorage().getItem("prefs")).toBeNull();
  });

  it("drops queued and future writes once persistence is suspended for a reset", async () => {
    const { createPersistStorage, suspendPersistence } = await load();
    const deferred = createPersistStorage<{ position: number }>({ writeDelayMs: 1_000 });
    const immediate = createPersistStorage<{ theme: string }>();
    deferred.setItem("player", { state: { position: 3 }, version: 1 });

    suspendPersistence();
    localStorage.clear();
    deferred.setItem("player", { state: { position: 4 }, version: 1 });
    immediate.setItem("prefs", { state: { theme: "light" }, version: 1 });
    vi.advanceTimersByTime(5_000);
    window.dispatchEvent(new Event("pagehide"));

    expect(localStorage.length).toBe(0);
  });
});

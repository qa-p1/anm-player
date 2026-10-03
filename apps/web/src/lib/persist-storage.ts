import type { PersistStorage, StorageValue } from "zustand/middleware";

let suspended = false;
const discardPendingWrites = new Set<() => void>();

/**
 * Stop every persisted store from writing again, dropping queued writes.
 *
 * A fresh start clears saved browser state and reloads. Without this, a late
 * store update (for example the pause event fired by tearing down audio)
 * would write the old state back before the reload.
 */
export function suspendPersistence(): void {
  suspended = true;
  for (const discard of discardPendingWrites) discard();
}

/**
 * JSON localStorage persistence for zustand stores.
 *
 * With `writeDelayMs`, writes are coalesced: zustand calls `setItem` on every
 * state change, so a store holding playback position would otherwise
 * serialize its whole queue several times per second. Pending writes are
 * flushed when the page is hidden or unloaded.
 */
export function createPersistStorage<S>({ writeDelayMs = 0 }: { writeDelayMs?: number } = {}): PersistStorage<S> {
  const pending = new Map<string, StorageValue<S>>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const flush = () => {
    clearTimer();
    if (!suspended) {
      for (const [name, value] of pending) write(name, value);
    }
    pending.clear();
  };

  discardPendingWrites.add(() => {
    clearTimer();
    pending.clear();
  });
  if (writeDelayMs > 0 && typeof window !== "undefined") {
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  }

  return {
    getItem: (name) => pending.get(name) ?? read<S>(name),
    setItem: (name, value) => {
      if (suspended) return;
      if (writeDelayMs <= 0) {
        write(name, value);
        return;
      }
      pending.set(name, value);
      timer ??= setTimeout(flush, writeDelayMs);
    },
    removeItem: (name) => {
      pending.delete(name);
      try {
        localStorage.removeItem(name);
      } catch {
        // Storage can be unavailable in private browsing; nothing to remove.
      }
    },
  };
}

function read<S>(name: string): StorageValue<S> | null {
  try {
    const raw = localStorage.getItem(name);
    return raw === null ? null : (JSON.parse(raw) as StorageValue<S>);
  } catch {
    return null;
  }
}

function write<S>(name: string, value: StorageValue<S>): void {
  try {
    localStorage.setItem(name, JSON.stringify(value));
  } catch (error) {
    console.warn(`Could not save ${name}:`, error);
  }
}

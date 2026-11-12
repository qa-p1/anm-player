import type { OnlineHomeResponse } from "@/types/api";

/**
 * The last Home is kept in this browser so opening the app shows it at once;
 * fresh picks replace it a moment later.
 */
const KEY = "anm-home-cache";

interface CachedHome {
  region: string | null;
  savedAt: number;
  data: OnlineHomeResponse;
}

export function readHomeCache(): CachedHome | null {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as CachedHome) : null;
    return parsed && (typeof parsed.region === "string" || parsed.region === null) && Array.isArray(parsed.data?.sections) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeHomeCache(region: string | null, data: OnlineHomeResponse) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ region, savedAt: Date.now(), data } satisfies CachedHome));
  } catch {
    // Storage full or blocked: Home just loads normally next time.
  }
}

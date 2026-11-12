import { suspendPersistence } from "@/lib/persist-storage";
import { audioService } from "@/services/audio-service";

const BROWSER_STATE_KEYS = [
  "aura-player-storage",
  "anm-playback-preferences",
  "anm-lyrics-preferences",
  "anm-search-history",
  "anm-library-preferences",
  "anm-track-durations",
  "aura-theme",
  "aura-accent",
];

/** Stops playback and drops everything this browser remembers about the library. */
export function forgetBrowserData() {
  suspendPersistence();
  audioService.destroy();
  for (const key of BROWSER_STATE_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Storage can be unavailable (private windows); nothing to forget then.
    }
  }
}

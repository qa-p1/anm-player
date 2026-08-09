import { create } from "zustand";
import { persist } from "zustand/middleware";

export type LyricsFontSize = "compact" | "normal" | "large";

interface LyricsPreferencesState {
  offsets: Record<string, number>;
  autoScroll: boolean;
  fontSize: LyricsFontSize;
  setOffset: (targetKey: string, seconds: number) => void;
  adjustOffset: (targetKey: string, deltaSeconds: number) => void;
  resetOffset: (targetKey: string) => void;
  setAutoScroll: (enabled: boolean) => void;
  cycleFontSize: () => void;
}

export const useLyricsPreferencesStore = create<LyricsPreferencesState>()(
  persist(
    (set, get) => ({
      offsets: {},
      autoScroll: true,
      fontSize: "normal",
      setOffset: (targetKey, seconds) => set((state) => ({
        offsets: { ...state.offsets, [targetKey]: clampOffset(seconds) },
      })),
      adjustOffset: (targetKey, deltaSeconds) => {
        const current = get().offsets[targetKey] ?? 0;
        get().setOffset(targetKey, current + deltaSeconds);
      },
      resetOffset: (targetKey) => set((state) => {
        const offsets = { ...state.offsets };
        delete offsets[targetKey];
        return { offsets };
      }),
      setAutoScroll: (autoScroll) => set({ autoScroll }),
      cycleFontSize: () => set((state) => ({
        fontSize: state.fontSize === "compact" ? "normal" : state.fontSize === "normal" ? "large" : "compact",
      })),
    }),
    {
      name: "anm-lyrics-preferences",
      version: 1,
    },
  ),
);

function clampOffset(seconds: number) {
  if (!Number.isFinite(seconds)) return 0;
  return Math.round(Math.max(-30, Math.min(30, seconds)) * 10) / 10;
}

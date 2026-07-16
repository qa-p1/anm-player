import { create } from "zustand";

export type ThemeMode = "dark" | "light" | "system";
export type AccentTheme = "rose" | "teal" | "amber" | "violet";

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

const storageKey = "aura-theme";
const accentStorageKey = "aura-accent";
export const accentValues: Record<AccentTheme, string> = {
  rose: "346 88% 56%",
  teal: "174 52% 42%",
  amber: "38 92% 50%",
  violet: "258 90% 66%",
};

function getInitialMode(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  return (window.localStorage.getItem(storageKey) as ThemeMode | null) ?? "dark";
}

function applyTheme(mode: ThemeMode) {
  if (typeof window === "undefined") return;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = mode === "system" ? (prefersDark ? "dark" : "light") : mode;
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.classList.toggle("light", resolved === "light");
  document.documentElement.style.colorScheme = resolved;
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: getInitialMode(),
  setMode: (mode) => {
    window.localStorage.setItem(storageKey, mode);
    applyTheme(mode);
    set({ mode });
  },
}));

export function initializeTheme() {
  applyTheme(getInitialMode());
  const accent = (window.localStorage.getItem(accentStorageKey) as AccentTheme | null) ?? "rose";
  applyAccent(accent in accentValues ? accent : "rose");
}

export function applyAccent(accent: AccentTheme) {
  window.localStorage.setItem(accentStorageKey, accent);
  document.documentElement.style.setProperty("--primary", accentValues[accent]);
  document.documentElement.style.setProperty("--ring", accentValues[accent]);
}

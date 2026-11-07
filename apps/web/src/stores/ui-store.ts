import { create } from "zustand";

interface UiState {
  isPlayerExpanded: boolean;
  requestedPlayerView: "player" | "lyrics" | "queue" | "tools" | null;
  isShortcutHelpOpen: boolean;
  isCommandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  setPlayerExpanded: (isPlayerExpanded: boolean) => void;
  requestPlayerView: (view: "player" | "lyrics" | "queue" | "tools") => void;
  consumePlayerViewRequest: () => void;
  setShortcutHelpOpen: (isShortcutHelpOpen: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  isPlayerExpanded: false,
  requestedPlayerView: null,
  isShortcutHelpOpen: false,
  isCommandPaletteOpen: false,
  setCommandPaletteOpen: (isCommandPaletteOpen) => set({ isCommandPaletteOpen }),
  setPlayerExpanded: (isPlayerExpanded) => set({ isPlayerExpanded }),
  requestPlayerView: (requestedPlayerView) => set({ isPlayerExpanded: true, requestedPlayerView }),
  consumePlayerViewRequest: () => set({ requestedPlayerView: null }),
  setShortcutHelpOpen: (isShortcutHelpOpen) => set({ isShortcutHelpOpen }),
}));

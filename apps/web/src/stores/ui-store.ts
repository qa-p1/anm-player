import { create } from "zustand";

interface UiState {
  isPlayerExpanded: boolean;
  requestedPlayerView: "player" | "lyrics" | "queue" | "tools" | null;
  isShortcutHelpOpen: boolean;
  setPlayerExpanded: (isPlayerExpanded: boolean) => void;
  requestPlayerView: (view: "player" | "lyrics" | "queue" | "tools") => void;
  consumePlayerViewRequest: () => void;
  setShortcutHelpOpen: (isShortcutHelpOpen: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  isPlayerExpanded: false,
  requestedPlayerView: null,
  isShortcutHelpOpen: false,
  setPlayerExpanded: (isPlayerExpanded) => set({ isPlayerExpanded }),
  requestPlayerView: (requestedPlayerView) => set({ isPlayerExpanded: true, requestedPlayerView }),
  consumePlayerViewRequest: () => set({ requestedPlayerView: null }),
  setShortcutHelpOpen: (isShortcutHelpOpen) => set({ isShortcutHelpOpen }),
}));

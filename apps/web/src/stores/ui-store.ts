import { create } from "zustand";

interface UiState {
  isPlayerExpanded: boolean;
  setPlayerExpanded: (isPlayerExpanded: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  isPlayerExpanded: false,
  setPlayerExpanded: (isPlayerExpanded) => set({ isPlayerExpanded }),
}));

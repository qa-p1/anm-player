import { create } from "zustand";

interface DownloadQueueUiState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useDownloadQueueUi = create<DownloadQueueUiState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

export function openDownloadQueue() {
  useDownloadQueueUi.getState().setOpen(true);
}

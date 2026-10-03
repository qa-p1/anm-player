import { create } from "zustand";

export const useAppLifecycleStore = create<{
  isClosed: boolean;
  setClosed: () => void;
}>((set) => ({
  isClosed: false,
  setClosed: () => set({ isClosed: true }),
}));

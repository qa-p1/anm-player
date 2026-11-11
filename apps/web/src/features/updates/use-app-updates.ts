import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";

import { queryClient } from "@/lib/query-client";
import { apiGet, apiPost } from "@/services/api-client";
import { audioService } from "@/services/audio-service";
import { usePlayerStore } from "@/stores/player-store";

interface AppUpdateStatus {
  supported: boolean;
  state: string;
  message: string;
  current_version: string;
  current_commit?: string | null;
  latest_commit?: string;
  installed_commit?: string;
  summary?: string;
}
const key = ["app", "updates"];
export const busyUpdateStates = new Set(["checking", "downloading", "installing", "building", "restarting"]);
export const useAppUpdateUi = create<{
  requesting: "check" | "install" | null;
  installing: boolean;
  error: string | null;
}>(() => ({ requesting: null, installing: false, error: null }));

export function useAppUpdates() {
  return useQuery({
    queryKey: key,
    queryFn: () => apiGet<AppUpdateStatus>("/app/updates", { timeoutMs: 5000 }),
    refetchOnWindowFocus: false,
    staleTime: 30000,
    retry: false,
    refetchInterval: (query) => busyUpdateStates.has(query.state.data?.state ?? "") ? 1000 : false,
  });
}

export async function requestAppUpdate(install: boolean) {
  if (useAppUpdateUi.getState().requesting) return;
  useAppUpdateUi.setState({ requesting: install ? "install" : "check", error: null });
  try {
    const state = await apiPost<AppUpdateStatus, undefined>(`/app/updates/${install ? "install" : "check"}`);
    queryClient.setQueryData(key, state);
    if (install) {
      useAppUpdateUi.setState({ installing: true });
      usePlayerStore.getState().setIsPlaying(false);
      audioService.pause();
    }
  } catch (error) {
    useAppUpdateUi.setState({ error: error instanceof Error ? error.message : "Could not reach the updater. Try again." });
  } finally {
    useAppUpdateUi.setState({ requesting: null });
  }
}

import { useMutation, useQuery } from "@tanstack/react-query";

import { queryClient } from "@/lib/query-client";
import { apiGet, apiPatch } from "@/services/api-client";
import type { SettingsSummary } from "@/types/settings";

const settingsKey = ["settings"] as const;
export type WritableSettings = Partial<Omit<SettingsSummary, "version" | "environment" | "database_backend" | "song_count">>;

export function useSettings() {
  return useQuery({ queryKey: settingsKey, queryFn: ({ signal }) => apiGet<SettingsSummary>("/settings", { signal }), staleTime: 5 * 60 * 1000 });
}

/** Saves one change at a time and updates the shared cache right away. */
export function useSaveSetting() {
  return useMutation({
    mutationFn: (changes: WritableSettings) => apiPatch<SettingsSummary, WritableSettings>("/settings", changes),
    onMutate: async (changes) => {
      await queryClient.cancelQueries({ queryKey: settingsKey });
      const previous = queryClient.getQueryData<SettingsSummary>(settingsKey);
      if (previous) queryClient.setQueryData<SettingsSummary>(settingsKey, { ...previous, ...changes });
      return { previous };
    },
    onError: (_error, _changes, context) => {
      if (context?.previous) queryClient.setQueryData(settingsKey, context.previous);
    },
    onSuccess: (saved) => queryClient.setQueryData(settingsKey, saved),
  });
}

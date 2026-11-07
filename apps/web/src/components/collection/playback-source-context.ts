import { createContext, useContext } from "react";

import type { PlaybackSource } from "@/stores/playback-source-store";

/** Set by collection pages so rows inside them mark where playback started. */
export const PlaybackSourceContext = createContext<{ kind: PlaybackSource["kind"]; id: string | number } | null>(null);

export function usePlaybackSourceContext() {
  return useContext(PlaybackSourceContext);
}

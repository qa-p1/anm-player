import { useEffect, useState } from "react";

import type { PlaybackStatus } from "@/stores/player-store";

const transientStatuses = new Set<PlaybackStatus>(["loading", "buffering", "stalled"]);

export function useDelayedPlaybackStatus(status: PlaybackStatus, delayMilliseconds = 650): PlaybackStatus | null {
  const isTransient = transientStatuses.has(status);
  const [showTransientStatus, setShowTransientStatus] = useState(false);

  useEffect(() => {
    if (!isTransient) {
      setShowTransientStatus(false);
      return;
    }

    const timer = window.setTimeout(() => setShowTransientStatus(true), delayMilliseconds);
    return () => window.clearTimeout(timer);
  }, [delayMilliseconds, isTransient]);

  if (status === "error") return status;
  return isTransient && showTransientStatus ? status : null;
}

export function playbackStatusLabel(
  status: PlaybackStatus,
  playbackError: string | null = null,
  retryAttempt = 0,
): string {
  const label = status === "loading"
    ? "Loading audio…"
    : status === "buffering"
      ? "Buffering…"
      : status === "stalled"
        ? "Connection stalled…"
        : status === "error"
          ? playbackError || "Playback could not continue"
          : "";

  return retryAttempt > 0 && status !== "error" ? `${label} · retry ${retryAttempt}` : label;
}

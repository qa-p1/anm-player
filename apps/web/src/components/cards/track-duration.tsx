import { cn } from "@/lib/utils";
import { useTrackDurationStore } from "@/stores/track-duration-store";
import { formatTime } from "@/utils/format";

/**
 * Track length that never shows a placeholder dash: it falls back to the
 * length the player measured, and renders nothing when the length is unknown.
 */
export function TrackDuration({ trackId, seconds, className }: { trackId?: string; seconds: number | null | undefined; className?: string }) {
  const learned = useTrackDurationStore((state) => (trackId ? state.durations[trackId] : undefined));
  const value = seconds && seconds > 0 ? seconds : learned;
  if (!value) return null;
  return <span className={cn("tabular-nums", className)}>{formatTime(value)}</span>;
}

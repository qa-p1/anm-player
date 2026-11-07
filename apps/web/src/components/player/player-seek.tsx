import { useState, type KeyboardEvent, type PointerEvent } from "react";

import { seekByStep, seekPlayback } from "@/features/player/playback-controls";
import { cn } from "@/lib/utils";
import { formatTime } from "@/utils/format";

interface PlayerSeekProps {
  currentTime: number;
  duration: number;
  bufferedUntil: number;
  className?: string;
}

/**
 * Hairline scrubber that sits on the mini-player's top border. It grows on
 * hover, previews the time under the pointer and keeps a native range input
 * underneath for keyboard, touch and screen-reader seeking.
 */
export function PlayerSeek({ currentTime, duration, bufferedUntil, className }: PlayerSeekProps) {
  const [hoverFraction, setHoverFraction] = useState<number | null>(null);
  const validDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const elapsed = Number.isFinite(currentTime) ? Math.max(0, Math.min(currentTime, validDuration)) : 0;
  const progress = validDuration ? elapsed / validDuration * 100 : 0;
  const buffered = validDuration && Number.isFinite(bufferedUntil)
    ? Math.max(progress, Math.min(100, bufferedUntil / validDuration * 100)) : progress;

  function trackHover(event: PointerEvent<HTMLDivElement>) {
    if (!validDuration || event.pointerType === "touch") return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    setHoverFraction(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Use the user's seek step instead of the browser's one-second default.
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    seekByStep(event.key === "ArrowRight" ? 1 : -1);
  }

  return (
    <div
      className={cn("group/seek absolute inset-x-5 -top-[7px] z-20 h-[14px]", !validDuration && "pointer-events-none", className)}
      onPointerMove={trackHover}
      onPointerLeave={() => setHoverFraction(null)}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-foreground/[0.12] transition-[height] duration-150 group-hover/seek:h-[5px] group-focus-within/seek:h-[5px]">
        <span className="absolute inset-y-0 left-0 rounded-full bg-foreground/[0.18]" style={{ width: `${buffered}%` }} />
        <span className="absolute inset-y-0 left-0 rounded-full bg-primary shadow-[0_0_14px_hsl(var(--primary)/0.75)]" style={{ width: `${progress}%` }} />
        {hoverFraction !== null && <span className="absolute inset-y-0 left-0 rounded-full bg-foreground/20" style={{ width: `${hoverFraction * 100}%` }} />}
      </div>
      <span aria-hidden="true" className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 scale-0 rounded-full bg-primary shadow-[0_0_0_3px_hsl(var(--background)),0_2px_8px_rgb(0_0_0/0.4)] transition-transform duration-150 group-hover/seek:scale-100 group-focus-within/seek:scale-100" style={{ left: `${progress}%` }} />
      {hoverFraction !== null && (
        <span aria-hidden="true" className="pointer-events-none absolute bottom-full mb-1.5 -translate-x-1/2 rounded-md border border-white/10 bg-background/90 px-1.5 py-0.5 text-[0.65rem] font-semibold tabular-nums shadow-lg backdrop-blur" style={{ left: `${hoverFraction * 100}%` }}>
          {formatTime(hoverFraction * validDuration)}
        </span>
      )}
      <input
        type="range"
        min={0}
        max={validDuration || 1}
        step="any"
        value={elapsed}
        onChange={(event) => seekPlayback(Number(event.target.value))}
        onKeyDown={handleKeyDown}
        className="pointer-events-auto absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
        aria-label="Mini-player song progress"
        aria-valuetext={`${formatTime(elapsed)} of ${formatTime(validDuration)}`}
        disabled={!validDuration}
      />
    </div>
  );
}

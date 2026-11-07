import { cn } from "@/lib/utils";

/** Three bouncing bars marking the row or tile that is currently playing. */
export function EqualizerBars({ playing = true, className }: { playing?: boolean; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("inline-flex h-3.5 items-end gap-[2px]", !playing && "eq-paused", className)}>
      <span className="eq-bar h-full w-[3px] rounded-full bg-current" />
      <span className="eq-bar h-full w-[3px] rounded-full bg-current" />
      <span className="eq-bar h-full w-[3px] rounded-full bg-current" />
    </span>
  );
}

import { cn } from "@/lib/utils";

export function ProgressBar({ value, className, paused = false }: { value: number; className?: string; paused?: boolean }) {
  const width = Math.max(0, Math.min(100, value));
  return (
    <div role="progressbar" aria-valuenow={Math.round(width)} aria-valuemin={0} aria-valuemax={100} className={cn("overflow-hidden rounded-full bg-white/10", className)}>
      <div className={cn("h-full rounded-full transition-[width] duration-700 ease-out", paused ? "bg-muted-foreground/60" : "bg-primary")} style={{ width: `${width}%` }} />
    </div>
  );
}

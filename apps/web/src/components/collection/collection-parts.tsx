import { LayoutGrid, List, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { ArtworkImage } from "@/components/cards/artwork-image";
import { cn } from "@/lib/utils";
import type { CollectionViewMode } from "@/stores/library-preferences-store";

export function StatusChip({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "success" }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide", tone === "success" ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-300" : "border-white/10 bg-white/[0.06] text-muted-foreground")}>{children}</span>;
}

export function DetailSkeleton({ round = false }: { round?: boolean }) {
  return (
    <div role="status" aria-label="Loading" className="mx-auto max-w-7xl space-y-6 px-3 py-4 sm:px-6 lg:px-8 lg:py-7">
      <div className="h-9 w-20 animate-pulse rounded-full bg-white/[0.06]" />
      <div className="flex flex-col gap-6 rounded-[2rem] border border-white/[0.06] bg-card/40 p-7 md:flex-row md:items-end">
        <div className={cn("h-52 w-52 shrink-0 animate-pulse bg-white/[0.08]", round ? "rounded-full" : "rounded-3xl")} />
        <div className="flex-1 space-y-4"><div className="h-3 w-20 animate-pulse rounded bg-white/[0.08]" /><div className="h-14 w-3/4 animate-pulse rounded-xl bg-white/[0.08]" /><div className="h-4 w-1/3 animate-pulse rounded bg-white/[0.06]" /></div>
      </div>
      <div className="space-y-2">{Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-14 animate-pulse rounded-xl bg-white/[0.04]" />)}</div>
    </div>
  );
}

export function ViewToggle({ value, onChange, label }: { value: CollectionViewMode; onChange: (mode: CollectionViewMode) => void; label: string }) {
  return (
    <div role="group" aria-label={`${label} layout`} className="flex h-10 items-center rounded-full border border-white/10 bg-white/[0.04] p-1">
      {(["grid", "list"] as const).map((mode) => {
        const Icon = mode === "grid" ? LayoutGrid : List;
        return (
          <button key={mode} type="button" aria-label={mode === "grid" ? "Grid view" : "List view"} title={mode === "grid" ? "Grid view" : "List view"} aria-pressed={value === mode} onClick={() => onChange(mode)} className={cn("grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition hover:text-foreground", value === mode && "bg-foreground text-background hover:text-background")}>
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}

/** Horizontally scrolling shelf with snap points, used for "recently added" rows. */
export function Shelf({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-bold tracking-tight">{title}</h2>{action}</div>
      <div className="no-scrollbar -mx-3 flex snap-x gap-1 overflow-x-auto px-1 pb-2 sm:-mx-2">{children}</div>
    </section>
  );
}

export function TileSkeleton({ round = false }: { round?: boolean }) {
  return (
    <div role="status" aria-label="Loading" className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
      {Array.from({ length: 12 }).map((_, index) => (
        <div key={index} className="space-y-2"><div className={cn("aspect-square animate-pulse bg-white/[0.06]", round ? "rounded-full" : "rounded-xl")} /><div className="h-3 w-3/4 animate-pulse rounded bg-white/[0.06]" /><div className="h-3 w-1/2 animate-pulse rounded bg-white/[0.04]" /></div>
      ))}
    </div>
  );
}

function hashString(value: string) {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return Math.abs(hash);
}

/** Generated cover for playlists without artwork: stable per name, never blank. */
export function GeneratedCover({ name, className }: { name: string; className?: string }) {
  const hue = hashString(name || "playlist") % 360;
  const initial = Array.from(name.trim())[0]?.toLocaleUpperCase() ?? "♪";
  return (
    <div
      aria-hidden="true"
      className={cn("relative grid h-full w-full place-items-center overflow-hidden [container-type:inline-size]", className)}
      style={{ backgroundImage: `radial-gradient(circle at 25% 20%, hsl(${hue} 85% 62% / 0.95), transparent 58%), radial-gradient(circle at 85% 85%, hsl(${(hue + 70) % 360} 80% 50% / 0.9), transparent 60%), linear-gradient(135deg, hsl(${(hue + 200) % 360} 45% 18%), hsl(${hue} 40% 12%))` }}
    >
      <span className="select-none text-[42cqw] font-black leading-none text-white/80 mix-blend-overlay">{initial}</span>
    </div>
  );
}

/** Four-up cover mosaic for collections without their own artwork. */
export function MosaicArtwork({ urls, icon: Icon, gradient }: { urls: Array<string | null | undefined>; icon: LucideIcon; gradient?: string }) {
  const distinct = [...new Set(urls.filter((url): url is string => Boolean(url)))];
  const covers = distinct.length >= 4 ? distinct.slice(0, 4) : [];
  if (covers.length === 0) {
    return (
      <div className={cn("grid h-full w-full place-items-center", gradient ?? "bg-[radial-gradient(circle_at_30%_20%,hsl(var(--primary)/0.55),transparent_60%),linear-gradient(135deg,hsl(var(--primary)/0.35),hsl(var(--accent)/0.3))]")}>
        <Icon className="h-1/3 w-1/3 text-white/90 drop-shadow-xl" />
      </div>
    );
  }
  return <div className="grid h-full w-full grid-cols-2">{covers.map((url) => <ArtworkImage key={url} src={url} alt="" className="h-full min-h-0 w-full object-cover" />)}</div>;
}

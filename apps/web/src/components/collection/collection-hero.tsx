import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Pause, Play } from "lucide-react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";

import { ArtworkImage } from "@/components/cards/artwork-image";
import { useDominantArtworkPalette } from "@/hooks/use-artwork-palette";
import { cn } from "@/lib/utils";
import { cachedArtworkUrl } from "@/services/api-client";
import { withAlpha } from "@/utils/color";

interface CollectionHeroProps {
  kind: string;
  title: string;
  /** Raw artwork reference used for the tint and the blurred backdrop. */
  artworkUrl: string | null;
  artwork: ReactNode;
  shape?: "square" | "circle";
  description?: ReactNode;
  meta?: ReactNode;
  badges?: ReactNode;
  children?: ReactNode;
  heroRef?: RefObject<HTMLElement | null>;
  /** Fixed `rgb(r, g, b)` tint for collections without their own artwork. */
  tint?: string;
}

/**
 * Shared header for album, playlist and artist pages: artwork-tinted wash,
 * blurred backdrop and a large title, all inside the existing glass language.
 */
export function CollectionHero({ kind, title, artworkUrl, artwork, shape = "square", description, meta, badges, children, heroRef, tint: fixedTint }: CollectionHeroProps) {
  const palette = useDominantArtworkPalette(artworkUrl);
  const backdropUrl = cachedArtworkUrl(artworkUrl, 256);
  const tint = fixedTint ?? palette.base;
  const style = {
    "--hero-tint": tint,
    backgroundImage: `radial-gradient(120% 90% at 0% 0%, ${withAlpha(tint, 0.55)}, transparent 62%), radial-gradient(90% 80% at 100% 100%, ${withAlpha(tint, 0.22)}, transparent 70%)`,
  } as CSSProperties;

  return (
    <section ref={heroRef} aria-label={kind} style={style} className="relative isolate overflow-hidden rounded-[1.6rem] border border-white/10 bg-card/60 shadow-glass sm:rounded-[2rem]">
      {backdropUrl && <ArtworkImage src={backdropUrl} alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 h-full w-full scale-125 object-cover opacity-25 blur-3xl saturate-150" />}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(180deg,transparent_20%,hsl(var(--background)/0.72))]" />
      <div className="flex flex-col gap-6 p-5 sm:p-7 md:flex-row md:items-end lg:gap-8 lg:p-9">
        <div
          className={cn(
            "relative h-44 w-44 shrink-0 overflow-hidden bg-white/10 sm:h-52 sm:w-52 lg:h-60 lg:w-60",
            shape === "circle" ? "rounded-full ring-4 ring-white/10" : "rounded-2xl sm:rounded-3xl",
          )}
          style={{ boxShadow: `0 32px 80px -24px ${withAlpha(tint, 0.9)}, 0 18px 40px -20px rgb(0 0 0 / 0.6)` }}
        >
          {artwork}
        </div>
        <div className="min-w-0 flex-1 space-y-4">
          <div className="space-y-2">
            {badges && <div className="flex flex-wrap items-center gap-2">{badges}</div>}
            <h1 className="text-balance break-words text-4xl font-black leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl" title={title}>{title}</h1>
            {description && <div className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">{description}</div>}
          </div>
          {meta && <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">{meta}</div>}
        </div>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] bg-background/20 px-5 py-4 sm:gap-3 sm:px-7 lg:px-9">{children}</div>}
    </section>
  );
}

/** Joins metadata pieces with subtle dot separators. */
export function MetaDots({ items }: { items: ReactNode[] }) {
  const present = items.filter((item) => item !== null && item !== undefined && item !== false && item !== "");
  return <>{present.map((item, index) => <span key={index} className="inline-flex items-center gap-2">{index > 0 && <span aria-hidden="true" className="h-1 w-1 rounded-full bg-muted-foreground/50" />}{item}</span>)}</>;
}

export function BigPlayButton({ label, onClick, disabled, isPlaying = false, className }: { label: string; onClick: () => void; disabled?: boolean; isPlaying?: boolean; className?: string }) {
  const Icon = isPlaying ? Pause : Play;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn("grid h-14 w-14 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-glow transition hover:scale-105 hover:bg-primary/90 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50", className)}
    >
      <Icon className={cn("h-6 w-6 fill-current", !isPlaying && "translate-x-[1px]")} />
    </button>
  );
}

export function HeroIconButton({ label, onClick, disabled, active = false, children, className }: { label: string; onClick: () => void; disabled?: boolean; active?: boolean; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-foreground/80 backdrop-blur-xl transition hover:scale-105 hover:bg-white/15 hover:text-foreground active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40", active && "text-primary hover:text-primary", className)}
    >
      {children}
    </button>
  );
}

/**
 * Compact title bar that slides in after the hero leaves the viewport. It is
 * portaled because page transitions apply transforms/filters to ancestors.
 */
export function StickyCollectionBar({ visible, title, artworkUrl, round = false, onPlay, playLabel, isPlaying = false, disabled }: { visible: boolean; title: string; artworkUrl: string | null; round?: boolean; onPlay: () => void; playLabel: string; isPlaying?: boolean; disabled?: boolean }) {
  const reduceMotion = useReducedMotion();
  const target = typeof document === "undefined" ? null : document.body;
  const Icon = isPlaying ? Pause : Play;
  if (!target) return null;
  return createPortal(
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: reduceMotion ? 0 : -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduceMotion ? 0 : -16 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="fixed left-0 right-0 top-0 z-30 px-3 pt-2 sm:px-6 lg:left-64 lg:px-8"
        >
          <div className="glass-panel mr-12 flex max-w-7xl items-center gap-3 rounded-2xl py-2 pl-2 pr-3 lg:mx-auto">
            <button type="button" aria-label={playLabel} title={playLabel} onClick={onPlay} disabled={disabled} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-glow transition hover:scale-105 active:scale-95 disabled:opacity-50">
              <Icon className={cn("h-4 w-4 fill-current", !isPlaying && "translate-x-[1px]")} />
            </button>
            <span className={cn("h-9 w-9 shrink-0 overflow-hidden bg-white/10", round ? "rounded-full" : "rounded-lg")}><ArtworkImage src={artworkUrl} alt="" className="h-full w-full object-cover" /></span>
            <p className="min-w-0 truncate text-base font-bold tracking-tight">{title}</p>
            <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" })} className="ml-auto hidden shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:bg-white/10 hover:text-foreground sm:block">Back to top</button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    target,
  );
}

import { LoaderCircle, Play, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";

import { ArtworkImage } from "@/components/cards/artwork-image";
import { cn } from "@/lib/utils";

interface MediaTileProps {
  href: string;
  title: string;
  subtitle?: ReactNode;
  meta?: ReactNode;
  artworkUrl: string | null;
  fallbackArtworkUrl?: string | null;
  /** Rendered instead of an image when there is no artwork. */
  placeholder?: ReactNode;
  placeholderIcon?: LucideIcon;
  shape?: "square" | "circle";
  badge?: ReactNode;
  corner?: ReactNode;
  onPlay?: () => Promise<unknown> | void;
  playLabel?: string;
  isActive?: boolean;
  className?: string;
}

/**
 * Artwork card with a hover play button. The link and the play button are
 * siblings, so keyboard users get two independent, non-nested controls.
 */
export function MediaTile({ href, title, subtitle, meta, artworkUrl, fallbackArtworkUrl, placeholder, placeholderIcon: PlaceholderIcon, shape = "square", badge, corner, onPlay, playLabel, isActive = false, className }: MediaTileProps) {
  const [isStarting, setIsStarting] = useState(false);
  const round = shape === "circle";

  async function play() {
    if (!onPlay || isStarting) return;
    setIsStarting(true);
    try { await onPlay(); } finally { setIsStarting(false); }
  }

  return (
    <article className={cn("group/tile relative min-w-0 rounded-2xl p-2 transition hover:bg-white/[0.05] focus-within:bg-white/[0.05]", isActive && "bg-primary/[0.07]", className)}>
      <div className="relative aspect-square">
        <div className={cn("absolute inset-0 overflow-hidden bg-white/10 shadow-glass", round ? "rounded-full" : "rounded-xl")}>
          {artworkUrl || fallbackArtworkUrl
            ? <ArtworkImage src={artworkUrl} fallbackSrc={fallbackArtworkUrl} alt="" className="h-full w-full object-cover transition duration-500 group-hover/tile:scale-[1.06]" />
            : placeholder ?? <div className="grid h-full w-full place-items-center bg-[radial-gradient(circle_at_30%_20%,hsl(var(--primary)/0.25),transparent_60%),radial-gradient(circle_at_80%_90%,hsl(var(--accent)/0.2),transparent_55%)]">{PlaceholderIcon && <PlaceholderIcon className="h-1/3 w-1/3 text-muted-foreground/70" />}</div>}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent opacity-0 transition group-hover/tile:opacity-100" />
        </div>
        {badge && <div className="pointer-events-none absolute left-2 top-2">{badge}</div>}
        {onPlay && (
          <button
            type="button"
            aria-label={playLabel ?? `Play ${title}`}
            title={playLabel ?? `Play ${title}`}
            onClick={() => void play()}
            className={cn(
              "absolute z-10 grid h-11 w-11 place-items-center rounded-full bg-primary text-primary-foreground shadow-glow transition duration-200 hover:scale-110 active:scale-95 focus-visible:translate-y-0 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              round ? "bottom-1 right-1" : "bottom-2 right-2",
              isStarting ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0 group-hover/tile:translate-y-0 group-hover/tile:opacity-100 [@media(hover:none)]:translate-y-0 [@media(hover:none)]:opacity-100",
            )}
          >
            {isStarting ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5 translate-x-[1px] fill-current" />}
          </button>
        )}
      </div>
      <Link to={href} className="mt-3 block min-w-0 rounded-lg outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-ring">
        <h3 className={cn("truncate text-sm font-bold", round && "text-center", isActive && "text-primary")} title={title}>{title}</h3>
        {subtitle && <p className={cn("mt-0.5 truncate text-sm text-muted-foreground", round && "text-center")}>{subtitle}</p>}
        {meta && <p className={cn("mt-0.5 truncate text-xs text-muted-foreground", round && "text-center")}>{meta}</p>}
      </Link>
      {corner && <div className="absolute right-4 top-4 z-10">{corner}</div>}
    </article>
  );
}

export function TileBadge({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "success" | "primary" }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide shadow-lg backdrop-blur-md", tone === "success" ? "bg-emerald-500/85 text-white" : tone === "primary" ? "bg-primary/90 text-primary-foreground" : "bg-black/55 text-white")}>{children}</span>;
}

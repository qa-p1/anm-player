import { ChevronDown, FileText, Loader2, Maximize2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { EmptyState } from "@/components/empty-states/empty-state";
import { useLyrics } from "@/components/player/use-lyrics";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { audioService } from "@/services/audio-service";
import { usePlayerStore } from "@/stores/player-store";

interface LyricsPanelProps {
  songId?: number | null;
  videoId?: string | null;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  duration?: number | null;
  immersive?: boolean;
  onClose?: () => void;
  onExpand?: () => void;
}

export function LyricsPanel({
  songId = null,
  videoId = null,
  title,
  artist,
  album,
  duration,
  immersive = false,
  onClose,
  onExpand,
}: LyricsPanelProps) {
  const target = useMemo(() => {
    if (songId) return { kind: "local" as const, songId, title, artist, album, duration };
    if (videoId) return { kind: "youtube" as const, videoId, title, artist, album, duration };
    return null;
  }, [album, artist, duration, songId, title, videoId]);
  const lyricsState = useLyrics(target);
  const currentTime = usePlayerStore((state) => state.currentTime);
  const lrcLines = useMemo(() => parseLrc(lyricsState.lyrics), [lyricsState.lyrics]);
  const activeLine = useActiveLine(lrcLines, currentTime);

  if (!target) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState icon={FileText} title="No song playing" description="Play a song to view lyrics" />
      </div>
    );
  }

  return (
    <section className={cn("flex h-full min-h-0 flex-col", immersive && "px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-8")}>
      <header className={cn("flex shrink-0 items-center gap-3", immersive ? "min-h-14" : "mb-3 justify-end")}>
        {immersive && (
          <button
            type="button"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/75 transition hover:bg-white/10 hover:text-white"
            aria-label="Return to player"
            onClick={onClose}
          >
            <ChevronDown className="h-6 w-6" />
          </button>
        )}
        {immersive && (
          <div className="min-w-0 flex-1 text-center">
            <h2 className="truncate text-sm font-bold text-white">{title || "Lyrics"}</h2>
            <p className="truncate text-xs font-medium text-white/55">{artist || "Unknown Artist"}</p>
          </div>
        )}
        <Button
          type="button"
          variant="quiet"
          size="icon"
          className={cn("text-white/65 hover:text-white", immersive ? "h-11 w-11" : "h-9 w-9")}
          aria-label="Refetch lyrics"
          onClick={() => void lyricsState.refresh()}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
        {!immersive && onExpand && (
          <Button type="button" variant="quiet" size="icon" className="h-9 w-9" aria-label="Open lyrics full screen" onClick={onExpand}>
            <Maximize2 className="h-4 w-4" />
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1" aria-live="polite">
        {lyricsState.isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-9 w-9 animate-spin text-white/55" />
          </div>
        ) : !lyricsState.lyrics ? (
          <LyricsEmptyState status={lyricsState.status} onRefetch={() => lyricsState.refresh()} />
        ) : lrcLines.length > 0 ? (
          <SyncedLyricsView lines={lrcLines} activeLine={activeLine} immersive={immersive} />
        ) : (
          <PlainLyricsView lyrics={lyricsState.lyrics} immersive={immersive} />
        )}
      </div>
    </section>
  );
}

function LyricsEmptyState({ status, onRefetch }: { status: string; onRefetch: () => void }) {
  const isFetching = status === "fetching";
  const isOffline = status === "offline" || status === "timeout" || status === "provider_error" || status === "error";
  const title = isFetching ? "Fetching lyrics..." : isOffline ? "Couldn’t fetch lyrics" : "No lyrics available";
  const description = isFetching ? "Looking for synced lyrics." : isOffline ? "Check your connection and try again." : "No synced or plain lyrics were found.";

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <EmptyState icon={isFetching ? Loader2 : FileText} title={title} description={description} />
      <Button type="button" variant="glass" onClick={onRefetch} disabled={isFetching} className="text-white">
        {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        {isFetching ? "Fetching" : "Try again"}
      </Button>
    </div>
  );
}

function SyncedLyricsView({ lines, activeLine, immersive }: { lines: LrcLine[]; activeLine: number; immersive: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const manualScrollUntil = useRef(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const line = lineRefs.current[activeLine];
    if (!container || !line || Date.now() < manualScrollUntil.current) return;
    if (raf.current) window.cancelAnimationFrame(raf.current);
    raf.current = window.requestAnimationFrame(() => {
      const targetTop = line.offsetTop - 18;
      container.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
    });
    return () => {
      if (raf.current) window.cancelAnimationFrame(raf.current);
    };
  }, [activeLine]);

  return (
    <ScrollArea
      ref={containerRef}
      className="no-scrollbar h-full px-1"
      onScroll={() => {
        manualScrollUntil.current = Date.now() + 2500;
      }}
    >
      <div className={cn("mx-auto max-w-3xl space-y-4 py-8", immersive && "max-w-5xl space-y-5 pb-[70vh] pt-4 sm:space-y-7 sm:pt-6")}>
        {lines.map((line, index) =>
          line.text ? (
            <button
              key={`${line.time}-${index}`}
              ref={(node) => {
                lineRefs.current[index] = node;
              }}
              type="button"
              onClick={() => audioService.seek(line.time)}
              className={cn(
                "block w-full break-words text-left font-black leading-[1.08] tracking-[-0.035em] transition duration-300 [overflow-wrap:anywhere]",
                immersive ? "text-[clamp(2rem,7vw,4.75rem)] text-white/28 hover:text-white/65" : "text-2xl text-muted-foreground/45 hover:text-foreground sm:text-3xl",
                index === activeLine && (immersive ? "lyrics-active-glow scale-[1.01] text-white" : "scale-[1.02] text-foreground"),
                index < activeLine && (immersive ? "text-white/18" : "text-muted-foreground/30"),
              )}
            >
              {line.text}
            </button>
          ) : (
            <div key={`${line.time}-${index}`} className={immersive ? "h-6" : "h-4"} />
          ),
        )}
      </div>
    </ScrollArea>
  );
}

function PlainLyricsView({ lyrics, immersive }: { lyrics: string; immersive: boolean }) {
  return (
    <ScrollArea className="no-scrollbar h-full px-1">
      <div className={cn("mx-auto max-w-3xl overflow-hidden py-5", immersive && "max-w-5xl pb-[30vh] pt-12 sm:pt-20")}>
        <pre className={cn("max-w-full whitespace-pre-wrap break-words font-sans font-bold leading-[1.32] [overflow-wrap:anywhere]", immersive ? "text-[clamp(1.75rem,6vw,4rem)] tracking-[-0.025em] text-white" : "text-base text-foreground")}>
          {lyrics}
        </pre>
      </div>
    </ScrollArea>
  );
}

type LrcLine = { time: number; text: string };

function useActiveLine(lrcLines: LrcLine[], currentTime: number) {
  return useMemo(() => {
    if (lrcLines.length === 0) return -1;
    return lrcLines.findIndex((line, lineIndex) => {
      const next = lrcLines[lineIndex + 1];
      return currentTime >= line.time && (!next || currentTime < next.time);
    });
  }, [currentTime, lrcLines]);
}

function parseLrc(lyrics: string | null): LrcLine[] {
  if (!lyrics) return [];
  const result: LrcLine[] = [];
  for (const line of lyrics.split(/\r?\n/)) {
    const matches = [...line.matchAll(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
    if (matches.length === 0) continue;
    const text = line.replace(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g, "").trim();
    for (const match of matches) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fraction = match[3] ? Number(`0.${match[3]}`) : 0;
      result.push({ time: minutes * 60 + seconds + fraction, text });
    }
  }
  return result.sort((a, b) => a.time - b.time);
}

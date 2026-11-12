import { Copy, FileText, LocateFixed, Loader2, Minus, Pencil, Plus, RefreshCw, RotateCcw, Save, Type, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { EmptyState } from "@/components/empty-states/empty-state";
import { useLyrics } from "@/components/player/use-lyrics";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { audioService } from "@/services/audio-service";
import { useLyricsPreferencesStore, type LyricsFontSize } from "@/stores/lyrics-preferences-store";
import { usePlayerStore } from "@/stores/player-store";
import { toast } from "@/components/ui/toast";

interface LyricsPanelProps {
  songId?: number | null;
  videoId?: string | null;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  duration?: number | null;
  /** "side" sits in the player's panel; "stage" is full-screen lyrics with the biggest text. */
  layout: LyricsLayout;
}

export function LyricsPanel({
  songId = null,
  videoId = null,
  title,
  artist,
  album,
  duration,
  layout,
}: LyricsPanelProps) {
  const target = useMemo(() => {
    if (songId) return { kind: "local" as const, songId, title, artist, album, duration };
    if (videoId) return { kind: "youtube" as const, videoId, title, artist, album, duration };
    return null;
  }, [album, artist, duration, songId, title, videoId]);
  const lyricsState = useLyrics(target);
  const currentTime = usePlayerStore((state) => state.currentTime);
  const [isEditing, setIsEditing] = useState(false);
  const [draftLyrics, setDraftLyrics] = useState("");
  const lyricsPreferences = useLyricsPreferencesStore();
  const targetKey = songId ? `local:${songId}` : `youtube:${videoId}`;
  const timeOffset = lyricsPreferences.offsets[targetKey] ?? 0;
  const lrcLines = useMemo(() => parseLrc(lyricsState.lyrics), [lyricsState.lyrics]);
  const activeLine = useActiveLine(lrcLines, currentTime - timeOffset);

  useEffect(() => {
    setIsEditing(false);
    setDraftLyrics("");
  }, [targetKey]);

  function beginEditing() {
    setDraftLyrics(lyricsState.lyrics || "");
    setIsEditing(true);
  }

  async function saveEditedLyrics() {
    try {
      const result = await lyricsState.saveLyrics(draftLyrics.trim());
      if (!result) return;
      setIsEditing(false);
      toast("Lyrics saved", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save lyrics", "error");
    }
  }

  async function copyLyrics() {
    if (!lyricsState.lyrics) return;
    try {
      await navigator.clipboard.writeText(lyricsState.lyrics);
      toast("Lyrics copied", "success");
    } catch {
      toast("Could not copy lyrics", "error");
    }
  }

  if (!target) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState icon={FileText} title="No song playing" description="Play a song to view lyrics" />
      </div>
    );
  }

  return (
    <section className="group/lyrics relative flex h-full min-h-0 flex-col">
      {/* Lyric tools float over the faded bottom edge on hover, never over a line being read. */}
      <div role="toolbar" aria-label="Lyrics tools" className="absolute bottom-2 right-0 z-10 flex items-center gap-0.5 rounded-full bg-black/35 p-1 opacity-0 backdrop-blur-md transition-opacity focus-within:opacity-100 group-hover/lyrics:opacity-100 [@media(hover:none)]:hidden">
        <LyricsTool label="Refetch lyrics" onClick={() => void lyricsState.refresh()}><RefreshCw className="h-4 w-4" /></LyricsTool>
        {songId && <LyricsTool label="Edit lyrics" onClick={beginEditing}><Pencil className="h-4 w-4" /></LyricsTool>}
        {lyricsState.lyrics && !isEditing && (
          <>
            <LyricsTool active={lyricsPreferences.autoScroll} label={lyricsPreferences.autoScroll ? "Auto-scroll on" : "Auto-scroll off"} onClick={() => lyricsPreferences.setAutoScroll(!lyricsPreferences.autoScroll)}><LocateFixed className="h-4 w-4" /></LyricsTool>
            <LyricsTool label={`Text: ${lyricsPreferences.fontSize}`} onClick={lyricsPreferences.cycleFontSize}><Type className="h-4 w-4" /></LyricsTool>
            {lrcLines.length > 0 && (
              <>
                <LyricsTool label="Lyrics 0.5 seconds earlier" onClick={() => lyricsPreferences.adjustOffset(targetKey, -0.5)}><Minus className="h-4 w-4" /></LyricsTool>
                <span className="min-w-max px-1 text-[0.68rem] font-semibold tabular-nums text-white/65">{timeOffset > 0 ? "+" : ""}{timeOffset.toFixed(1)}s</span>
                <LyricsTool label="Lyrics 0.5 seconds later" onClick={() => lyricsPreferences.adjustOffset(targetKey, 0.5)}><Plus className="h-4 w-4" /></LyricsTool>
                {timeOffset !== 0 && <LyricsTool label="Reset lyrics timing" onClick={() => lyricsPreferences.resetOffset(targetKey)}><RotateCcw className="h-4 w-4" /></LyricsTool>}
              </>
            )}
            <LyricsTool label="Copy lyrics" onClick={copyLyrics}><Copy className="h-4 w-4" /></LyricsTool>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1" aria-live="polite">
        {isEditing ? (
          <div className="flex h-full min-h-0 flex-col gap-3 pb-2">
            <p className="text-xs leading-5 text-white/55">Paste plain lyrics or LRC timestamps such as <code>[01:23.45]Line</code>. Changes are stored with this downloaded song.</p>
            <textarea value={draftLyrics} onChange={(event) => setDraftLyrics(event.target.value)} spellCheck rows={16} className="min-h-0 flex-1 resize-none rounded-2xl border border-white/[0.12] bg-black/20 p-4 font-mono text-sm leading-6 text-white outline-none placeholder:text-white/35 focus:border-white/35" placeholder="Paste or edit lyrics…" aria-label="Lyrics editor" />
            <div className="flex justify-end gap-2"><Button variant="glass" onClick={() => setIsEditing(false)}><X className="h-4 w-4" />Cancel</Button><Button onClick={saveEditedLyrics} disabled={lyricsState.isSaving || !draftLyrics.trim()}><Save className="h-4 w-4" />{lyricsState.isSaving ? "Saving…" : "Save lyrics"}</Button></div>
          </div>
        ) : lyricsState.isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-9 w-9 animate-spin text-white/55" />
          </div>
        ) : !lyricsState.lyrics ? (
          <LyricsEmptyState status={lyricsState.status} onRefetch={() => lyricsState.refresh()} />
        ) : (
          <LyricsLines
            lines={lrcLines.length > 0 ? lrcLines : plainLines(lyricsState.lyrics)}
            timed={lrcLines.length > 0}
            activeLine={activeLine}
            layout={layout}
            autoScroll={lyricsPreferences.autoScroll}
            timeOffset={timeOffset}
            fontSize={lyricsPreferences.fontSize}
          />
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

type LyricsLayout = "side" | "stage";

/** Plain lyrics are the same lines, just without timestamps. */
function plainLines(lyrics: string): LrcLine[] {
  return lyrics.split(/\r?\n/).map((text) => ({ time: Number.NaN, text: text.trim() }));
}

/**
 * One look for all lyrics. Timed lyrics light up the current line and seek on
 * click; untimed lyrics are evenly lit, since we can't know where the song is.
 */
function LyricsLines({ lines, timed, activeLine, layout, autoScroll, timeOffset, fontSize }: { lines: LrcLine[]; timed: boolean; activeLine: number; layout: LyricsLayout; autoScroll: boolean; timeOffset: number; fontSize: LyricsFontSize }) {
  const centered = layout === "stage";
  const focusBlur = timed && activeLine >= 0;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const manualScrollUntil = useRef(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const line = lineRefs.current[activeLine];
    if (!timed || !autoScroll || !container || !line || Date.now() < manualScrollUntil.current) return;
    if (raf.current) window.cancelAnimationFrame(raf.current);
    raf.current = window.requestAnimationFrame(() => {
      // The sung line rides at the top, with everything that follows in view below it.
      const targetTop = line.offsetTop - (layout === "stage" ? container.clientHeight * 0.12 : 24);
      container.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
    });
    return () => {
      if (raf.current) window.cancelAnimationFrame(raf.current);
    };
  }, [activeLine, autoScroll, layout, timed]);

  return (
    <ScrollArea
      ref={containerRef}
      // The scroll area clips at its edges, so the lines sit inset far enough for their glow.
      className="no-scrollbar -mx-6 h-full px-6 [mask-image:linear-gradient(to_bottom,black_85%,transparent)]"
      onScroll={() => {
        manualScrollUntil.current = Date.now() + 2500;
      }}
    >
      <div className={cn("mx-auto", centered ? "max-w-5xl space-y-6 pb-[45vh] pt-[18vh]" : "max-w-3xl space-y-3 pb-[40vh] pt-6")}>
        {!timed && (
          <p className={cn(centered ? "mx-auto flex w-fit" : "inline-flex", "items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/70")}>
            <FileText className="h-3.5 w-3.5" />Not synced to the song
          </p>
        )}
        {lines.map((line, index) =>
          line.text && !timed ? (
            <p
              key={`plain-${index}`}
              className={cn(
                "break-words font-black leading-[1.08] tracking-[-0.035em] [overflow-wrap:anywhere]",
                centered && "text-center",
                lyricsSize(layout, fontSize),
                "text-white/85",
              )}
            >
              {line.text}
            </p>
          ) : line.text ? (
            <button
              key={`${line.time}-${index}`}
              ref={(node) => {
                lineRefs.current[index] = node;
              }}
              type="button"
              onClick={() => audioService.seek(Math.max(0, line.time + timeOffset))}
              // Apple Music style: the sung line glows, the rest soften with distance.
              style={focusBlur ? { "--lyric-blur": `${Math.min(Math.abs(index - activeLine), 3) * 0.35}px` } as CSSProperties : undefined}
              className={cn(
                "lyric-line block w-full break-words font-black leading-[1.08] tracking-[-0.035em] [overflow-wrap:anywhere]",
                centered ? "text-center" : "text-left",
                lyricsSize(layout, fontSize),
                "text-white/35 hover:text-white/75",
                index === activeLine && "lyric-line-active text-white",
                index < activeLine && "text-white/25",
              )}
            >
              {line.text}
            </button>
          ) : (
            <div key={`${line.time}-${index}`} className="h-4" />
          ),
        )}
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

function LyricsTool({ active = false, label, onClick, children }: { active?: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-label={label} title={label} aria-pressed={active || undefined} onClick={onClick} className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/65 outline-none transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/50", active && "bg-white text-black hover:bg-white/90 hover:text-black")}>{children}</button>;
}

function lyricsSize(layout: LyricsLayout, size: LyricsFontSize) {
  if (layout === "side") return size === "compact" ? "text-xl" : size === "large" ? "text-3xl" : "text-2xl";
  return size === "compact" ? "text-[clamp(1.75rem,2.6vw,2.75rem)]" : size === "large" ? "text-[clamp(2.5rem,4vw,4.25rem)]" : "text-[clamp(2.1rem,3.3vw,3.5rem)]";
}


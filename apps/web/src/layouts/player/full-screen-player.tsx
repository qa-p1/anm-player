import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ChevronDown,
  Heart,
  ListMusic,
  LoaderCircle,
  Maximize2,
  MessageSquareText,
  Minimize2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Settings2,
  Shuffle,
  SkipBack,
  SkipForward,
  WifiOff,
} from "lucide-react";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";

import { ArtworkImage } from "@/components/cards/artwork-image";
import { TrackMetadata } from "@/components/cards/track-metadata";
import { TrackActionsMenu } from "@/components/menus/track-actions-menu";
import { LyricsPanel } from "@/components/player/lyrics-panel";
import { PlayerToolsPanel } from "@/components/player/player-tools-panel";
import { QueuePanel } from "@/components/player/queue-panel";
import { PlayerSeek } from "@/components/player/player-seek";
import { nextTrack, previousTrack, togglePlayback } from "@/features/player/playback-controls";
import { usePlayerFavorite } from "@/features/player/use-player-favorite";
import { useDominantArtworkPalette } from "@/hooks/use-artwork-palette";
import { playbackStatusLabel, useDelayedPlaybackStatus } from "@/hooks/use-delayed-playback-status";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";
import { useUiStore } from "@/stores/ui-store";
import type { PlayerTrack } from "@/types/player";
import { darkenForText } from "@/utils/color";
import { formatTime } from "@/utils/format";

type Panel = "lyrics" | "queue" | "studio";

const PANELS: { id: Panel; label: string; icon: typeof ListMusic }[] = [
  { id: "lyrics", label: "Lyrics", icon: MessageSquareText },
  { id: "queue", label: "Up next", icon: ListMusic },
  { id: "studio", label: "Studio", icon: Settings2 },
];

const WIDE_QUERY = "(min-width: 1100px)";

function isWideScreen() {
  return typeof window.matchMedia === "function" && window.matchMedia(WIDE_QUERY).matches;
}

function subscribeWide(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

interface FullScreenPlayerProps {
  onClose: () => void;
}

/**
 * One full-screen player for every screen size. Wide screens show the song
 * with lyrics, the queue or the studio beside it; smaller screens stack the
 * song and open that panel as a sheet. Lyrics can also fill the whole screen.
 */
export function FullScreenPlayer({ onClose }: FullScreenPlayerProps) {
  const player = usePlayerStore(useShallow((state) => ({
    currentSong: state.currentSong,
    isPlaying: state.isPlaying,
    currentTime: state.currentTime,
    duration: state.duration || state.currentSong?.durationSeconds || 0,
    bufferedUntil: state.bufferedUntil,
    shuffle: state.shuffle,
    repeat: state.repeat,
    playbackStatus: state.playbackStatus,
    playbackError: state.playbackError,
    retryAttempt: state.retryAttempt,
  })));
  const [panel, setPanel] = useState<Panel>("lyrics");
  const [stage, setStage] = useState(false);
  // Below 1100px the panel is a sheet over the player instead of a column beside it.
  const [sheetOpen, setSheetOpen] = useState(false);
  const isWide = useSyncExternalStore(subscribeWide, isWideScreen, () => false);
  const requested = useUiStore((state) => state.requestedPlayerView);
  const consumeRequest = useUiStore((state) => state.consumePlayerViewRequest);
  const palette = useDominantArtworkPalette(player.currentSong?.artworkUrl ?? null);

  useEffect(() => {
    if (!requested) return;
    setStage(false);
    if (requested === "player") setSheetOpen(false);
    else {
      setPanel(requested === "tools" ? "studio" : requested);
      setSheetOpen(true);
    }
    consumeRequest();
  }, [consumeRequest, requested]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector('[role="dialog"], [role="menu"]')) return;
      if (stage) setStage(false);
      else if (sheetOpen && !isWide) setSheetOpen(false);
      else onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isWide, onClose, sheetOpen, stage]);

  const song = player.currentSong;
  if (!song) return null;

  return (
    <motion.div
      className="keep-dark fixed inset-0 z-[200] h-[100dvh] overflow-hidden text-white"
      style={{ backgroundColor: darkenForText(palette.base) }}
      initial={{ opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 28 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
    >
      <Backdrop artworkUrl={song.artworkUrl} />
      <AnimatePresence mode="wait" initial={false}>
        {stage ? (
          <LyricsStage key="stage" song={song} onCollapse={() => setStage(false)} onClose={onClose} />
        ) : (
          <motion.div
            key="split"
            className="relative flex h-full flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-8 min-[1100px]:grid min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(24rem,42%)] min-[1100px]:gap-8 min-[1100px]:p-8 xl:gap-12 xl:p-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <section aria-label="Now playing" className="relative flex min-h-0 flex-1 flex-col">
              <RoundButton label="Close full-screen player" onClick={onClose} className="absolute left-0 top-0 z-10"><ChevronDown className="h-5 w-5" /></RoundButton>
              <div className="no-scrollbar flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto pt-12 min-[1100px]:overflow-visible min-[1100px]:pt-0">
                <div className="flex w-full max-w-[min(30rem,44vh)] flex-col min-[1100px]:max-w-[min(32rem,58vh)]">
                  <Artwork song={song} status={player.playbackStatus} error={player.playbackError} attempt={player.retryAttempt} />
                  <SongHeading song={song} onClose={onClose} />
                  <Progress currentTime={player.currentTime} duration={player.duration} bufferedUntil={player.bufferedUntil} />
                  <Transport isPlaying={player.isPlaying} shuffle={player.shuffle} repeat={player.repeat} />
                </div>
              </div>
              {/* Smaller screens reach lyrics, the queue and the studio from a bar pinned to the bottom. */}
              <nav aria-label="Lyrics, queue and studio" className="mx-auto mt-4 grid w-full max-w-[30rem] shrink-0 grid-cols-3 gap-1 rounded-full border border-white/10 bg-white/[0.06] p-1 backdrop-blur-xl min-[1100px]:hidden">
                {PANELS.map(({ id, label, icon: Icon }) => (
                  <button key={id} type="button" onClick={() => { setPanel(id); setSheetOpen(true); }} className="flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full px-2 text-sm font-semibold text-white/70 transition hover:bg-white/10 hover:text-white">
                    <Icon className="h-4 w-4" />{label}
                  </button>
                ))}
              </nav>
            </section>

            <section
              aria-label="Beside the song"
              className={cn(
                "flex min-h-0 flex-col rounded-[1.75rem] border border-white/10 bg-black/25 p-5 shadow-[0_30px_80px_-40px_rgba(0,0,0,0.8)] backdrop-blur-2xl",
                "max-[1099px]:fixed max-[1099px]:inset-0 max-[1099px]:z-40 max-[1099px]:rounded-none max-[1099px]:border-0 max-[1099px]:bg-black/50 max-[1099px]:px-4 max-[1099px]:pb-[max(1rem,env(safe-area-inset-bottom))] max-[1099px]:pt-[max(0.75rem,env(safe-area-inset-top))] max-[1099px]:backdrop-blur-3xl sm:max-[1099px]:px-8",
                !sheetOpen && "max-[1099px]:hidden",
              )}
            >
              <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
                <RoundButton label="Back to the song" onClick={() => setSheetOpen(false)} className="min-[1100px]:hidden"><ChevronDown className="h-5 w-5" /></RoundButton>
                <div role="tablist" aria-label="Lyrics, queue and studio" className="grid flex-1 grid-cols-3 gap-1 rounded-full border border-white/10 bg-white/[0.06] p-1">
                  {PANELS.map(({ id, label, icon: Icon }) => (
                    <button key={id} type="button" role="tab" aria-selected={panel === id} onClick={() => setPanel(id)} className={cn("flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-full px-2 text-sm font-semibold transition sm:px-3", panel === id ? "bg-white text-black" : "text-white/65 hover:text-white")}>
                      <Icon className="hidden h-4 w-4 sm:block" />{label}
                    </button>
                  ))}
                </div>
                {panel === "lyrics" && <RoundButton label="Lyrics full screen" onClick={() => setStage(true)}><Maximize2 className="h-4 w-4" /></RoundButton>}
              </div>
              {/* Mounted only when visible, so lyrics can scroll to the current line. */}
              {(isWide || sheetOpen) && <div className="min-h-0 flex-1">
                {panel === "lyrics" ? <SongLyrics song={song} layout="side" />
                  : panel === "queue" ? <QueuePanel embedded onClose={() => setPanel("lyrics")} />
                    : <PlayerToolsPanel embedded trackId={song.id} currentTime={player.currentTime} duration={player.duration} onClose={() => setPanel("lyrics")} />}
              </div>}
            </section>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/** Full-screen lyrics: the words take the stage, the song shrinks to a header and a slim transport. */
function LyricsStage({ song, onCollapse, onClose }: { song: PlayerTrack; onCollapse: () => void; onClose: () => void }) {
  const { isPlaying, currentTime, duration, bufferedUntil } = usePlayerStore(useShallow((state) => ({
    isPlaying: state.isPlaying,
    currentTime: state.currentTime,
    duration: state.duration || state.currentSong?.durationSeconds || 0,
    bufferedUntil: state.bufferedUntil,
  })));
  const PlayIcon = isPlaying ? Pause : Play;
  return (
    <motion.div
      className="relative flex h-full flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-10 sm:pb-6 sm:pt-6 xl:px-16"
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.985 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className="flex shrink-0 items-center gap-4">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-white/10 shadow-lg">
          {song.artworkUrl && <ArtworkImage src={song.artworkUrl} alt="" className="h-full w-full object-cover" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold">{song.title}</p>
          <TrackMetadata track={song} className="flex text-sm font-medium text-white/60" onNavigate={onClose} />
        </div>
        <RoundButton label="Exit lyrics full screen" onClick={onCollapse}><Minimize2 className="h-4 w-4" /></RoundButton>
        <RoundButton label="Close full-screen player" onClick={onClose}><ChevronDown className="h-5 w-5" /></RoundButton>
      </header>
      <div className="mx-auto min-h-0 w-full max-w-5xl flex-1">
        <SongLyrics song={song} layout="stage" />
      </div>
      <footer className="mx-auto flex w-full max-w-3xl shrink-0 items-center gap-2 rounded-full sm:gap-4 border border-white/10 bg-black/30 px-4 py-2 backdrop-blur-2xl">
        <button type="button" aria-label="Previous track" onClick={previousTrack} className="grid h-10 w-10 place-items-center rounded-full text-white/80 transition hover:bg-white/10 hover:text-white"><SkipBack className="h-5 w-5 fill-current" /></button>
        <button type="button" aria-label={isPlaying ? "Pause" : "Play"} onClick={togglePlayback} className="grid h-11 w-11 place-items-center rounded-full bg-white text-black transition hover:scale-105"><PlayIcon className={cn("h-5 w-5 fill-current", !isPlaying && "translate-x-px")} /></button>
        <button type="button" aria-label="Next track" onClick={nextTrack} className="grid h-10 w-10 place-items-center rounded-full text-white/80 transition hover:bg-white/10 hover:text-white"><SkipForward className="h-5 w-5 fill-current" /></button>
        <span className="w-10 text-right text-xs tabular-nums text-white/55">{formatTime(currentTime)}</span>
        <SeekRange currentTime={currentTime} duration={duration} bufferedUntil={bufferedUntil} className="flex-1" />
        <span className="w-10 text-xs tabular-nums text-white/55">{duration > 0 ? formatTime(duration) : ""}</span>
      </footer>
    </motion.div>
  );
}

/** A slowly drifting, heavily blurred copy of the cover, dark enough for white text on any artwork. */
function Backdrop({ artworkUrl }: { artworkUrl: string | null }) {
  const reduceMotion = useReducedMotion();
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {artworkUrl && (
        <>
          <ArtworkImage src={artworkUrl} alt="" className={cn("absolute left-1/2 top-1/2 h-[160vmax] w-[160vmax] max-w-none -translate-x-1/2 -translate-y-1/2 object-cover opacity-70 blur-[110px] saturate-150", !reduceMotion && "player-backdrop-drift")} />
          <ArtworkImage src={artworkUrl} alt="" className={cn("absolute -bottom-1/3 -right-1/4 h-[90vmax] w-[90vmax] max-w-none object-cover opacity-50 blur-[120px] saturate-150", !reduceMotion && "player-backdrop-drift-reverse")} />
        </>
      )}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.35),rgba(0,0,0,0.55))]" />
    </div>
  );
}

function Artwork({ song, status, error, attempt }: { song: PlayerTrack; status: Parameters<typeof useDelayedPlaybackStatus>[0]; error: string | null; attempt: number }) {
  const shown = useDelayedPlaybackStatus(status);
  const retry = usePlayerStore((state) => state.retryCurrentSong);
  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-white/10 shadow-[0_40px_90px_-30px_rgba(0,0,0,0.85)]">
      {song.artworkUrl ? <ArtworkImage src={song.artworkUrl} alt={song.title} className="h-full w-full object-cover" /> : <div className="h-full w-full bg-[linear-gradient(145deg,rgba(255,255,255,0.24),rgba(0,0,0,0.18))]" />}
      {shown && (
        <div role="status" aria-live={shown === "error" ? "assertive" : "polite"} className={cn("absolute inset-x-3 bottom-3 flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-xs font-semibold text-white/85 backdrop-blur-md", shown === "error" && "border-red-300/25 text-red-100")}>
          {shown === "error" ? <WifiOff className="h-4 w-4 shrink-0" /> : <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" />}
          <span className="truncate">{playbackStatusLabel(shown, error, attempt)}</span>
          {shown === "error" && <button type="button" onClick={() => retry()} className="shrink-0 rounded-full bg-white/[0.12] px-2 py-1 text-white hover:bg-white/20">Retry</button>}
        </div>
      )}
    </div>
  );
}

function SongHeading({ song, onClose }: { song: PlayerTrack; onClose: () => void }) {
  const { isFavorited, isUpdating, toggleFavorite } = usePlayerFavorite(song);
  return (
    <div className="mt-6 flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-2xl font-black tracking-[-0.02em]" title={song.title}>{song.title}</h1>
        <TrackMetadata track={song} className="mt-0.5 flex text-base font-medium text-white/60" linkClassName="hover:text-white" onNavigate={onClose} />
      </div>
      <RoundButton label={isFavorited ? "Remove from favorites" : "Add to favorites"} onClick={() => void toggleFavorite()} disabled={isUpdating}>
        <Heart className={cn("h-[1.1rem] w-[1.1rem]", isFavorited && "fill-current text-primary")} />
      </RoundButton>
      <TrackActionsMenu track={song} isFavorited={isFavorited} onToggleFavorite={toggleFavorite} triggerVariant="glass" triggerClassName="border-0 bg-white/10 text-white hover:bg-white/20" />
    </div>
  );
}

function Progress({ currentTime, duration, bufferedUntil }: { currentTime: number; duration: number; bufferedUntil: number }) {
  return (
    <div className="mt-5">
      <SeekRange currentTime={currentTime} duration={duration} bufferedUntil={bufferedUntil} className="w-full" />
      <div className="mt-1.5 flex justify-between text-xs font-medium tabular-nums text-white/50">
        <span>{formatTime(currentTime)}</span>
        <span>{duration > 0 ? `-${formatTime(Math.max(0, duration - currentTime))}` : ""}</span>
      </div>
    </div>
  );
}

/** The mini-player's glowing scrubber, so both players share one look. */
function SeekRange({ currentTime, duration, bufferedUntil, className }: { currentTime: number; duration: number; bufferedUntil: number; className?: string }) {
  return (
    <div className={cn("relative h-[14px]", className)}>
      <PlayerSeek currentTime={currentTime} duration={duration} bufferedUntil={bufferedUntil} label="Song progress" className="inset-x-0 top-0" thick />
    </div>
  );
}

function Transport({ isPlaying, shuffle, repeat }: { isPlaying: boolean; shuffle: boolean; repeat: "off" | "all" | "one" }) {
  const PlayIcon = isPlaying ? Pause : Play;
  const RepeatIcon = repeat === "one" ? Repeat1 : Repeat;
  return (
    <div className="mt-4 flex items-center justify-between">
      <ToggleButton label={shuffle ? "Disable shuffle" : "Enable shuffle"} active={shuffle} onClick={() => usePlayerStore.getState().toggleShuffle()}><Shuffle className="h-5 w-5" /></ToggleButton>
      <button type="button" aria-label="Previous track" onClick={previousTrack} className="grid h-14 w-14 place-items-center rounded-full text-white transition hover:bg-white/10 active:scale-95"><SkipBack className="h-7 w-7 fill-current" /></button>
      <button type="button" aria-label={isPlaying ? "Pause" : "Play"} onClick={togglePlayback} className="grid h-[4.5rem] w-[4.5rem] place-items-center rounded-full bg-white text-black shadow-lg transition hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/40">
        <PlayIcon className={cn("h-8 w-8 fill-current", !isPlaying && "translate-x-0.5")} />
      </button>
      <button type="button" aria-label="Next track" onClick={nextTrack} className="grid h-14 w-14 place-items-center rounded-full text-white transition hover:bg-white/10 active:scale-95"><SkipForward className="h-7 w-7 fill-current" /></button>
      <ToggleButton label={repeat === "one" ? "Repeat one" : repeat === "all" ? "Repeat all" : "Repeat off"} active={repeat !== "off"} onClick={() => usePlayerStore.getState().cycleRepeat()}><RepeatIcon className="h-5 w-5" /></ToggleButton>
    </div>
  );
}

function SongLyrics({ song, layout }: { song: PlayerTrack; layout: "side" | "stage" }) {
  return (
    <LyricsPanel
      songId={song.source === "local" ? song.localKind === "song" ? song.songId : song.rawLibraryTrack?.song_id ?? null : null}
      videoId={song.source === "youtube" ? song.videoId : null}
      title={song.title}
      artist={song.artistName}
      album={song.albumTitle}
      duration={song.durationSeconds}
      side={layout === "side"}
      stage={layout === "stage"}
    />
  );
}

function RoundButton({ label, onClick, disabled, className, children }: { label: string; onClick: () => void; disabled?: boolean; className?: string; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50", className)}>
      {children}
    </button>
  );
}

function ToggleButton({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} aria-pressed={active} onClick={onClick} className={cn("relative grid h-11 w-11 place-items-center rounded-full transition hover:bg-white/10", active ? "text-primary" : "text-white/60 hover:text-white")}>
      {children}
      {active && <span aria-hidden="true" className="absolute bottom-1 h-1 w-1 rounded-full bg-primary" />}
    </button>
  );
}

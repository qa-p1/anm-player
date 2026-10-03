import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import {
  Heart,
  LoaderCircle,
  ListMusic,
  MessageSquareText,
  Pause,
  Play,
  Settings2,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
  WifiOff,
} from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router";
import { useShallow } from "zustand/react/shallow";

import { TrackActionsMenu } from "@/components/menus/track-actions-menu";
import { ArtworkImage } from "@/components/cards/artwork-image";
import { LyricsPanel } from "@/components/player/lyrics-panel";
import { PlayerToolsPanel } from "@/components/player/player-tools-panel";
import { QueuePanel } from "@/components/player/queue-panel";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { cachedArtworkUrl } from "@/services/api-client";
import { audioService } from "@/services/audio-service";
import { toggleFavorite as toggleFavoriteApi } from "@/services/music-api";
import { usePlayerStore } from "@/stores/player-store";
import { useUiStore } from "@/stores/ui-store";
import type { PlayerTrack } from "@/types/player";
import { formatTime } from "@/utils/format";

type PlayerView = "player" | "lyrics" | "queue" | "tools";

interface FullScreenPlayerProps {
  onClose: () => void;
}

function playerTrackFavoriteState(track: PlayerTrack | null | undefined): boolean {
  if (!track || track.source !== "local") return false;
  return track.localKind === "song" ? Boolean(track.rawSong?.is_favorited) : Boolean(track.rawLibraryTrack?.is_favorited);
}

export function FullScreenPlayer({ onClose }: FullScreenPlayerProps) {
  const navigate = useNavigate();
  const {
    currentSong,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    shuffle,
    playbackStatus,
    playbackError,
    retryAttempt,
    setIsPlaying,
    setVolume,
    toggleMute,
    toggleShuffle,
    retryCurrentSong,
    playNextManually,
    playPreviousSong,
  } = usePlayerStore(useShallow((state) => ({
    currentSong: state.currentSong,
    isPlaying: state.isPlaying,
    currentTime: state.currentTime,
    duration: state.duration,
    volume: state.volume,
    isMuted: state.isMuted,
    shuffle: state.shuffle,
    playbackStatus: state.playbackStatus,
    playbackError: state.playbackError,
    retryAttempt: state.retryAttempt,
    setIsPlaying: state.setIsPlaying,
    setVolume: state.setVolume,
    toggleMute: state.toggleMute,
    toggleShuffle: state.toggleShuffle,
    retryCurrentSong: state.retryCurrentSong,
    playNextManually: state.playNextManually,
    playPreviousSong: state.playPreviousSong,
  })));
  const [view, setView] = useState<PlayerView>("player");
  const requestedPlayerView = useUiStore((state) => state.requestedPlayerView);
  const consumePlayerViewRequest = useUiStore((state) => state.consumePlayerViewRequest);
  const [isFavorited, setIsFavorited] = useState(playerTrackFavoriteState(currentSong));
  const palette = useDominantArtworkPalette(currentSong?.artworkUrl ?? null);

  const currentFavoriteState = playerTrackFavoriteState(currentSong);
  useEffect(() => {
    setIsFavorited(currentFavoriteState);
  }, [currentSong?.id, currentFavoriteState]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (view !== "player") setView("player");
      else onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, view]);

  useEffect(() => {
    if (!requestedPlayerView) return;
    setView(requestedPlayerView);
    consumePlayerViewRequest();
  }, [consumePlayerViewRequest, requestedPlayerView]);

  if (!currentSong) return null;

  const progress = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const volumeProgress = isMuted ? 0 : volume * 100;
  const PlayIcon = isPlaying ? Pause : Play;

  function handlePlayPause() {
    setIsPlaying(!isPlaying);
  }

  function handlePrevious() {
    const currentId = currentSong?.id;
    const previous = playPreviousSong();
    if (previous) {
      if (previous.id === currentId) audioService.seek(0);
      setIsPlaying(true);
    }
  }

  function handleNext() {
    const next = playNextManually();
    if (next) setIsPlaying(true);
  }

  async function handleToggleFavorite() {
    if (!currentSong || currentSong.source !== "local") return;
    try {
      const result = await toggleFavoriteApi(
        currentSong.localKind === "song"
          ? { entity_type: "song", entity_id: currentSong.songId }
          : { entity_type: "library_track", entity_id: currentSong.libraryTrackId },
      );
      setIsFavorited(result.is_favorited);
      toast(result.is_favorited ? "Added to favorites" : "Removed from favorites", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Failed to update favorite", "error");
    }
  }

  function goToArtist() {
    if (!currentSong || currentSong.source !== "local") return;
    const artistPath = currentSong.localKind === "song"
      ? currentSong.rawSong?.artist_id && `/library/artists/${currentSong.rawSong.artist_id}`
      : currentSong.rawLibraryTrack?.artist_id
        ? `/library/artists/${currentSong.rawLibraryTrack.artist_id}`
        : currentSong.rawLibraryTrack?.artist_external_id && `/library/artists/online/${currentSong.rawLibraryTrack.artist_external_id}`;
    if (!artistPath) return;
    navigate(artistPath);
    onClose();
  }

  function goToAlbum() {
    if (!currentSong) return;
    if (currentSong.source === "youtube") {
      const publicId = currentSong.rawItem?.album?.id;
      if (!publicId) return;
      navigate(`/albums/${publicId}`);
      onClose();
      return;
    }
    const albumPublicId = currentSong.localKind === "song" ? currentSong.rawSong?.album_public_id : currentSong.rawLibraryTrack?.album_public_id;
    if (!albumPublicId) return;
    navigate(`/albums/${albumPublicId}`);
    onClose();
  }

  function handlePlayerSwipeEnd(_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
    if (info.offset.y > 72 || info.velocity.y > 650) onClose();
  }

  return (
    <motion.div
      className="fixed inset-0 z-[200] h-[100dvh] overflow-hidden text-white transition-[background-color] duration-700 ease-out"
      style={{ backgroundColor: palette.base }}
      initial={{ opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 28 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(255,255,255,0.18),transparent_48%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(0,0,0,0.12)_55%,rgba(0,0,0,0.58))]" />
      <AnimatePresence mode="wait" initial={false}>
        {view === "lyrics" ? (
          <motion.div
            key="lyrics"
            className="relative h-full"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <LyricsPanel
              songId={currentSong.source === "local"
                ? currentSong.localKind === "song"
                  ? currentSong.songId
                  : currentSong.rawLibraryTrack?.song_id ?? null
                : null}
              videoId={currentSong.source === "youtube" ? currentSong.videoId : null}
              title={currentSong.title}
              artist={currentSong.artistName}
              album={currentSong.albumTitle}
              duration={currentSong.durationSeconds}
              immersive
              onClose={() => setView("player")}
            />
          </motion.div>
        ) : view === "tools" ? (
          <motion.div
            key="tools"
            className="relative h-full"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <PlayerToolsPanel
              trackId={currentSong.id}
              currentTime={currentTime}
              duration={duration}
              onClose={() => setView("player")}
            />
          </motion.div>
        ) : view === "queue" ? (
          <motion.div
            key="queue"
            className="relative h-full"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <QueuePanel onClose={() => setView("player")} />
          </motion.div>
        ) : (
          <motion.main
            key="player"
            className="relative mx-auto flex h-full w-full max-w-[32rem] touch-pan-x flex-col px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-8"
            initial={{ opacity: 0, x: -18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 18 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.58 }}
            dragMomentum={false}
            onDragEnd={handlePlayerSwipeEnd}
          >
            <button
              type="button"
              className="group mx-auto flex h-10 w-24 shrink-0 items-start justify-center pt-2"
              aria-label="Close full-screen player; swipe down or tap"
              onClick={onClose}
            >
              <span className="h-1.5 w-14 rounded-full bg-white/55 transition group-hover:bg-white/80" />
            </button>

            <div className="flex min-h-0 flex-1 items-center justify-center py-2 sm:py-4">
              <div className="aspect-square w-[min(86vw,43dvh,27rem)] overflow-hidden rounded-lg bg-black/10 shadow-[0_30px_80px_-28px_rgba(0,0,0,0.8)] sm:rounded-xl">
                {currentSong.artworkUrl ? (
                  <ArtworkImage src={currentSong.artworkUrl} alt={currentSong.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full bg-[linear-gradient(145deg,rgba(255,255,255,0.24),rgba(0,0,0,0.18))]" />
                )}
              </div>
            </div>

            <section className="shrink-0 pb-1">
              <div className="flex items-center gap-3 pt-3 sm:pt-5">
                <div className="min-w-0 flex-1">
                  <h1 className="truncate text-[1.15rem] font-bold leading-tight tracking-[-0.02em] sm:text-2xl">{currentSong.title}</h1>
                  <p className="mt-0.5 truncate text-base font-medium text-white/60 sm:text-lg">{currentSong.artistName || "Unknown Artist"}</p>
                </div>
                {currentSong.source === "local" && (
                  <button
                    type="button"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                    aria-label={isFavorited ? "Remove from favorites" : "Add to favorites"}
                    onClick={handleToggleFavorite}
                  >
                    <Heart className={cn("h-[1.15rem] w-[1.15rem]", isFavorited && "fill-current")} />
                  </button>
                )}
                <TrackActionsMenu
                  track={currentSong}
                  isFavorited={isFavorited}
                  onToggleFavorite={currentSong.source === "local" ? handleToggleFavorite : undefined}
                  onGoToArtist={currentSong.source === "local" && (currentSong.localKind === "song"
                    ? currentSong.rawSong?.artist_id
                    : currentSong.rawLibraryTrack?.artist_id || currentSong.rawLibraryTrack?.artist_external_id)
                    ? goToArtist
                    : undefined}
                  onGoToAlbum={currentSong.source === "local" && (currentSong.localKind === "song"
                    ? currentSong.rawSong?.album_public_id
                    : currentSong.rawLibraryTrack?.album_public_id)
                    ? goToAlbum
                    : undefined}
                  triggerVariant="glass"
                  triggerClassName="border-0 bg-white/10 text-white hover:bg-white/20"
                />
              </div>

              <div className="mt-5 sm:mt-7">
                {(playbackStatus === "loading" || playbackStatus === "buffering" || playbackStatus === "stalled" || playbackStatus === "error") && (
                  <div className={cn("mb-3 flex items-center justify-center gap-2 rounded-xl bg-black/15 px-3 py-2 text-xs font-semibold text-white/70", playbackStatus === "error" && "text-red-200")} role="status">
                    {playbackStatus === "error" ? <WifiOff className="h-4 w-4" /> : <LoaderCircle className="h-4 w-4 animate-spin" />}
                    <span>{playbackStatus === "loading" ? "Loading audio…" : playbackStatus === "buffering" ? "Buffering…" : playbackStatus === "stalled" ? "The connection stalled…" : playbackError || "Playback could not continue"}{retryAttempt > 0 && playbackStatus !== "error" ? ` · retry ${retryAttempt}` : ""}</span>
                    {playbackStatus === "error" && <button type="button" className="rounded-full bg-white/12 px-2 py-1 text-white hover:bg-white/20" onClick={() => { if (retryCurrentSong()) setIsPlaying(true); }}>Retry</button>}
                  </div>
                )}
                <input
                  type="range"
                  min={0}
                  max={Math.max(duration, 1)}
                  step={0.1}
                  value={Math.min(currentTime, Math.max(duration, 1))}
                  onChange={(event) => audioService.seek(Number(event.target.value))}
                  className="apple-player-range w-full"
                  style={{ "--range-progress": `${progress}%` } as CSSProperties}
                  aria-label="Song progress"
                />
                <div className="mt-1 flex justify-between text-[0.68rem] font-medium tabular-nums text-white/45">
                  <span>{formatTime(currentTime)}</span>
                  <span>-{formatTime(Math.max(0, duration - currentTime))}</span>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between px-[8%] sm:mt-6">
                <PlaybackButton label="Previous track" onClick={handlePrevious}><SkipBack className="h-8 w-8 fill-current sm:h-9 sm:w-9" /></PlaybackButton>
                <PlaybackButton label={isPlaying ? "Pause" : "Play"} onClick={handlePlayPause} large>
                  <PlayIcon className={cn("h-11 w-11 fill-current sm:h-12 sm:w-12", !isPlaying && "translate-x-0.5")} />
                </PlaybackButton>
                <PlaybackButton label="Next track" onClick={handleNext}><SkipForward className="h-8 w-8 fill-current sm:h-9 sm:w-9" /></PlaybackButton>
              </div>

              <div className="mt-4 flex items-center gap-2.5 text-white/55 sm:mt-6">
                <button type="button" onClick={toggleMute} aria-label={isMuted ? "Unmute" : "Mute"}>
                  {isMuted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume1 className="h-4 w-4" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={isMuted ? 0 : volume}
                  onChange={(event) => setVolume(Number(event.target.value))}
                  className="apple-player-range flex-1"
                  style={{ "--range-progress": `${volumeProgress}%` } as CSSProperties}
                  aria-label="Volume"
                />
                <Volume2 className="h-[1.1rem] w-[1.1rem]" />
              </div>

              <div className="mt-4 grid grid-cols-4 items-center sm:mt-6">
                <PlayerFooterButton label="Open lyrics full screen" active={false} onClick={() => setView("lyrics")}><MessageSquareText className="h-[1.35rem] w-[1.35rem]" /></PlayerFooterButton>
                <PlayerFooterButton label={shuffle ? "Disable shuffle" : "Enable shuffle"} active={shuffle} onClick={toggleShuffle}><Shuffle className="h-[1.35rem] w-[1.35rem]" /></PlayerFooterButton>
                <PlayerFooterButton label="Show queue" active={false} onClick={() => setView("queue")}><ListMusic className="h-[1.35rem] w-[1.35rem]" /></PlayerFooterButton>
                <PlayerFooterButton label="Open playback studio" active={false} onClick={() => setView("tools")}><Settings2 className="h-[1.35rem] w-[1.35rem]" /></PlayerFooterButton>
              </div>
            </section>
          </motion.main>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function PlaybackButton({ label, onClick, large = false, children }: { label: string; onClick: () => void; large?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className={cn("flex items-center justify-center text-white transition active:scale-90", large ? "h-16 w-16" : "h-14 w-14")}>
      {children}
    </button>
  );
}

function PlayerFooterButton({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} aria-pressed={active} onClick={onClick} className={cn("mx-auto flex h-10 w-12 items-center justify-center rounded-full text-white/65 transition hover:bg-white/10 hover:text-white", active && "bg-white/15 text-white")}>
      {children}
    </button>
  );
}

interface ArtworkPalette {
  base: string;
}

const fallbackPalette: ArtworkPalette = {
  base: "rgb(73, 78, 84)",
};

function useDominantArtworkPalette(artworkUrl: string | null) {
  const [palette, setPalette] = useState<ArtworkPalette>(fallbackPalette);

  useEffect(() => {
    if (!artworkUrl) {
      setPalette(fallbackPalette);
      return;
    }

    let cancelled = false;
    const cached = artworkPaletteCache.get(artworkUrl);
    if (cached) {
      setPalette(cached);
      return;
    }
    setPalette(fallbackPalette);
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 48;
        canvas.height = 48;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return;
        context.drawImage(image, 0, 0, 48, 48);
        const pixels = context.getImageData(0, 0, 48, 48).data;
        const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();

        for (let index = 0; index < pixels.length; index += 16) {
          if (pixels[index + 3] < 180) continue;
          const r = pixels[index];
          const g = pixels[index + 1];
          const b = pixels[index + 2];
          const luminance = r * 0.299 + g * 0.587 + b * 0.114;
          if (luminance < 14 || luminance > 242) continue;
          const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
          const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
          bucket.count += 1;
          bucket.r += r;
          bucket.g += g;
          bucket.b += b;
          buckets.set(key, bucket);
        }

        const dominant = [...buckets.values()].sort((a, b) => colorScore(b) - colorScore(a))[0];
        if (!dominant || cancelled) return;
        const source = [dominant.r / dominant.count, dominant.g / dominant.count, dominant.b / dominant.count];
        const base = boostDominantColor(source);
        const nextPalette = { base: rgb(base) };
        if (artworkPaletteCache.size >= 128 && !artworkPaletteCache.has(artworkUrl)) {
          const oldestKey = artworkPaletteCache.keys().next().value;
          if (oldestKey) artworkPaletteCache.delete(oldestKey);
        }
        artworkPaletteCache.set(artworkUrl, nextPalette);
        setPalette(nextPalette);
      } catch {
        if (!cancelled) setPalette(fallbackPalette);
      }
    };
    image.onerror = () => {
      if (!cancelled) setPalette(fallbackPalette);
    };
    image.src = colorExtractionUrl(cachedArtworkUrl(artworkUrl, 128) ?? artworkUrl);
    return () => {
      cancelled = true;
    };
  }, [artworkUrl]);

  return palette;
}

const artworkPaletteCache = new Map<string, ArtworkPalette>();

function colorScore(bucket: { count: number; r: number; g: number; b: number }) {
  const r = bucket.r / bucket.count;
  const g = bucket.g / bucket.count;
  const b = bucket.b / bucket.count;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  return bucket.count * (1 + saturation * 0.45);
}

function boostDominantColor(channels: number[]) {
  const average = channels.reduce((sum, channel) => sum + channel, 0) / channels.length;
  return channels.map((channel) => {
    const saturated = average + (channel - average) * 1.18;
    return Math.round(Math.max(28, Math.min(184, saturated * 0.72 + 18)));
  });
}

function colorExtractionUrl(url: string) {
  if (!import.meta.env.DEV) return url;
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.pathname.startsWith("/api/")) {
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    // Use the original artwork URL when it cannot be parsed.
  }
  return url;
}

function rgb(channels: number[]) {
  return `rgb(${channels.join(", ")})`;
}

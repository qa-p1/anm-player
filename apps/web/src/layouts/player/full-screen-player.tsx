import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import {
  ChevronDown,
  GripVertical,
  Heart,
  ListMusic,
  MessageSquareText,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";

import { TrackActionsMenu } from "@/components/menus/track-actions-menu";
import { ArtworkImage } from "@/components/cards/artwork-image";
import { LyricsPanel } from "@/components/player/lyrics-panel";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { cachedArtworkUrl } from "@/services/api-client";
import { audioService } from "@/services/audio-service";
import { toggleFavorite as toggleFavoriteApi } from "@/services/music-api";
import { usePlayerStore } from "@/stores/player-store";
import type { PlayerTrack } from "@/types/player";
import { formatTime } from "@/utils/format";

type PlayerView = "player" | "lyrics" | "queue";

interface FullScreenPlayerProps {
  onClose: () => void;
}

interface QueueEntry {
  id: string;
  song: PlayerTrack;
  queueIndex: number;
}

interface SortableQueueProps {
  queue: PlayerTrack[];
  onReorder: (queue: PlayerTrack[]) => void;
  onRemove: (index: number) => void;
}

function SortableQueue({ queue, onReorder, onRemove }: SortableQueueProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const entries = useMemo(() => {
    const occurrences = new Map<string, number>();
    return queue.map((song, queueIndex) => {
      const baseId = `${song.source}:${song.id}`;
      const occurrence = occurrences.get(baseId) ?? 0;
      occurrences.set(baseId, occurrence + 1);
      return { id: `${baseId}:${occurrence}`, song, queueIndex };
    });
  }, [queue]);
  const activeEntry = entries.find((entry) => entry.id === activeId) ?? null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    if (!event.over || event.active.id === event.over.id) return;
    const fromIndex = entries.findIndex((entry) => entry.id === event.active.id);
    const toIndex = entries.findIndex((entry) => entry.id === event.over?.id);
    if (fromIndex < 0 || toIndex < 0) return;
    onReorder(arrayMove(queue, fromIndex, toIndex));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={entries.map((entry) => entry.id)} strategy={verticalListSortingStrategy}>
        <ul className="space-y-2">
          {entries.map((entry) => (
            <SortableQueueRow key={entry.id} entry={entry} onRemove={onRemove} />
          ))}
        </ul>
      </SortableContext>
      <DragOverlay adjustScale={false} dropAnimation={{ duration: 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }}>
        {activeEntry ? <QueueDragPreview song={activeEntry.song} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function SortableQueueRow({ entry, onRemove }: { entry: QueueEntry; onRemove: (index: number) => void }) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.id });
  const { song, queueIndex } = entry;
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? "transform 240ms cubic-bezier(0.22, 1, 0.36, 1)",
    opacity: isDragging ? 0.28 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 rounded-2xl bg-white/10 p-3 backdrop-blur-xl will-change-transform",
        isDragging && "ring-1 ring-white/15",
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Drag ${song.title} to reorder`}
        className="-ml-1 grid h-10 w-8 shrink-0 touch-none cursor-grab place-items-center rounded-lg text-white/40 transition hover:bg-white/10 hover:text-white/80 active:cursor-grabbing"
      >
        <GripVertical className="h-5 w-5" aria-hidden="true" />
      </button>
      <QueueSongDetails song={song} />
      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onRemove(queueIndex)}
        aria-label={`Remove ${song.title} from queue`}
        className="shrink-0 rounded-lg p-1 text-white/60 transition hover:bg-white/10 hover:text-red-300"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}

function QueueDragPreview({ song }: { song: PlayerTrack }) {
  return (
    <div className="flex cursor-grabbing items-center gap-3 rounded-2xl border border-white/25 bg-white/20 p-3 shadow-2xl shadow-black/45 backdrop-blur-2xl">
      <div className="-ml-1 grid h-10 w-8 shrink-0 place-items-center text-white/75">
        <GripVertical className="h-5 w-5" aria-hidden="true" />
      </div>
      <QueueSongDetails song={song} />
      <div className="h-6 w-6 shrink-0" />
    </div>
  );
}

function QueueSongDetails({ song }: { song: PlayerTrack }) {
  return (
    <>
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-white/10">
        <ArtworkImage src={song.artworkUrl} alt="" className="h-full w-full object-cover" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{song.title}</p>
        <p className="truncate text-xs text-white/55">{song.artistName || "Unknown Artist"}</p>
      </div>
      <span className="shrink-0 text-xs tabular-nums text-white/45">{formatTime(song.durationSeconds ?? 0)}</span>
    </>
  );
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
    repeat,
    queue,
    setIsPlaying,
    setVolume,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
    playNextSong,
    playPreviousSong,
    removeFromQueue,
    setQueueOrder,
    clearQueue,
  } = usePlayerStore();
  const [view, setView] = useState<PlayerView>("player");
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

  if (!currentSong) return null;

  const progress = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const volumeProgress = isMuted ? 0 : volume * 100;
  const PlayIcon = isPlaying ? Pause : Play;
  const RepeatIcon = repeat === "one" ? Repeat1 : Repeat;

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
    const next = playNextSong();
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
              songId={currentSong.source === "local" && currentSong.localKind === "song" ? currentSong.songId : null}
              videoId={currentSong.source === "youtube" ? currentSong.videoId : currentSong.localKind === "library_track" ? currentSong.rawLibraryTrack?.external_id ?? null : null}
              title={currentSong.title}
              artist={currentSong.artistName}
              album={currentSong.albumTitle}
              duration={currentSong.durationSeconds}
              immersive
              onClose={() => setView("player")}
            />
          </motion.div>
        ) : view === "queue" ? (
          <motion.section
            key="queue"
            className="relative mx-auto flex h-full w-full max-w-2xl flex-col px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-8"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <PlayerSheetHeader title="Up Next" onClose={() => setView("player")} />
            <div className="mb-5 flex items-center justify-center gap-3">
              <Button variant="glass" onClick={toggleShuffle} className={cn("border-white/15 bg-white/10 text-white", shuffle && "bg-white text-black hover:bg-white/90")}>
                <Shuffle className="h-4 w-4" />
                Shuffle
              </Button>
              <Button variant="glass" onClick={cycleRepeat} className={cn("border-white/15 bg-white/10 text-white", repeat !== "off" && "bg-white text-black hover:bg-white/90")}>
                <RepeatIcon className="h-4 w-4" />
                {repeat === "one" ? "Repeat one" : repeat === "all" ? "Repeat all" : "Repeat"}
              </Button>
              {queue.length > 0 && (
                <Button variant="glass" onClick={clearQueue} className="border-white/15 bg-white/10 text-white">
                  <Trash2 className="h-4 w-4" />
                  Clear
                </Button>
              )}
            </div>
            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto pb-4">
              {queue.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <ListMusic className="mb-4 h-10 w-10 text-white/45" />
                  <p className="text-lg font-bold">Your queue is empty</p>
                  <p className="mt-1 text-sm text-white/55">Add a track from any song menu.</p>
                </div>
              ) : (
                <SortableQueue queue={queue} onReorder={setQueueOrder} onRemove={removeFromQueue} />
              )}
            </div>
          </motion.section>
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
                  onGoToArtist={currentSong.source === "local" && (currentSong.localKind === "song" ? currentSong.rawSong?.artist_id : currentSong.rawLibraryTrack?.artist_external_id) ? goToArtist : undefined}
                  onGoToAlbum={currentSong.source === "local" && (currentSong.localKind === "song" ? currentSong.rawSong?.album_id : currentSong.rawLibraryTrack?.album_id) ? goToAlbum : undefined}
                  triggerVariant="glass"
                  triggerClassName="border-0 bg-white/10 text-white hover:bg-white/20"
                />
              </div>

              <div className="mt-5 sm:mt-7">
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

              <div className="mt-4 grid grid-cols-3 items-center sm:mt-6">
                <PlayerFooterButton label="Open lyrics full screen" active={false} onClick={() => setView("lyrics")}><MessageSquareText className="h-[1.35rem] w-[1.35rem]" /></PlayerFooterButton>
                <PlayerFooterButton label={shuffle ? "Disable shuffle" : "Enable shuffle"} active={shuffle} onClick={toggleShuffle}><Shuffle className="h-[1.35rem] w-[1.35rem]" /></PlayerFooterButton>
                <PlayerFooterButton label="Show queue" active={false} onClick={() => setView("queue")}><ListMusic className="h-[1.35rem] w-[1.35rem]" /></PlayerFooterButton>
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

function PlayerSheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <header className="mb-4 grid shrink-0 grid-cols-[2.75rem_1fr_2.75rem] items-center">
      <button type="button" aria-label="Return to player" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white">
        <ChevronDown className="h-6 w-6" />
      </button>
      <h2 className="text-center text-base font-bold">{title}</h2>
      <span />
    </header>
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

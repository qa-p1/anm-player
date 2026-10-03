import { Check, Pause, Play, Plus } from "lucide-react";
import type { MouseEvent } from "react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useShallow } from "zustand/react/shallow";

import { Button } from "@/components/ui/button";
import { TrackActionsMenu } from "@/components/menus/track-actions-menu";
import { TrackRow } from "@/components/cards/track-row";
import { ArtworkImage } from "@/components/cards/artwork-image";
import { TrackMetadata } from "@/components/cards/track-metadata";
import { toast } from "@/components/ui/toast";
import { cachedArtworkUrl } from "@/services/api-client";
import { addUnifiedAlbumToLibrary } from "@/services/music-api";
import { usePlayerStore } from "@/stores/player-store";
import type { AlbumStatusItem, OnlineMusicItem } from "@/types/api";
import { onlineItemToPlayerTrack } from "@/types/player";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/utils/format";

interface OnlineMusicCardProps {
  item: OnlineMusicItem;
  context?: OnlineMusicItem[];
  variant?: "row" | "tile" | "artist";
  className?: string;
  albumStatus?: AlbumStatusItem;
  isDownloaded?: boolean;
}

export function OnlineMusicCard({ item, context, variant = "tile", className, albumStatus, isDownloaded = false }: OnlineMusicCardProps) {
  const navigate = useNavigate();
  const { currentSong, isPlaying, playSong, setIsPlaying } = usePlayerStore(useShallow((state) => ({
    currentSong: state.currentSong,
    isPlaying: state.isPlaying,
    playSong: state.playSong,
    setIsPlaying: state.setIsPlaying,
  })));
  const track = item.playable ? onlineItemToPlayerTrack(item) : null;
  const contextTracks = context?.filter((entry) => entry.playable).map(onlineItemToPlayerTrack);
  const artworkUrl = cachedArtworkUrl(item.thumbnail);
  const isCurrent = Boolean(track && currentSong?.id === track.id);
  const isCurrentPlaying = isCurrent && isPlaying;
  const PlayIcon = isCurrentPlaying ? Pause : Play;

  const [isInLibrary, setIsInLibrary] = useState(albumStatus?.in_library ?? false);
  const [isSavingAlbum, setIsSavingAlbum] = useState(false);

  useEffect(() => {
    setIsInLibrary(albumStatus?.in_library ?? false);
  }, [albumStatus?.in_library]);

  function play(event?: MouseEvent) {
    event?.stopPropagation();
    if (!track && item.kind === "album" && (item.browse_id || item.id)) {
      navigate(`/albums/${encodeURIComponent(item.browse_id || item.id)}`);
      return;
    }
    if (!track && item.kind === "artist" && (item.browse_id || item.id)) {
      navigate(`/library/artists/online/${encodeURIComponent(item.browse_id || item.id)}`);
      return;
    }
    if (!track) return;
    if (isCurrent) {
      setIsPlaying(!isPlaying);
    } else {
      playSong(track, contextTracks);
    }
  }

  async function saveAlbum(event: MouseEvent) {
    event.stopPropagation();
    if (item.kind !== "album" || !(item.browse_id || item.id)) return;
    if (isInLibrary) return;
    setIsSavingAlbum(true);
    try {
      await addUnifiedAlbumToLibrary(item.browse_id || item.id);
      setIsInLibrary(true);
      toast("Album added to library", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Failed to add album", "error");
    } finally {
      setIsSavingAlbum(false);
    }
  }

  const actions = track ? (
    <TrackActionsMenu
      track={track}
      triggerClassName={variant === "tile" || variant === "artist" ? "opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100" : undefined}
      iconClassName="h-4 w-4"
    />
  ) : item.kind === "album" ? (
    <Button
      size="sm"
      variant="ghost"
      disabled={isInLibrary || isSavingAlbum}
      className={cn("h-8 shrink-0 px-2 text-xs", isInLibrary && "text-emerald-400 opacity-100")}
      onClick={saveAlbum}
    >
      {isInLibrary ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
      {isSavingAlbum ? "Adding..." : isInLibrary ? "In library" : "Add"}
    </Button>
  ) : null;

  if (variant === "row") {
    if (track) {
      return (
        <TrackRow
          track={track}
          context={contextTracks}
          subtitle={item.subtitle ?? item.kind}
          className={className}
          isDownloaded={isDownloaded}
        />
      );
    }
    return (
      <article className={cn("glass-panel group relative flex min-w-0 items-center gap-3 rounded-2xl p-2.5 transition hover:bg-white/10 sm:p-3", className)}>
        <button type="button" onClick={play} aria-label={`Open ${item.title}`} className="flex min-w-0 flex-1 items-center gap-3 text-left after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring">
          <Artwork artworkUrl={artworkUrl} title={item.title} round={false} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{item.title}</span>
            <span className="block truncate text-xs text-muted-foreground">{item.subtitle ?? item.kind}</span>
          </span>
          <span className="hidden text-xs text-muted-foreground sm:block">{formatDuration(item.duration_seconds)}</span>
          <PlayIcon className="h-4 w-4 shrink-0 fill-current" />
        </button>
        <div className="relative z-10 shrink-0">{actions}</div>
      </article>
    );
  }

  const isArtist = variant === "artist" || item.kind === "artist";
  const artistId = item.kind === "album" ? item.artists[0]?.id : null;

  return (
    <article className={cn("group relative min-w-0", className)}>
      <button
        type="button"
        onClick={play}
        aria-label={`${item.playable ? isCurrentPlaying ? "Pause" : "Play" : "Open"} ${item.title}`}
        className="block w-full min-w-0 text-left after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
      >
        <span className={cn("relative mb-3 block aspect-square overflow-hidden bg-white/10", isArtist ? "rounded-full" : "rounded-2xl")}>
          {artworkUrl ? (
            <ArtworkImage src={artworkUrl} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" loading="lazy" />
          ) : (
            <span className="block h-full w-full bg-[linear-gradient(135deg,#f43f5e,#14b8a6_52%,#f59e0b)]" />
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-primary text-primary-foreground shadow-glow">
              <PlayIcon className="h-4 w-4 fill-current" />
            </span>
          </span>
        </span>
        <span className={cn("block min-w-0", isArtist && "text-center")}>
          <span className="block truncate text-sm font-bold">{item.title}</span>
        </span>
      </button>
      {track ? (
        <div className={cn("pointer-events-none relative z-10 min-w-0", isArtist && "text-center", actions && "pr-11")}>
          <TrackMetadata
            track={track}
            fallbackArtist={item.subtitle ?? item.kind}
            className="mt-1 flex text-xs text-muted-foreground"
            linkClassName="pointer-events-auto"
          />
        </div>
      ) : (
        <span className={cn("pointer-events-none relative z-10 mt-1 block min-w-0 truncate text-xs text-muted-foreground", isArtist && "text-center", actions && "pr-24")}>
          {artistId ? (
            <Link to={`/library/artists/online/${encodeURIComponent(artistId)}`} className="pointer-events-auto hover:text-primary hover:underline">
              {item.subtitle ?? item.artists[0].name}
            </Link>
          ) : item.subtitle ?? item.kind}
        </span>
      )}
      <div className="absolute bottom-0 right-0 z-10">{actions}</div>
    </article>
  );
}

function Artwork({ artworkUrl, title, round }: { artworkUrl: string | null; title: string; round: boolean }) {
  return (
    <span className={cn("h-12 w-12 shrink-0 overflow-hidden bg-white/10", round ? "rounded-full" : "rounded-xl")}>
      {artworkUrl ? (
        <ArtworkImage src={artworkUrl} alt={title} className="h-full w-full object-cover" />
      ) : (
        <span className="block h-full w-full bg-[linear-gradient(135deg,#f43f5e,#14b8a6_52%,#f59e0b)]" />
      )}
    </span>
  );
}

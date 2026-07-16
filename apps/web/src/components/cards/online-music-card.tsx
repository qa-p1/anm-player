import { Check, Pause, Play, Plus } from "lucide-react";
import type { MouseEvent } from "react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { TrackActionsMenu } from "@/components/menus/track-actions-menu";
import { TrackRow } from "@/components/cards/track-row";
import { ArtworkImage } from "@/components/cards/artwork-image";
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
  const { currentSong, isPlaying, playSong, setIsPlaying } = usePlayerStore();
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
      <article
        className={cn("glass-panel group flex min-w-0 items-center gap-3 rounded-2xl p-2.5 transition hover:bg-white/10 sm:p-3", isCurrent && "ring-1 ring-primary/40", className)}
        onClick={() => play()}
      >
        <Artwork artworkUrl={artworkUrl} title={item.title} round={false} />
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-sm font-semibold", isCurrent && "text-primary")}>{item.title}</p>
          <p className="truncate text-xs text-muted-foreground">{item.subtitle ?? item.kind}</p>
        </div>
        <span className="hidden text-xs text-muted-foreground sm:block">{formatDuration(item.duration_seconds)}</span>
        {item.playable && (
          <Button size="icon" variant="ghost" aria-label="Play" onClick={play}>
            <PlayIcon className="h-4 w-4 fill-current" />
          </Button>
        )}
        {actions}
      </article>
    );
  }

  const isArtist = variant === "artist" || item.kind === "artist";

  return (
    <article className={cn("group min-w-0 cursor-pointer", className)} onClick={() => play()}>
      <div className={cn("relative mb-3 aspect-square overflow-hidden bg-white/10", isArtist ? "rounded-full" : "rounded-2xl")}>
        {artworkUrl ? (
          <ArtworkImage src={artworkUrl} alt={item.title} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" loading="lazy" />
        ) : (
          <div className="h-full w-full bg-[linear-gradient(135deg,#f43f5e,#14b8a6_52%,#f59e0b)]" />
        )}
        {item.playable && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition group-hover:opacity-100">
            <Button size="icon" aria-label="Play" onClick={play}>
              <PlayIcon className="h-4 w-4 fill-current" />
            </Button>
          </div>
        )}
      </div>
      <div className={cn("flex items-start gap-2", isArtist && "text-center")}>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{item.title}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{item.subtitle ?? item.kind}</p>
        </div>
        {actions}
      </div>
    </article>
  );
}

function Artwork({ artworkUrl, title, round }: { artworkUrl: string | null; title: string; round: boolean }) {
  return (
    <div className={cn("h-12 w-12 shrink-0 overflow-hidden bg-white/10", round ? "rounded-full" : "rounded-xl")}>
      {artworkUrl ? (
        <ArtworkImage src={artworkUrl} alt={title} className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full bg-[linear-gradient(135deg,#f43f5e,#14b8a6_52%,#f59e0b)]" />
      )}
    </div>
  );
}

import {
  Check,
  Download,
  Heart,
  ListMusic,
  ListPlus,
  MoreHorizontal,
  PlayCircle,
  Plus,
  Trash2,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useAddOnlineTrackToPlaylist, useAddSongsToPlaylist, useAllPlaylists, useCreatePlaylist } from "@/hooks/use-music-queries";
import { cn } from "@/lib/utils";
import { isRequestCancelled } from "@/services/api-client";
import { addLibraryTracksToPlaylist, getLibraryTrackStatuses, queueDownload } from "@/services/music-api";
import { usePlayerStore } from "@/stores/player-store";
import type { PlayerTrack } from "@/types/player";

interface TrackActionsMenuProps {
  track: PlayerTrack;
  isFavorited?: boolean;
  onToggleFavorite?: () => void | Promise<void>;
  onGoToArtist?: () => void;
  onGoToAlbum?: () => void;
  onRemoveFromPlaylist?: () => void | Promise<void>;
  isDownloaded?: boolean;
  onRemoveDownload?: () => void | Promise<void>;
  onEnrich?: () => void | Promise<void>;
  triggerClassName?: string;
  triggerVariant?: "ghost" | "glass";
  iconClassName?: string;
}

export function TrackActionsMenu({
  track,
  isFavorited,
  onToggleFavorite,
  onGoToArtist,
  onGoToAlbum,
  onRemoveFromPlaylist,
  isDownloaded,
  onRemoveDownload,
  onEnrich,
  triggerClassName,
  triggerVariant = "ghost",
  iconClassName,
}: TrackActionsMenuProps) {
  const { addToQueue, playNext } = usePlayerStore();
  const [isOpen, setIsOpen] = useState(false);
  const [resolvedDownloaded, setResolvedDownloaded] = useState(isDownloaded ?? false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const { data: playlists = [] } = useAllPlaylists({ enabled: isOpen });
  const createPlaylistMutation = useCreatePlaylist();
  const addSongsToPlaylistMutation = useAddSongsToPlaylist();
  const addOnlineTrackMutation = useAddOnlineTrackToPlaylist();

  useEffect(() => {
    if (isDownloaded !== undefined) setResolvedDownloaded(isDownloaded);
  }, [isDownloaded]);

  useEffect(() => {
    if (!isOpen || track.source !== "youtube" || isDownloaded !== undefined) return;
    const controller = new AbortController();
    getLibraryTrackStatuses([track.videoId], controller.signal)
      .then((response) => setResolvedDownloaded(response.statuses[0]?.is_downloaded ?? false))
      .catch((error: unknown) => {
        if (!isRequestCancelled(error)) console.error("Could not check track download status:", error);
      });
    return () => controller.abort();
  }, [isOpen, isDownloaded, track]);

  function handlePlayNext() {
    playNext(track);
    toast("Will play next", "success");
    setIsOpen(false);
  }

  function handleAddToQueue() {
    addToQueue(track);
    toast("Added to queue", "success");
    setIsOpen(false);
  }

  async function addToPlaylist(playlistId: number, reportResult = true): Promise<boolean> {
    try {
      if (track.source === "local" && track.localKind === "song") {
        await addSongsToPlaylistMutation.mutateAsync({ playlistId, songIds: [track.songId] });
      } else if (track.source === "local") {
        await addLibraryTracksToPlaylist(playlistId, [track.libraryTrackId]);
      } else {
        await addOnlineTrackMutation.mutateAsync({ playlistId, track: onlineTrackPayload(track) });
      }
      setIsOpen(false);
      if (reportResult) toast("Added to playlist", "success");
      return true;
    } catch (error) {
      if (reportResult) {
        toast(error instanceof Error ? error.message : "Failed to add to playlist", "error");
      }
      return false;
    }
  }

  async function handleCreatePlaylist() {
    const name = newPlaylistName.trim();
    if (!name) return;
    try {
      const playlist = await createPlaylistMutation.mutateAsync({ name });
      const added = await addToPlaylist(playlist.id, false);
      setShowCreateDialog(false);
      setNewPlaylistName("");
      toast(
        added ? "Playlist created and track added" : "Playlist created, but the track could not be added",
        added ? "success" : "error",
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : "Failed to create playlist", "error");
    }
  }

  async function handleDownload() {
    if (track.source !== "youtube") return;
    try {
      await queueDownload({
        source_url: track.rawItem.url,
        video_id: track.videoId,
        title: track.title,
        artist: track.artistName,
        album: track.albumTitle,
        thumbnail_url: track.rawItem.thumbnail,
        search_query: "track-menu",
      });
      toast("Download queued", "success");
      setIsOpen(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Failed to queue download", "error");
    }
  }

  return (
    <>
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant={triggerVariant}
            className={cn("h-9 w-9 shrink-0", triggerClassName)}
            aria-label={`More actions for ${track.title}`}
            onClick={(event) => event.stopPropagation()}
          >
            <MoreHorizontal className={cn("h-5 w-5", iconClassName)} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="track-actions-menu-content w-56" onClick={(event) => event.stopPropagation()}>
          <DropdownMenuItem onClick={handlePlayNext}>
            <PlayCircle className="mr-2 h-4 w-4" />
            Play next
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleAddToQueue}>
            <ListMusic className="mr-2 h-4 w-4" />
            Add to queue
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <ListPlus className="mr-2 h-4 w-4" />
              Add to playlist
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 w-56 overflow-y-auto">
              <DropdownMenuItem onClick={() => setShowCreateDialog(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create new playlist
              </DropdownMenuItem>
              {playlists.length > 0 && <DropdownMenuSeparator />}
              {playlists.map((playlist) => (
                <DropdownMenuItem key={playlist.id} onClick={() => addToPlaylist(playlist.id)}>
                  <ListMusic className="mr-2 h-4 w-4" />
                  <span className="truncate">{playlist.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {(onToggleFavorite || track.source === "youtube" || onGoToArtist || onGoToAlbum) && <DropdownMenuSeparator />}
          {onToggleFavorite && (
            <DropdownMenuItem onClick={onToggleFavorite}>
              <Heart className={cn("mr-2 h-4 w-4", isFavorited && "fill-current text-primary")} />
              {isFavorited ? "Remove from favorites" : "Add to favorites"}
            </DropdownMenuItem>
          )}
          {track.source === "youtube" && !resolvedDownloaded && (
            <DropdownMenuItem onClick={handleDownload}>
              <Download className="mr-2 h-4 w-4" />
              Download to library
            </DropdownMenuItem>
          )}
          {track.source === "youtube" && resolvedDownloaded && (
            <DropdownMenuItem disabled className="text-emerald-400 opacity-100">
              <Check className="mr-2 h-4 w-4" />
              Downloaded
            </DropdownMenuItem>
          )}
          {onGoToArtist && <DropdownMenuItem onClick={onGoToArtist}>Go to artist</DropdownMenuItem>}
          {onGoToAlbum && <DropdownMenuItem onClick={onGoToAlbum}>Go to album</DropdownMenuItem>}
          {onEnrich && (
            <DropdownMenuItem onClick={onEnrich}>
              <Sparkles className="mr-2 h-4 w-4" />
              Enrich metadata
            </DropdownMenuItem>
          )}

          {(onRemoveDownload || onRemoveFromPlaylist) && <DropdownMenuSeparator />}
          {resolvedDownloaded && onRemoveDownload && (
            <DropdownMenuItem className="text-destructive" onClick={onRemoveDownload}>
              <Trash2 className="mr-2 h-4 w-4" />
              Remove download
            </DropdownMenuItem>
          )}
          {onRemoveFromPlaylist && (
            <DropdownMenuItem className="text-destructive" onClick={onRemoveFromPlaylist}>
              <Trash2 className="mr-2 h-4 w-4" />
              Remove from playlist
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent onClick={(event) => event.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Create new playlist</DialogTitle>
            <DialogDescription>Name the playlist and this track will be added immediately.</DialogDescription>
          </DialogHeader>
          <Input
            value={newPlaylistName}
            onChange={(event) => setNewPlaylistName(event.target.value)}
            placeholder="Playlist name"
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleCreatePlaylist();
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button
              onClick={handleCreatePlaylist}
              disabled={createPlaylistMutation.isPending || addSongsToPlaylistMutation.isPending || addOnlineTrackMutation.isPending || !newPlaylistName.trim()}
            >
              {createPlaylistMutation.isPending ? "Creating..." : "Create & add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function onlineTrackPayload(track: Extract<PlayerTrack, { source: "youtube" }>) {
  const item = track.rawItem;
  return {
    external_id: track.videoId,
    title: track.title,
    artist_name: track.artistName,
    artist_external_id: item.artists[0]?.id ?? null,
    album_title: track.albumTitle,
    duration_seconds: track.durationSeconds,
    source_url: item.url,
    artwork_url: item.thumbnail,
    explicit: item.explicit,
  };
}

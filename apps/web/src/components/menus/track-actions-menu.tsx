import {
  Check,
  Download,
  Heart,
  ListMusic,
  ListPlus,
  MoreHorizontal,
  PlayCircle,
  Plus,
  Radio,
  Share2,
  Info,
  Link as LinkIcon,
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
import { usePlaybackPreferencesStore } from "@/stores/playback-preferences-store";
import type { PlayerTrack } from "@/types/player";
import { formatDuration } from "@/utils/format";

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
  const { addToQueue, playNext, playSong } = usePlayerStore();
  const [isOpen, setIsOpen] = useState(false);
  const [resolvedDownloaded, setResolvedDownloaded] = useState(isDownloaded ?? false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
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

  function handleStartRadio() {
    usePlaybackPreferencesStore.getState().setAutoplayEnabled(true);
    playSong(track);
    toast("Track radio started", "success");
    setIsOpen(false);
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(trackShareUrl(track));
      toast("Track link copied", "success");
      setIsOpen(false);
    } catch {
      toast("Could not copy the track link", "error");
    }
  }

  async function handleShare() {
    if (!navigator.share) {
      await handleCopyLink();
      return;
    }
    try {
      await navigator.share({ title: track.title, text: track.artistName || undefined, url: trackShareUrl(track) });
      setIsOpen(false);
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) toast("Could not share this track", "error");
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
          <DropdownMenuItem onClick={handleStartRadio}>
            <Radio className="mr-2 h-4 w-4" />
            Start track radio
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

          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleCopyLink}>
            <LinkIcon className="mr-2 h-4 w-4" />
            Copy track link
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleShare}>
            <Share2 className="mr-2 h-4 w-4" />
            Share track
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => { setShowDetailsDialog(true); setIsOpen(false); }}>
            <Info className="mr-2 h-4 w-4" />
            Track details
          </DropdownMenuItem>

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

      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent onClick={(event) => event.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>{track.title}</DialogTitle>
            <DialogDescription>{track.artistName || "Unknown artist"}{track.albumTitle ? ` · ${track.albumTitle}` : ""}</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-3 rounded-2xl bg-muted/45 p-4 text-sm">
            <dt className="text-muted-foreground">Source</dt><dd className="font-medium">{track.source === "youtube" ? "YouTube Music" : track.localKind === "song" ? "Local library" : "Saved library track"}</dd>
            <dt className="text-muted-foreground">Duration</dt><dd className="font-medium">{formatDuration(track.durationSeconds)}</dd>
            <dt className="text-muted-foreground">Playback ID</dt><dd className="truncate font-mono text-xs">{track.id}</dd>
            <dt className="text-muted-foreground">Availability</dt><dd className="font-medium">{track.source === "local" || resolvedDownloaded ? "Downloaded" : "Streaming"}</dd>
            {track.albumTitle && <><dt className="text-muted-foreground">Album</dt><dd className="font-medium">{track.albumTitle}</dd></>}
          </dl>
          <DialogFooter><Button variant="glass" onClick={handleCopyLink}><LinkIcon className="h-4 w-4" />Copy link</Button><Button onClick={() => setShowDetailsDialog(false)}>Done</Button></DialogFooter>
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

function trackShareUrl(track: PlayerTrack) {
  if (track.source === "youtube") return track.rawItem.url || `https://music.youtube.com/watch?v=${track.videoId}`;
  const sourceUrl = track.localKind === "song" ? track.rawSong.source_url : track.rawLibraryTrack.source_url;
  return sourceUrl || window.location.href;
}

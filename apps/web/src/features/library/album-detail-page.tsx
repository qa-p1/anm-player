import { motion } from "framer-motion";
import { Check, Disc, Download, Heart, LoaderCircle, Play, Plus, Shuffle, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { pageTransition } from "@/animations/page-motion";
import { TrackRow } from "@/components/cards/track-row";
import { ArtworkImage } from "@/components/cards/artwork-image";
import { openDownloadQueue } from "@/components/download-queue";
import { BackButton } from "@/components/navigation/back-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { musicKeys, useUnifiedAlbum } from "@/hooks/use-music-queries";
import { queryClient } from "@/lib/query-client";
import { cachedArtworkUrl } from "@/services/api-client";
import {
  addUnifiedAlbumToLibrary,
  cancelUnifiedAlbumDownload,
  downloadUnifiedAlbum,
  removeLibraryTrackDownload,
  removeUnifiedAlbumDownload,
  removeUnifiedAlbumFromLibrary,
  setUnifiedAlbumFavorite,
} from "@/services/music-api";
import { usePlayerStore } from "@/stores/player-store";
import type { LibraryTrack, OnlineMusicItem, UnifiedAlbum, UnifiedAlbumTrack } from "@/types/api";
import type { PlayerTrack } from "@/types/player";
import { libraryTrackToPlayerTrack, onlineItemToPlayerTrack } from "@/types/player";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/utils/format";

type MutationName = "add" | "favorite" | "download" | "cancel" | "remove-download" | "remove-library" | null;

export function AlbumDetailPage() {
  const { albumId = "" } = useParams<{ albumId: string }>();
  const albumQuery = useUnifiedAlbum(albumId, { enabled: Boolean(albumId) });
  const album = albumQuery.data;
  const [mutation, setMutation] = useState<MutationName>(null);
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [showDeleteDownloadDialog, setShowDeleteDownloadDialog] = useState(false);
  const { playAlbum } = usePlayerStore();

  useEffect(() => {
    if (!album?.capabilities.can_cancel_download) return;
    const timer = window.setInterval(() => void albumQuery.refetch(), 2000);
    return () => window.clearInterval(timer);
  }, [album?.capabilities.can_cancel_download, albumId]);

  const artworkUrl = cachedArtworkUrl(album?.artwork_url);
  const playerTracks = useMemo(
    () => album?.tracks.map((track) => unifiedTrackToPlayerTrack(track, album)).filter((track): track is PlayerTrack => Boolean(track)) ?? [],
    [album],
  );

  function commit(next: UnifiedAlbum) {
    queryClient.setQueryData(musicKeys.unifiedAlbum(albumId), next);
    void queryClient.invalidateQueries({ queryKey: musicKeys.downloadsList() });
    void queryClient.invalidateQueries({ queryKey: musicKeys.albums() });
  }

  async function run(name: MutationName, action: () => Promise<UnifiedAlbum>, success?: string) {
    setMutation(name);
    try {
      const next = await action();
      commit(next);
      if (success) toast(success, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Album action failed", "error");
    } finally {
      setMutation(null);
    }
  }

  function handlePlayAll() {
    if (playerTracks.length) playAlbum(playerTracks, 0);
  }

  function handleShuffle() {
    if (!playerTracks.length) return;
    const shuffled = [...playerTracks].sort(() => Math.random() - 0.5);
    playAlbum(shuffled, 0);
  }

  function handleDownload() {
    openDownloadQueue();
    void run("download", () => downloadUnifiedAlbum(albumId), "Album download queued");
  }

  function handleCancelDownload() {
    void run("cancel", () => cancelUnifiedAlbumDownload(albumId), "Album download cancelled and partial files removed");
  }

  function handleDeleteDownload() {
    setShowDeleteDownloadDialog(false);
    void run("remove-download", () => removeUnifiedAlbumDownload(albumId), "Downloaded files removed; album kept in library");
  }

  function handleRemoveLibrary(deleteDownloads: boolean) {
    setShowRemoveDialog(false);
    void run(
      "remove-library",
      () => removeUnifiedAlbumFromLibrary(albumId, deleteDownloads),
      deleteDownloads ? "Album removed from library and files deleted" : "Album removed from library; files kept",
    );
  }

  if (albumQuery.isLoading) return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading...</div>;
  if (!album) return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Album not found</div>;

  const active = album.capabilities.can_cancel_download;
  const downloaded = album.state.download === "downloaded";
  const partial = album.state.download === "partial" || album.state.download === "failed";
  const hasDownloads = album.state.downloaded_track_count > 0;

  return (
    <motion.div {...pageTransition} className="mx-auto max-w-7xl space-y-8 px-3 py-4 sm:px-6 lg:px-8 lg:py-7">
      <BackButton fallback="/library/albums" />
      <section className="flex flex-col gap-5 md:flex-row md:items-end">
        <div className="h-40 w-40 shrink-0 overflow-hidden rounded-2xl bg-white/10 sm:h-48 sm:w-48 sm:rounded-3xl">
          {artworkUrl ? <ArtworkImage src={artworkUrl} alt={album.title} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center"><Disc className="h-20 w-20 text-muted-foreground" /></div>}
        </div>

        <div className="flex-1 space-y-4">
          <div>
            <p className="text-sm font-semibold text-primary">Album</p>
            <h1 className="break-words text-3xl font-black tracking-normal sm:text-5xl lg:text-6xl">{album.title}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground sm:text-base">
            {album.artist.name && <>{album.artist.href ? <Link to={album.artist.href} className="font-semibold hover:text-foreground hover:underline">{album.artist.name}</Link> : <span className="font-semibold">{album.artist.name}</span>}<span>·</span></>}
            <span>{album.year || "Unknown"}</span><span>·</span>
            <span>{album.track_count} {album.track_count === 1 ? "song" : "songs"}</span>
            {album.duration_seconds ? <><span>·</span><span>{formatDuration(album.duration_seconds)}</span></> : null}
          </div>

          <div className="flex flex-wrap gap-3">
            <Button onClick={handlePlayAll} disabled={!album.capabilities.can_play}><Play className="h-4 w-4 fill-current" />Play</Button>
            <Button variant="glass" onClick={handleShuffle} disabled={!album.capabilities.can_shuffle}><Shuffle className="h-4 w-4" />Shuffle</Button>

            {album.capabilities.can_add_to_library && (
              <Button variant="glass" disabled={mutation === "add"} onClick={() => void run("add", () => addUnifiedAlbumToLibrary(albumId), "Album added to library")}>
                {mutation === "add" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {mutation === "add" ? "Adding..." : "Add to library"}
              </Button>
            )}

            {album.state.in_library && (
              <Button variant="glass" className="border-emerald-400/40 bg-emerald-500/15 text-emerald-300" onClick={() => setShowRemoveDialog(true)}>
                <Check className="h-4 w-4" />In library
              </Button>
            )}

            {active ? (
              <>
                <Button variant="glass" onClick={openDownloadQueue}><LoaderCircle className="h-4 w-4 animate-spin" />Downloading {album.state.download_progress ?? 0}%</Button>
                <Button variant="glass" className="text-red-400" disabled={mutation === "cancel"} onClick={handleCancelDownload}>{mutation === "cancel" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}Cancel</Button>
              </>
            ) : downloaded ? (
              <Button variant="glass" className="border-emerald-400/40 bg-emerald-500/20 text-emerald-300" onClick={() => setShowDeleteDownloadDialog(true)}><Check className="h-4 w-4" />Downloaded</Button>
            ) : (
              <>
                {album.capabilities.can_download && <Button variant="glass" disabled={mutation === "download"} onClick={handleDownload}>{mutation === "download" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{partial ? "Download remaining" : "Download album"}</Button>}
                {hasDownloads && <Button variant="glass" className="text-red-400" onClick={() => setShowDeleteDownloadDialog(true)}><Trash2 className="h-4 w-4" />Remove downloads</Button>}
              </>
            )}

            {album.capabilities.can_favorite && (
              <Button variant="glass" disabled={mutation === "favorite"} onClick={() => void run("favorite", () => setUnifiedAlbumFavorite(albumId, !album.state.is_favorited))}>
                <Heart className={cn("h-4 w-4", album.state.is_favorited && "fill-current text-primary")} />
                {album.state.is_favorited ? "Favorited" : "Favorite"}
              </Button>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-2">
        {album.tracks.map((track, index) => {
          const playerTrack = unifiedTrackToPlayerTrack(track, album);
          if (!playerTrack) return <UnavailableTrackRow key={track.id} track={track} index={index} />;
          return (
            <TrackRow
              key={track.id}
              track={playerTrack}
              context={playerTracks}
              showArtwork={false}
              leading={<span className="w-7 shrink-0 text-center text-sm text-muted-foreground">{track.track_number ?? index + 1}</span>}
              subtitle={track.artist_name || album.artist.name || "Unknown Artist"}
              status={track.is_downloaded ? "Downloaded" : null}
              isDownloaded={track.is_downloaded}
              onRemoveDownload={track.is_downloaded && track.library_track_id ? async () => {
                await removeLibraryTrackDownload(track.library_track_id!, true);
                await albumQuery.refetch();
              } : undefined}
            />
          );
        })}
      </section>

      <Dialog open={showDeleteDownloadDialog} onOpenChange={setShowDeleteDownloadDialog}>
        <DialogContent><DialogHeader><DialogTitle>Delete downloaded files?</DialogTitle><DialogDescription>The album will remain in your library. Local-only tracks will be unavailable until their files are restored.</DialogDescription></DialogHeader><DialogFooter><Button variant="ghost" onClick={() => setShowDeleteDownloadDialog(false)}>Cancel</Button><Button variant="glass" className="text-red-400" onClick={handleDeleteDownload}>Delete downloaded files</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={showRemoveDialog} onOpenChange={setShowRemoveDialog}>
        <DialogContent><DialogHeader><DialogTitle>Remove from library?</DialogTitle><DialogDescription>{hasDownloads ? "Keep downloaded files for local playback, or delete them while removing the album." : "This removes the album from your library. Its permanent album URL will continue to work."}</DialogDescription></DialogHeader><DialogFooter><Button variant="ghost" onClick={() => setShowRemoveDialog(false)}>Cancel</Button><Button variant="glass" onClick={() => handleRemoveLibrary(false)}>Remove and keep files</Button>{hasDownloads && <Button variant="glass" className="text-red-400" onClick={() => handleRemoveLibrary(true)}>Remove and delete files</Button>}</DialogFooter></DialogContent>
      </Dialog>
    </motion.div>
  );
}

function unifiedTrackToPlayerTrack(track: UnifiedAlbumTrack, album: UnifiedAlbum): PlayerTrack | null {
  if (!track.is_available) return null;
  if (track.playback_source === "downloaded" && track.library_track_id) {
    const raw: LibraryTrack = {
      id: track.library_track_id,
      source: album.source,
      external_id: track.provider_track_id || track.id,
      title: track.title,
      artist_name: track.artist_name,
      artist_external_id: album.artist.id,
      album_id: album.internal.library_album_id,
      album_public_id: album.id,
      album_title: album.title,
      duration_seconds: track.duration_seconds,
      track_number: track.track_number,
      disc_number: track.disc_number,
      position: 0,
      source_url: null,
      artwork_url: album.artwork_url,
      artwork_path: album.artwork_url,
      explicit: track.explicit,
      is_downloaded: true,
      is_favorited: false,
      is_in_library: album.state.in_library,
      created_at: "",
      updated_at: "",
    };
    return libraryTrackToPlayerTrack(raw);
  }
  if (!track.provider_track_id) return null;
  const item: OnlineMusicItem = {
    source: "youtube", kind: "song", id: track.provider_track_id, title: track.title,
    subtitle: track.artist_name, artists: track.artist_name ? [{ id: album.artist.id, name: track.artist_name }] : [],
    album: { id: album.id, name: album.title }, thumbnail: album.artwork_url,
    duration_seconds: track.duration_seconds, explicit: track.explicit, playable: true,
    browse_id: null, playlist_id: null, endpoint: null,
    url: `https://music.youtube.com/watch?v=${track.provider_track_id}`,
  };
  return onlineItemToPlayerTrack(item);
}

function UnavailableTrackRow({ track, index }: { track: UnifiedAlbumTrack; index: number }) {
  return <div className="glass-panel flex min-w-0 items-center gap-3 rounded-2xl p-3 opacity-60"><span className="w-7 text-center text-sm text-muted-foreground">{track.track_number ?? index + 1}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{track.title}</p><p className="text-xs text-muted-foreground">{track.artist_name || "Unknown Artist"} · Files unavailable</p></div><span className="text-xs tabular-nums text-muted-foreground">{formatDuration(track.duration_seconds)}</span></div>;
}

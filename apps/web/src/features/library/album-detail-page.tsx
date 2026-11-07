import { motion } from "framer-motion";
import { Check, Disc, Disc3, Download, FileDown, Heart, Link2, ListPlus, LoaderCircle, MoreHorizontal, Plus, Shuffle, Trash2, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { pageTransition } from "@/animations/page-motion";
import { ArtworkImage } from "@/components/cards/artwork-image";
import { TrackRow } from "@/components/cards/track-row";
import { BigPlayButton, CollectionHero, HeroIconButton, MetaDots, StickyCollectionBar } from "@/components/collection/collection-hero";
import { useScrolledPast } from "@/hooks/use-scrolled-past";
import { DetailSkeleton, StatusChip } from "@/components/collection/collection-parts";
import { PlaybackSourceContext } from "@/components/collection/playback-source-context";
import { openDownloadQueue } from "@/components/download-queue-state";
import { BackButton } from "@/components/navigation/back-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { unifiedAlbumPlayerTracks, unifiedTrackToPlayerTrack } from "@/features/library/collection-playback";
import { copyLink, useCollectionPlayState } from "@/features/library/use-collection-play-state";
import { MoreByArtist } from "@/features/library/more-by-artist";
import { CreatePlaylistDialog } from "@/features/playlists/create-playlist-dialog";
import { useUnifiedAlbum } from "@/hooks/use-music-queries";
import { queryClient } from "@/lib/query-client";
import { cn } from "@/lib/utils";
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
import { invalidateLibrary } from "@/services/music-invalidation";
import { musicKeys } from "@/services/music-keys";
import type { UnifiedAlbum, UnifiedAlbumTrack } from "@/types/api";
import { formatDuration, formatListeningTime, pluralize } from "@/utils/format";
import { exportTracks } from "@/utils/track-collection";

type MutationName = "add" | "favorite" | "download" | "cancel" | "remove-download" | "remove-library" | null;

const ACTIVE_DOWNLOAD_STATES = new Set(["queued", "preparing", "downloading", "processing", "paused"]);

export function AlbumDetailPage() {
  const { albumId = "" } = useParams<{ albumId: string }>();
  const navigate = useNavigate();
  const albumQuery = useUnifiedAlbum(albumId, { enabled: Boolean(albumId) });
  const album = albumQuery.data;
  const refetchAlbum = albumQuery.refetch;
  const [mutation, setMutation] = useState<MutationName>(null);
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [showDeleteDownloadDialog, setShowDeleteDownloadDialog] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [aboutExpanded, setAboutExpanded] = useState(false);
  const heroRef = useRef<HTMLElement>(null);
  const scrolledPast = useScrolledPast(heroRef);
  const downloadIsActive = Boolean(album && ACTIVE_DOWNLOAD_STATES.has(album.state.download));

  useEffect(() => {
    if (!downloadIsActive && mutation !== "download") return;
    const timer = window.setInterval(() => void refetchAlbum(), 1000);
    return () => window.clearInterval(timer);
  }, [downloadIsActive, mutation, refetchAlbum]);

  const artworkUrl = cachedArtworkUrl(album?.artwork_url);
  const playerTracks = useMemo(() => (album ? unifiedAlbumPlayerTracks(album) : []), [album]);
  const playState = useCollectionPlayState(playerTracks, { kind: "album", id: albumId });
  const discs = useMemo(() => groupByDisc(album?.tracks ?? []), [album]);

  function commit(next: UnifiedAlbum) {
    queryClient.setQueryData(musicKeys.unifiedAlbum(albumId), next);
    void queryClient.invalidateQueries({ queryKey: musicKeys.downloadsList() });
    void invalidateLibrary(queryClient);
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

  if (albumQuery.isLoading) return <DetailSkeleton />;
  if (!album) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <Disc3 className="h-12 w-12 text-muted-foreground" />
        <p role="alert" className="text-muted-foreground">{albumQuery.error?.message || "Album not found"}</p>
        <div className="flex gap-2">
          <Button variant="glass" onClick={() => navigate("/library/albums")}>Back to albums</Button>
          {albumQuery.error && <Button onClick={() => void albumQuery.refetch()}>Retry</Button>}
        </div>
      </div>
    );
  }

  const active = album.capabilities.can_cancel_download;
  const downloaded = album.state.download === "downloaded";
  const partial = album.state.download === "partial" || album.state.download === "failed";
  const hasDownloads = album.state.downloaded_track_count > 0;
  const progress = Math.max(0, Math.min(100, album.state.download_progress ?? 0));
  const canPlay = album.capabilities.can_play && playerTracks.length > 0;
  const playLabel = playState.isPlaying ? "Pause" : "Play";

  return (
    <PlaybackSourceContext.Provider value={{ kind: "album", id: albumId }}>
    <motion.div {...pageTransition} className="mx-auto max-w-7xl space-y-6 px-3 py-4 sm:px-6 lg:px-8 lg:py-7">
      <BackButton fallback="/library/albums" />
      <CollectionHero
        heroRef={heroRef}
        kind="Album"
        title={album.title}
        artworkUrl={album.artwork_url}
        artwork={artworkUrl ? <ArtworkImage src={artworkUrl} alt={album.title} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center"><Disc className="h-20 w-20 text-muted-foreground" /></div>}
        badges={<>
          {downloaded && <StatusChip tone="success"><Check className="h-3 w-3" />Downloaded</StatusChip>}
          {!downloaded && hasDownloads && !active && <StatusChip>{album.state.downloaded_track_count}/{album.track_count} offline</StatusChip>}
          {album.state.in_library && <StatusChip>In library</StatusChip>}
        </>}
        meta={<MetaDots items={[
          album.artist.name ? (album.artist.href
            ? <Link to={album.artist.href} className="inline-flex items-center gap-1.5 font-semibold text-foreground hover:text-primary hover:underline"><UserRound className="h-3.5 w-3.5" />{album.artist.name}</Link>
            : <span className="font-semibold text-foreground">{album.artist.name}</span>) : null,
          album.year ? String(album.year) : null,
          pluralize(album.track_count, "song"),
          album.duration_seconds ? formatListeningTime(album.duration_seconds) : null,
        ]} />}
      >
        <BigPlayButton label={playLabel} isPlaying={playState.isPlaying} onClick={playState.playOrToggle} disabled={!canPlay} />
        <HeroIconButton label="Shuffle" onClick={playState.shuffle} disabled={!album.capabilities.can_shuffle || playerTracks.length === 0}><Shuffle className="h-5 w-5" /></HeroIconButton>
        {album.capabilities.can_favorite && (
          <HeroIconButton label={album.state.is_favorited ? "Remove album from favorites" : "Add album to favorites"} active={album.state.is_favorited} disabled={mutation === "favorite"} onClick={() => void run("favorite", () => setUnifiedAlbumFavorite(albumId, !album.state.is_favorited), album.state.is_favorited ? "Removed from favorites" : "Added to favorites")}>
            <Heart className={cn("h-5 w-5", album.state.is_favorited && "fill-current")} />
          </HeroIconButton>
        )}
        <HeroIconButton label="Add album to queue" onClick={playState.queueAll} disabled={playerTracks.length === 0}><ListPlus className="h-5 w-5" /></HeroIconButton>

        <div className="mx-1 hidden h-8 w-px bg-white/10 sm:block" />

        {album.capabilities.can_add_to_library && (
          <Button variant="glass" disabled={mutation === "add"} onClick={() => void run("add", () => addUnifiedAlbumToLibrary(albumId), "Album added to library")}>
            {mutation === "add" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {mutation === "add" ? "Adding..." : "Add to library"}
          </Button>
        )}

        {active ? (
          <div className="flex items-center gap-2">
            <button type="button" onClick={openDownloadQueue} className="relative flex h-11 min-w-40 items-center gap-2 overflow-hidden rounded-full border border-white/10 bg-white/[0.06] px-4 text-sm font-semibold">
              <span aria-hidden="true" className="absolute inset-y-0 left-0 bg-primary/20 transition-[width] duration-500" style={{ width: `${progress}%` }} />
              <LoaderCircle className="relative h-4 w-4 animate-spin" /><span className="relative tabular-nums">Downloading {progress}%</span>
            </button>
            <Button variant="glass" className="text-red-400" disabled={mutation === "cancel"} onClick={handleCancelDownload}>{mutation === "cancel" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}Cancel</Button>
          </div>
        ) : !downloaded && album.capabilities.can_download ? (
          <Button variant="glass" disabled={mutation === "download"} onClick={handleDownload}>{mutation === "download" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{partial ? "Download remaining" : "Download"}</Button>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="More album actions" title="More" className="ml-auto grid h-11 w-11 place-items-center rounded-full text-muted-foreground transition hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><MoreHorizontal className="h-5 w-5" /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem disabled={playerTracks.length === 0} onSelect={() => setSaveOpen(true)}><Plus className="mr-2 h-4 w-4" />Save as playlist</DropdownMenuItem>
            <DropdownMenuItem disabled={playerTracks.length === 0} onSelect={() => exportTracks(playerTracks, album.title)}><FileDown className="mr-2 h-4 w-4" />Export as M3U</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void copyLink(new URL(album.canonical_url || window.location.pathname, window.location.href).toString(), "Album link")}><Link2 className="mr-2 h-4 w-4" />Copy album link</DropdownMenuItem>
            {album.artist.href && <DropdownMenuItem onSelect={() => navigate(album.artist.href!)}><UserRound className="mr-2 h-4 w-4" />Go to artist</DropdownMenuItem>}
            {(hasDownloads || album.state.in_library) && <DropdownMenuSeparator />}
            {hasDownloads && !active && <DropdownMenuItem className="text-red-400 focus:text-red-300" onSelect={() => setShowDeleteDownloadDialog(true)}><Trash2 className="mr-2 h-4 w-4" />Remove downloads</DropdownMenuItem>}
            {album.state.in_library && <DropdownMenuItem className="text-red-400 focus:text-red-300" onSelect={() => setShowRemoveDialog(true)}><X className="mr-2 h-4 w-4" />Remove from library</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </CollectionHero>

      <section aria-label="Tracks" className="rounded-[1.6rem] border border-white/[0.06] bg-card/30 p-2 sm:p-3">
        {discs.map(({ disc, tracks }) => (
          <div key={disc ?? "all"} className="pt-1">
            {discs.length > 1 && <p className="flex items-center gap-2 px-3 pb-1 pt-3 text-xs font-bold uppercase tracking-wider text-muted-foreground"><Disc3 className="h-4 w-4" />Disc {disc ?? 1}</p>}
            {tracks.map(({ track, index }) => {
              const playerTrack = unifiedTrackToPlayerTrack(track, album);
              if (!playerTrack) return <UnavailableTrackRow key={track.id} track={track} number={track.track_number ?? index + 1} />;
              return (
                <TrackRow
                  key={track.id}
                  variant="list"
                  track={playerTrack}
                  context={playerTracks}
                  showArtwork={false}
                  number={track.track_number ?? index + 1}
                  explicit={track.explicit}
                  subtitle={track.artist_name || album.artist.name || "Unknown Artist"}
                  status={track.is_downloaded ? "Offline" : null}
                  isDownloaded={track.is_downloaded}
                  onRemoveDownload={track.is_downloaded && track.library_track_id ? async () => {
                    await removeLibraryTrackDownload(track.library_track_id!);
                    await albumQuery.refetch();
                  } : undefined}
                />
              );
            })}
          </div>
        ))}
        {album.tracks.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">No tracks are listed for this album yet.</p>}
      </section>

      {album.description && (
        <section aria-label="About" className="rounded-2xl border border-white/[0.06] bg-card/30 p-5">
          <p className={cn("whitespace-pre-line text-sm leading-6 text-foreground/85", !aboutExpanded && "line-clamp-4")}>{album.description}</p>
          {album.description.length > 280 && <button type="button" onClick={() => setAboutExpanded(!aboutExpanded)} className="mt-2 text-xs font-semibold text-primary hover:underline">{aboutExpanded ? "Show less" : "Read more"}</button>}
        </section>
      )}

      {album.artist.name && album.artist.href && <MoreByArtist artistName={album.artist.name} artistHref={album.artist.href} currentAlbumId={album.id} />}

      <StickyCollectionBar visible={scrolledPast} title={album.title} artworkUrl={artworkUrl} onPlay={playState.playOrToggle} playLabel={playState.isPlaying ? `Pause ${album.title}` : `Play ${album.title}`} isPlaying={playState.isPlaying} disabled={!canPlay} />
      <CreatePlaylistDialog open={saveOpen} onOpenChange={setSaveOpen} tracks={playerTracks} />

      <Dialog open={showDeleteDownloadDialog} onOpenChange={setShowDeleteDownloadDialog}>
        <DialogContent><DialogHeader><DialogTitle>Delete downloaded files?</DialogTitle><DialogDescription>The album will remain in your library. Local-only tracks will be unavailable until their files are restored.</DialogDescription></DialogHeader><DialogFooter><Button variant="ghost" onClick={() => setShowDeleteDownloadDialog(false)}>Cancel</Button><Button variant="glass" className="text-red-400" onClick={handleDeleteDownload}>Delete downloaded files</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={showRemoveDialog} onOpenChange={setShowRemoveDialog}>
        <DialogContent><DialogHeader><DialogTitle>Remove from library?</DialogTitle><DialogDescription>{hasDownloads ? "Keep downloaded files for local playback, or delete them while removing the album." : "This removes the album from your library. Its permanent album URL will continue to work."}</DialogDescription></DialogHeader><DialogFooter><Button variant="ghost" onClick={() => setShowRemoveDialog(false)}>Cancel</Button><Button variant="glass" onClick={() => handleRemoveLibrary(false)}>Remove and keep files</Button>{hasDownloads && <Button variant="glass" className="text-red-400" onClick={() => handleRemoveLibrary(true)}>Remove and delete files</Button>}</DialogFooter></DialogContent>
      </Dialog>
    </motion.div>
    </PlaybackSourceContext.Provider>
  );
}

function groupByDisc(tracks: UnifiedAlbumTrack[]) {
  const groups = new Map<number | null, Array<{ track: UnifiedAlbumTrack; index: number }>>();
  tracks.forEach((track, index) => {
    const disc = track.disc_number ?? null;
    groups.set(disc, [...(groups.get(disc) ?? []), { track, index }]);
  });
  // A single disc (or no disc numbers at all) renders as one flat list.
  if (groups.size <= 1) return [{ disc: null, tracks: tracks.map((track, index) => ({ track, index })) }];
  return [...groups.entries()].sort(([a], [b]) => (a ?? 0) - (b ?? 0)).map(([disc, entries]) => ({ disc, tracks: entries }));
}

function UnavailableTrackRow({ track, number }: { track: UnifiedAlbumTrack; number: number }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl px-2 py-2 opacity-50 sm:px-3">
      <span className="w-7 text-center text-sm tabular-nums text-muted-foreground">{number}</span>
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{track.title}</p><p className="text-xs text-muted-foreground">{track.artist_name || "Unknown Artist"} · Unavailable</p></div>
      <span className="mr-12 text-xs tabular-nums text-muted-foreground">{formatDuration(track.duration_seconds)}</span>
    </div>
  );
}

import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Camera, CheckSquare2, Copy, Eraser, ImageOff, LoaderCircle, FileDown, ListMusic, ListPlus, MoreHorizontal, Pencil, Pin, Play, Plus, Search, Share2, Shuffle, Trash2, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { pageTransition } from "@/animations/page-motion";
import { ArtworkImage } from "@/components/cards/artwork-image";
import { BigPlayButton, CollectionHero, HeroIconButton, MetaDots, StickyCollectionBar } from "@/components/collection/collection-hero";
import { useScrolledPast } from "@/hooks/use-scrolled-past";
import { DetailSkeleton, GeneratedCover, StatusChip } from "@/components/collection/collection-parts";
import { PlaybackSourceContext } from "@/components/collection/playback-source-context";
import { BackButton } from "@/components/navigation/back-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { totalDuration } from "@/features/library/collection-playback";
import { useCollectionPlayState } from "@/features/library/use-collection-play-state";
import { CreatePlaylistDialog } from "@/features/playlists/create-playlist-dialog";
import { itemKey, itemReference, itemToPlayerTrack, playlistItems, withOrderedItems, type PlaylistItem } from "@/features/playlists/playlist-model";
import { PlaylistSuggestions } from "@/features/playlists/playlist-suggestions";
import { PlaylistMosaic, SortablePlaylist } from "@/features/playlists/playlist-track-list";
import { usePlaylist } from "@/hooks/use-music-queries";
import { cn } from "@/lib/utils";
import { cachedArtworkUrl } from "@/services/api-client";
import {
  bulkRemovePlaylistItems,
  clearPlaylistItems,
  deletePlaylist,
  duplicatePlaylist,
  removeLibraryTrackFromPlaylist,
  removePlaylistArtwork,
  setPlaylistArtwork,
  reorderPlaylist,
  updatePlaylist,
} from "@/services/music-api";
import { invalidatePlaylists, invalidatePlaylistSummaries } from "@/services/music-invalidation";
import { musicKeys } from "@/services/music-keys";
import { useLibraryPreferencesStore } from "@/stores/library-preferences-store";
import { usePlayerStore } from "@/stores/player-store";
import type { PlaylistDetail } from "@/types/api";
import type { PlayerTrack } from "@/types/player";
import { formatListeningTime, formatRelativeDate, pluralize } from "@/utils/format";
import { exportTracks, shuffleTracks } from "@/utils/track-collection";

type SortChoice = "custom" | "title" | "artist" | "album" | "duration";
type ConfirmAction = "delete" | "clear" | null;

export function PlaylistDetailPage() {
  const { playlistId } = useParams<{ playlistId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const id = Number(playlistId);
  const { data: playlist, isLoading, error, refetch } = usePlaylist(id);
  function setPlaylist(value: PlaylistDetail) {
    queryClient.setQueryData(musicKeys.playlist(id), value);
    void invalidatePlaylistSummaries(queryClient);
  }
  const [isMutating, setIsMutating] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [confirm, setConfirm] = useState<ConfirmAction>(null);
  const [saveTracks, setSaveTracks] = useState<PlayerTrack[] | null>(null);
  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const scrolledPast = useScrolledPast(heroRef);
  const pinned = useLibraryPreferencesStore((state) => state.pinnedPlaylistIds.includes(id));
  const togglePin = useLibraryPreferencesStore((state) => state.togglePlaylistPin);
  const artworkUrl = cachedArtworkUrl(playlist?.artwork_path);

  const items = useMemo(() => playlistItems(playlist ?? null), [playlist]);
  const context = useMemo(() => items.map(itemToPlayerTrack).filter((track): track is PlayerTrack => Boolean(track)), [items]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleItems = useMemo(() => items.filter((entry) => {
    const track = itemToPlayerTrack(entry);
    return !normalizedQuery || [track?.title, track?.artistName, track?.albumTitle].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
  }), [items, normalizedQuery]);
  const visibleTracks = useMemo(() => visibleItems.map(itemToPlayerTrack).filter((track): track is PlayerTrack => Boolean(track)), [visibleItems]);
  const selectedItems = items.filter((item) => selected.has(itemKey(item)));
  // While searching, the main actions follow what is on screen.
  const actionTracks = normalizedQuery ? visibleTracks : context;
  const playState = useCollectionPlayState(actionTracks, { kind: "playlist", id });
  const allVisibleSelected = visibleItems.length > 0 && visibleItems.every((item) => selected.has(itemKey(item)));
  const heroCover = useMemo(() => <PlaylistMosaic items={items} fallback={<GeneratedCover name={playlist?.name ?? ""} />} />, [items, playlist?.name]);
  const knownLength = totalDuration(context);

  async function handleDelete() {
    if (isMutating || !playlist) return;
    setConfirm(null);
    setIsMutating(true);
    try {
      await deletePlaylist(playlist.id);
      queryClient.removeQueries({ queryKey: musicKeys.playlist(playlist.id) });
      if (pinned) togglePin(playlist.id);
      void invalidatePlaylists(queryClient);
      toast(`Deleted “${playlist.name}”`, "success");
      navigate("/library/playlists");
    } catch (deleteError) {
      toast(deleteError instanceof Error ? deleteError.message : "Could not delete playlist", "error");
    } finally { setIsMutating(false); }
  }

  function openEditor() {
    if (!playlist) return;
    setEditName(playlist.name);
    setEditDescription(playlist.description || "");
    setEditOpen(true);
  }

  async function saveEditor(event?: React.FormEvent) {
    event?.preventDefault();
    if (!playlist || !editName.trim() || isMutating) return;
    setIsMutating(true);
    try {
      const updated = await updatePlaylist(playlist.id, { name: editName.trim(), description: editDescription.trim() || null });
      setPlaylist(updated);
      setEditOpen(false);
      toast("Playlist details updated", "success");
    } catch (updateError) {
      toast(updateError instanceof Error ? updateError.message : "Could not update playlist", "error");
    } finally {
      setIsMutating(false);
    }
  }

  async function handleDuplicate() {
    if (!playlist) return;
    setIsMutating(true);
    try {
      const duplicate = await duplicatePlaylist(playlist.id);
      void invalidatePlaylists(queryClient);
      toast(`Created “${duplicate.name}”`, "success");
      navigate(`/library/playlists/${duplicate.id}`);
    } catch (duplicateError) {
      toast(duplicateError instanceof Error ? duplicateError.message : "Could not duplicate playlist", "error");
    } finally {
      setIsMutating(false);
    }
  }

  async function handleClear() {
    if (!playlist || items.length === 0) return;
    setConfirm(null);
    setIsMutating(true);
    try {
      setPlaylist(await clearPlaylistItems(playlist.id));
      setSelected(new Set());
      toast("Playlist cleared", "success");
    } catch (clearError) {
      toast(clearError instanceof Error ? clearError.message : "Could not clear playlist", "error");
    } finally {
      setIsMutating(false);
    }
  }

  async function handleBulkRemove() {
    if (!playlist || selectedItems.length === 0) return;
    setIsMutating(true);
    try {
      setPlaylist(await bulkRemovePlaylistItems(playlist.id, { items: selectedItems.map(itemReference) }));
      toast(`Removed ${selectedItems.length} ${selectedItems.length === 1 ? "track" : "tracks"}`, "success");
      setSelected(new Set());
    } catch (removeError) {
      toast(removeError instanceof Error ? removeError.message : "Could not remove selected tracks", "error");
    } finally {
      setIsMutating(false);
    }
  }

  function selectedTracks() {
    return selectedItems.map(itemToPlayerTrack).filter((track): track is PlayerTrack => Boolean(track));
  }

  function queueSelected() {
    const tracks = selectedTracks();
    usePlayerStore.getState().addTracksToQueue(tracks);
    toast(`Added ${tracks.length} ${tracks.length === 1 ? "track" : "tracks"} to the queue`, "success");
    setSelected(new Set());
  }

  function playSelected(shuffle = false) {
    const tracks = selectedTracks();
    if (tracks.length) usePlayerStore.getState().playPlaylist(shuffle ? shuffleTracks(tracks) : tracks, 0);
  }

  async function persistOrder(nextItems: PlaylistItem[]) {
    if (!playlist) return;
    const optimistic = withOrderedItems(playlist, nextItems);
    setPlaylist(optimistic);
    setIsMutating(true);
    try {
      setPlaylist(await reorderPlaylist(playlist.id, { items: nextItems.map(itemReference) }));
    } catch (reorderError) {
      setPlaylist(playlist);
      toast(reorderError instanceof Error ? reorderError.message : "Could not save playlist order", "error");
    } finally {
      setIsMutating(false);
    }
  }

  function sortPlaylist(choice: SortChoice) {
    if (choice === "custom") return;
    const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
    const sorted = [...items].sort((left, right) => {
      const a = itemToPlayerTrack(left);
      const b = itemToPlayerTrack(right);
      if (choice === "duration") return (a?.durationSeconds ?? 0) - (b?.durationSeconds ?? 0);
      const field = choice === "title" ? "title" : choice === "artist" ? "artistName" : "albumTitle";
      return collator.compare(a?.[field] || "", b?.[field] || "");
    });
    void persistOrder(sorted);
  }

  async function sharePlaylist() {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: playlist?.name || "ANM Player playlist", url });
      else {
        await navigator.clipboard.writeText(url);
        toast("Playlist link copied", "success");
      }
    } catch (shareError) {
      if (shareError instanceof Error && shareError.name === "AbortError") return;
      toast("Could not share the playlist", "error");
    }
  }

  async function removeOnlineTrack(trackId: number) {
    if (!playlist) return;
    try {
      setPlaylist(await removeLibraryTrackFromPlaylist(playlist.id, trackId));
    } catch (removeError) {
      toast(removeError instanceof Error ? removeError.message : "Could not remove track", "error");
    }
  }

  const hasCustomCover = Boolean(playlist?.artwork_path?.includes("/media/artwork/playlists/"));

  async function uploadCover(file: File | undefined) {
    if (!playlist || !file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast("Choose a JPEG, PNG or WebP image", "error");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast("Cover images must be 10 MB or smaller", "error");
      return;
    }
    setIsUploadingCover(true);
    try {
      setPlaylist(await setPlaylistArtwork(playlist.id, file));
      toast("Cover updated", "success");
    } catch (coverError) {
      toast(coverError instanceof Error ? coverError.message : "Could not update the cover", "error");
    } finally {
      setIsUploadingCover(false);
    }
  }

  async function clearCover() {
    if (!playlist) return;
    setIsUploadingCover(true);
    try {
      setPlaylist(await removePlaylistArtwork(playlist.id));
      toast("Custom cover removed", "success");
    } catch (coverError) {
      toast(coverError instanceof Error ? coverError.message : "Could not remove the cover", "error");
    } finally {
      setIsUploadingCover(false);
    }
  }

  function reloadPlaylist() {
    void refetch();
    void invalidatePlaylistSummaries(queryClient);
  }

  if (isLoading) return <DetailSkeleton />;
  if (!playlist) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <ListMusic className="h-12 w-12 text-muted-foreground" />
        <p role="alert" className="text-muted-foreground">{error?.message || "Playlist not found"}</p>
        <div className="flex gap-2"><Button variant="glass" onClick={() => navigate("/library/playlists")}>Back to playlists</Button>{error && <Button onClick={() => void refetch()}>Retry</Button>}</div>
      </div>
    );
  }

  const playLabel = playState.isPlaying ? "Pause playlist" : "Play all";

  return (
    <PlaybackSourceContext.Provider value={{ kind: "playlist", id }}>
    <motion.div {...pageTransition} className="mx-auto max-w-7xl space-y-6 px-3 py-4 sm:px-6 lg:px-8 lg:py-7">
      <BackButton fallback="/library/playlists" />
      <CollectionHero
        heroRef={heroRef}
        kind="Playlist"
        title={playlist.name}
        artworkUrl={playlist.artwork_path ?? context.find((track) => track.artworkUrl)?.artworkUrl ?? null}
        artwork={<>
          {artworkUrl ? <ArtworkImage src={artworkUrl} alt={playlist.name} className="h-full w-full object-cover" /> : heroCover}
          <button type="button" onClick={() => coverInputRef.current?.click()} disabled={isUploadingCover} aria-label="Change cover" className={cn("absolute inset-0 grid place-items-center bg-black/55 text-white transition focus-visible:opacity-100 focus-visible:outline-none", isUploadingCover ? "opacity-100" : "opacity-0 hover:opacity-100")}>
            <span className="flex flex-col items-center gap-2 text-sm font-semibold">{isUploadingCover ? <LoaderCircle className="h-7 w-7 animate-spin" /> : <Camera className="h-7 w-7" />}{isUploadingCover ? "Uploading…" : "Change cover"}</span>
          </button>
          <input ref={coverInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" tabIndex={-1} aria-hidden="true" onChange={(event) => { void uploadCover(event.target.files?.[0]); event.target.value = ""; }} />
        </>}
        badges={pinned ? <StatusChip><Pin className="h-3 w-3" />Pinned</StatusChip> : null}
        description={playlist.description ? <p className="line-clamp-3 whitespace-pre-line">{playlist.description}</p> : <button type="button" onClick={openEditor} className="text-sm text-muted-foreground/80 hover:text-foreground hover:underline">Add a description</button>}
        meta={<MetaDots items={[
          <span key="count" className="font-semibold text-foreground">{pluralize(playlist.song_count, "song")}</span>,
          playlist.duration_seconds || knownLength ? formatListeningTime(playlist.duration_seconds || knownLength) : null,
          playlist.updated_at ? `Updated ${formatRelativeDate(playlist.updated_at)}` : null,
        ]} />}
      >
        <BigPlayButton label={playLabel} isPlaying={playState.isPlaying} onClick={playState.playOrToggle} disabled={isMutating || actionTracks.length === 0} />
        <HeroIconButton label="Shuffle" onClick={playState.shuffle} disabled={isMutating || actionTracks.length === 0}><Shuffle className="h-5 w-5" /></HeroIconButton>
        <HeroIconButton label="Queue all" onClick={playState.queueAll} disabled={isMutating || actionTracks.length === 0}><ListPlus className="h-5 w-5" /></HeroIconButton>
        <HeroIconButton label={pinned ? "Unpin playlist" : "Pin playlist"} active={pinned} onClick={() => togglePin(playlist.id)}><Pin className={cn("h-5 w-5", pinned && "fill-current")} /></HeroIconButton>
        <HeroIconButton label="Edit details" onClick={openEditor} disabled={isMutating}><Pencil className="h-5 w-5" /></HeroIconButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="More playlist actions" title="More" className="ml-auto grid h-11 w-11 place-items-center rounded-full text-muted-foreground transition hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><MoreHorizontal className="h-5 w-5" /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem disabled={isUploadingCover} onSelect={() => coverInputRef.current?.click()}><Camera className="mr-2 h-4 w-4" />Change cover</DropdownMenuItem>
            {hasCustomCover && <DropdownMenuItem disabled={isUploadingCover} onSelect={() => void clearCover()}><ImageOff className="mr-2 h-4 w-4" />Remove cover</DropdownMenuItem>}
            <DropdownMenuItem disabled={isMutating} onSelect={() => void handleDuplicate()}><Copy className="mr-2 h-4 w-4" />Duplicate</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void sharePlaylist()}><Share2 className="mr-2 h-4 w-4" />Share</DropdownMenuItem>
            <DropdownMenuItem disabled={actionTracks.length === 0} onSelect={() => setSaveTracks(actionTracks)}><Plus className="mr-2 h-4 w-4" />{normalizedQuery ? "Save results as playlist" : "Save as new playlist"}</DropdownMenuItem>
            <DropdownMenuItem disabled={actionTracks.length === 0} onSelect={() => exportTracks(actionTracks, playlist.name)}><FileDown className="mr-2 h-4 w-4" />Export as M3U</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={isMutating || items.length === 0} className="text-red-400 focus:text-red-300" onSelect={() => setConfirm("clear")}><Eraser className="mr-2 h-4 w-4" />Clear all tracks</DropdownMenuItem>
            <DropdownMenuItem disabled={isMutating} className="text-red-400 focus:text-red-300" onSelect={() => setConfirm("delete")}><Trash2 className="mr-2 h-4 w-4" />Delete playlist</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CollectionHero>

      {items.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setQuery(""); }} aria-label="Search this playlist" placeholder="Search this playlist" className="h-10 pl-9 pr-10 text-sm" />
              {query && <button type="button" aria-label="Clear playlist search" onClick={() => setQuery("")} className="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-full hover:bg-white/10"><X className="h-4 w-4" /></button>}
            </div>
            <div className="flex items-center gap-2">
              <select aria-label="Sort playlist" defaultValue="custom" onChange={(event) => { sortPlaylist(event.target.value as SortChoice); event.target.value = "custom"; }} disabled={isMutating} className="h-10 rounded-xl border border-white/10 bg-card px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring">
                  <option value="custom">Custom order</option><option value="title">Title</option><option value="artist">Artist</option><option value="album">Album</option><option value="duration">Duration</option>
                </select>
              <Button variant="glass" size="sm" className="h-10" onClick={() => setSelected(allVisibleSelected ? new Set() : new Set(visibleItems.map(itemKey)))}><CheckSquare2 className="h-4 w-4" />{allVisibleSelected ? "Deselect all" : "Select visible"}</Button>
            </div>
          </div>

          {selectedItems.length > 0 && (
            <div className="sticky top-3 z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-primary/25 bg-background/90 p-2.5 pl-4 shadow-xl backdrop-blur-xl">
              <p className="mr-auto text-sm font-semibold">{selectedItems.length} selected</p>
              <Button size="sm" variant="glass" onClick={() => playSelected()}><Play className="h-4 w-4" />Play</Button>
              <Button size="sm" variant="glass" aria-label="Shuffle selected" onClick={() => playSelected(true)}><Shuffle className="h-4 w-4" /></Button>
              <Button size="sm" variant="glass" onClick={queueSelected}><ListPlus className="h-4 w-4" />Queue</Button>
              <Button size="sm" variant="glass" onClick={() => setSaveTracks(selectedTracks())}><Plus className="h-4 w-4" />New playlist</Button>
              <Button size="sm" variant="glass" className="text-red-400" onClick={handleBulkRemove} disabled={isMutating}><Trash2 className="h-4 w-4" />Remove</Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Clear selection" onClick={() => setSelected(new Set())}><X className="h-4 w-4" /></Button>
            </div>
          )}

          <div className="rounded-[1.6rem] border border-white/[0.06] bg-card/30 p-2 sm:p-3">
            {visibleItems.length > 0 ? (
              <SortablePlaylist
                allItems={items}
                visibleItems={visibleItems}
                context={context}
                playlistId={playlist.id}
                selected={selected}
                disabled={isMutating}
                reorderable={!normalizedQuery}
                onToggleSelected={(key) => setSelected((current) => toggleSet(current, key))}
                onReorder={persistOrder}
                onSongRemoved={reloadPlaylist}
                onTrackRemoved={removeOnlineTrack}
              />
            ) : <div className="p-8 text-center text-muted-foreground">No tracks match “{query.trim()}”.</div>}
          </div>
        </section>
      )}

      {items.length === 0 && (
        <div className="grid place-items-center gap-4 rounded-[1.6rem] border border-dashed border-white/10 p-8 text-center">
          <p className="text-lg font-bold">Let's fill this up</p>
          <div className="flex flex-wrap justify-center gap-2"><Button onClick={() => navigate("/search")}><Search className="h-4 w-4" />Find songs</Button><Button variant="glass" onClick={() => navigate("/library/songs")}>Browse your songs</Button></div>
        </div>
      )}

      <PlaylistSuggestions playlistId={playlist.id} tracks={context} />

      <StickyCollectionBar visible={scrolledPast} title={playlist.name} artworkUrl={artworkUrl ?? context.find((track) => track.artworkUrl)?.artworkUrl ?? null} onPlay={playState.playOrToggle} playLabel={playState.isPlaying ? `Pause ${playlist.name}` : `Play ${playlist.name}`} isPlaying={playState.isPlaying} disabled={actionTracks.length === 0} />
      <CreatePlaylistDialog open={saveTracks !== null} onOpenChange={(open) => { if (!open) setSaveTracks(null); }} tracks={saveTracks ?? []} />

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <form onSubmit={(event) => void saveEditor(event)} className="space-y-4">
            <DialogHeader><DialogTitle>Edit playlist</DialogTitle><DialogDescription>Update the name and description shown throughout your library.</DialogDescription></DialogHeader>
            <div className="space-y-3"><Input maxLength={255} value={editName} onChange={(event) => setEditName(event.target.value)} placeholder="Playlist name" aria-label="Playlist name" /><textarea value={editDescription} onChange={(event) => setEditDescription(event.target.value)} maxLength={2000} rows={5} placeholder="Description (optional)" aria-label="Playlist description" className="w-full resize-y rounded-2xl border border-input bg-card/80 p-4 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary/70 focus:ring-4 focus:ring-primary/15" /></div>
            <DialogFooter><Button type="button" variant="ghost" onClick={() => setEditOpen(false)}>Cancel</Button><Button type="submit" disabled={isMutating || !editName.trim()}>{isMutating ? "Saving…" : "Save changes"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm === "delete" ? "Delete this playlist?" : "Clear every track?"}</DialogTitle>
            <DialogDescription>{confirm === "delete" ? `“${playlist.name}” will be deleted. The songs stay in your library.` : `All ${pluralize(items.length, "track")} will be removed from “${playlist.name}”. The songs stay in your library.`}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant="glass" className="text-red-400" disabled={isMutating} onClick={() => void (confirm === "delete" ? handleDelete() : handleClear())}>{confirm === "delete" ? "Delete playlist" : "Clear playlist"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
    </PlaybackSourceContext.Provider>
  );
}

function toggleSet(values: Set<string>, key: string) {
  const next = new Set(values);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

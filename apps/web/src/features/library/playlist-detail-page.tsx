import { musicKeys } from "@/services/music-keys";
import { usePlaylist } from "@/hooks/use-music-queries";
import { useQueryClient } from "@tanstack/react-query";
import { invalidatePlaylists, invalidatePlaylistSummaries } from "@/services/music-invalidation";
import { CollectionActions } from "@/components/cards/collection-actions";
import { SortablePlaylist, PlaylistMosaic } from "@/features/playlists/playlist-track-list";
import { playlistItems, withOrderedItems, itemToPlayerTrack, itemKey, itemReference, type PlaylistItem } from "@/features/playlists/playlist-model";
import { motion } from "framer-motion";
import {
  CheckSquare2,
  Copy,
  ListMusic,
  ListPlus,
  Pencil,
  Play,
  Search,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState} from "react";
import { useNavigate, useParams } from "react-router";
import { useShallow } from "zustand/react/shallow";

import { pageTransition } from "@/animations/page-motion";
import { ArtworkImage } from "@/components/cards/artwork-image";
import { BackButton } from "@/components/navigation/back-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { cachedArtworkUrl } from "@/services/api-client";
import {
  bulkRemovePlaylistItems,
  clearPlaylistItems,
  deletePlaylist,
  duplicatePlaylist,
  removeLibraryTrackFromPlaylist,
  reorderPlaylist,
  updatePlaylist,
} from "@/services/music-api";
import { usePlayerStore } from "@/stores/player-store";
import type { PlaylistDetail } from "@/types/api";
import type { PlayerTrack } from "@/types/player";
import { formatDuration } from "@/utils/format";

type SortChoice = "custom" | "title" | "artist" | "album" | "duration";

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
  const { playPlaylist, addTracksToQueue } = usePlayerStore(useShallow((state) => ({ playPlaylist: state.playPlaylist, addTracksToQueue: state.addTracksToQueue })));
  const artworkUrl = cachedArtworkUrl(playlist?.artwork_path);

  const items = useMemo(() => playlistItems(playlist ?? null), [playlist]);
  const context = useMemo(() => items.map(itemToPlayerTrack).filter((track): track is PlayerTrack => Boolean(track)), [items]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleItems = useMemo(() => items.filter((entry) => {
    const track = itemToPlayerTrack(entry);
    return !normalizedQuery || [track?.title, track?.artistName, track?.albumTitle].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
  }), [items, normalizedQuery]);
  const selectedItems = items.filter((item) => selected.has(itemKey(item)));

  async function handleDelete() {
    if (isMutating || !playlist || !window.confirm(`Delete playlist “${playlist.name}”? The songs remain in your library.`)) return;
    setIsMutating(true);
    try {
      await deletePlaylist(playlist.id);
      queryClient.removeQueries({ queryKey: musicKeys.playlist(playlist.id) });
      void invalidatePlaylists(queryClient);
      navigate("/library/playlists");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not delete playlist", "error");
    } finally { setIsMutating(false); }
  }

  function openEditor() {
    if (!playlist) return;
    setEditName(playlist.name);
    setEditDescription(playlist.description || "");
    setEditOpen(true);
  }

  async function saveEditor() {
    if (!playlist || !editName.trim()) return;
    setIsMutating(true);
    try {
      const updated = await updatePlaylist(playlist.id, { name: editName.trim(), description: editDescription.trim() || null });
      setPlaylist(updated);
      setEditOpen(false);
      toast("Playlist details updated", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not update playlist", "error");
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
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not duplicate playlist", "error");
    } finally {
      setIsMutating(false);
    }
  }

  async function handleClear() {
    if (!playlist || items.length === 0 || !window.confirm(`Remove all ${items.length} tracks from “${playlist.name}”?`)) return;
    setIsMutating(true);
    try {
      setPlaylist(await clearPlaylistItems(playlist.id));
      setSelected(new Set());
      toast("Playlist cleared", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not clear playlist", "error");
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
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not remove selected tracks", "error");
    } finally {
      setIsMutating(false);
    }
  }

  function queueSelected() {
    const tracks = selectedItems.map(itemToPlayerTrack).filter((track): track is PlayerTrack => Boolean(track));
    addTracksToQueue(tracks);
    toast(`Added ${tracks.length} ${tracks.length === 1 ? "track" : "tracks"} to the queue`, "success");
    setSelected(new Set());
  }

  function playSelected() {
    const tracks = selectedItems.map(itemToPlayerTrack).filter((track): track is PlayerTrack => Boolean(track));
    if (tracks.length) playPlaylist(tracks, 0);
  }

  async function persistOrder(nextItems: PlaylistItem[]) {
    if (!playlist) return;
    const optimistic = withOrderedItems(playlist, nextItems);
    setPlaylist(optimistic);
    setIsMutating(true);
    try {
      setPlaylist(await reorderPlaylist(playlist.id, { items: nextItems.map(itemReference) }));
    } catch (error) {
      setPlaylist(playlist);
      toast(error instanceof Error ? error.message : "Could not save playlist order", "error");
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
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      toast("Could not share the playlist", "error");
    }
  }

  async function removeOnlineTrack(trackId: number) {
    if (!playlist) return;
    try {
      setPlaylist(await removeLibraryTrackFromPlaylist(playlist.id, trackId));
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not remove track", "error");
    }
  }

  function reloadPlaylist() {
    void refetch();
    void invalidatePlaylistSummaries(queryClient);
  }

  if (isLoading) return <div className="flex min-h-screen items-center justify-center"><p className="text-muted-foreground">Loading…</p></div>;
  if (!playlist) return <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4"><p role="alert" className="text-muted-foreground">{error?.message || "Playlist not found"}</p><Button variant="glass" onClick={() => navigate("/library/playlists")}>Back to playlists</Button>{error && <Button onClick={() => void refetch()}>Retry</Button>}</div>;

  return (
    <motion.div {...pageTransition} className="mx-auto max-w-7xl space-y-7 px-3 py-4 sm:px-6 lg:px-8 lg:py-7">
      <BackButton fallback="/library/playlists" />
      <section className="flex flex-col gap-5 md:flex-row md:items-end">
        <div className="h-40 w-40 shrink-0 overflow-hidden rounded-2xl bg-white/10 sm:h-48 sm:w-48 sm:rounded-3xl">
          {artworkUrl ? <ArtworkImage src={artworkUrl} alt={playlist.name} className="h-full w-full object-cover" /> : <PlaylistMosaic items={items} />}
        </div>
        <div className="min-w-0 flex-1 space-y-4">
          <div><p className="text-sm font-semibold text-primary">Playlist</p><h1 className="break-words text-3xl font-black tracking-normal sm:text-5xl lg:text-6xl">{playlist.name}</h1>{playlist.description && <p className="mt-2 max-w-3xl text-muted-foreground">{playlist.description}</p>}</div>
          <p className="text-sm text-muted-foreground sm:text-base">{playlist.song_count} {playlist.song_count === 1 ? "song" : "songs"}{playlist.duration_seconds ? ` · ${formatDuration(playlist.duration_seconds)}` : ""}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="glass" onClick={openEditor} disabled={isMutating}><Pencil className="h-4 w-4" />Edit</Button>
            <Button variant="glass" onClick={handleDuplicate} disabled={isMutating}><Copy className="h-4 w-4" />Duplicate</Button>
            <Button variant="glass" onClick={sharePlaylist}><Share2 className="h-4 w-4" />Share</Button>
            <Button variant="glass" className="text-red-400" onClick={handleDelete} disabled={isMutating}><Trash2 className="h-4 w-4" />Delete</Button>
          </div>
        </div>
      </section>

      <CollectionActions tracks={normalizedQuery ? visibleItems.map(itemToPlayerTrack).filter((track): track is PlayerTrack => Boolean(track)) : context} name={playlist.name} disabled={isMutating} />

      {items.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-card/45 p-3 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search this playlist" placeholder="Search this playlist" className="h-10 pl-9 text-sm" /></div>
            <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">Sort
              <select defaultValue="custom" onChange={(event) => sortPlaylist(event.target.value as SortChoice)} disabled={isMutating} className="h-10 rounded-xl border border-white/10 bg-card px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring">
                <option value="custom">Custom order</option><option value="title">Title</option><option value="artist">Artist</option><option value="album">Album</option><option value="duration">Duration</option>
              </select>
            </label>
            <Button variant="glass" size="sm" onClick={() => setSelected(visibleItems.every((item) => selected.has(itemKey(item))) ? new Set() : new Set(visibleItems.map(itemKey)))}><CheckSquare2 className="h-4 w-4" />{visibleItems.length > 0 && visibleItems.every((item) => selected.has(itemKey(item))) ? "Deselect all" : "Select visible"}</Button>
            <Button variant="glass" size="sm" className="text-red-400" onClick={handleClear} disabled={isMutating}><Trash2 className="h-4 w-4" />Clear</Button>
          </div>

          {selectedItems.length > 0 && (
            <div className="sticky top-3 z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-primary/25 bg-background/90 p-3 shadow-xl backdrop-blur-xl">
              <p className="mr-auto text-sm font-semibold">{selectedItems.length} selected</p>
              <Button size="sm" variant="glass" onClick={playSelected}><Play className="h-4 w-4" />Play</Button>
              <Button size="sm" variant="glass" onClick={queueSelected}><ListPlus className="h-4 w-4" />Queue</Button>
              <Button size="sm" variant="glass" className="text-red-400" onClick={handleBulkRemove} disabled={isMutating}><Trash2 className="h-4 w-4" />Remove</Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Clear selection" onClick={() => setSelected(new Set())}><X className="h-4 w-4" /></Button>
            </div>
          )}

          {visibleItems.length > 0 ? (
            <SortablePlaylist
              allItems={items}
              visibleItems={visibleItems}
              context={context}
              playlistId={playlist.id}
              selected={selected}
              disabled={isMutating}
              onToggleSelected={(key) => setSelected((current) => toggleSet(current, key))}
              onReorder={persistOrder}
              onSongRemoved={reloadPlaylist}
              onTrackRemoved={removeOnlineTrack}
            />
          ) : <div className="glass-panel rounded-3xl p-8 text-center text-muted-foreground">No tracks match “{query.trim()}”.</div>}
        </section>
      )}

      {items.length === 0 && <div className="glass-panel rounded-3xl p-8 text-center"><ListMusic className="mx-auto mb-3 h-10 w-10 text-muted-foreground" /><p className="font-semibold">This playlist is empty</p><p className="mt-2 text-sm text-muted-foreground">Add songs from any track menu, or import a YouTube Music playlist.</p></div>}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit playlist</DialogTitle><DialogDescription>Update the name and description shown throughout your library.</DialogDescription></DialogHeader>
          <div className="space-y-3"><Input maxLength={255} value={editName} onChange={(event) => setEditName(event.target.value)} placeholder="Playlist name" aria-label="Playlist name" /><textarea value={editDescription} onChange={(event) => setEditDescription(event.target.value)} maxLength={2000} rows={5} placeholder="Description (optional)" aria-label="Playlist description" className="w-full resize-y rounded-2xl border border-input bg-card/80 p-4 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary/70 focus:ring-4 focus:ring-primary/15" /></div>
          <DialogFooter><Button variant="ghost" onClick={() => setEditOpen(false)}>Cancel</Button><Button onClick={saveEditor} disabled={isMutating || !editName.trim()}>{isMutating ? "Saving…" : "Save changes"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

function toggleSet(values: Set<string>, key: string) {
  const next = new Set(values);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

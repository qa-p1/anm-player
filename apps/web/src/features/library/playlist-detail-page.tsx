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
import { motion } from "framer-motion";
import {
  CheckSquare2,
  Copy,
  Download,
  GripVertical,
  ListMusic,
  ListPlus,
  Pencil,
  Play,
  Search,
  Share2,
  Shuffle,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router";

import { pageTransition } from "@/animations/page-motion";
import { ArtworkImage } from "@/components/cards/artwork-image";
import { SongCard } from "@/components/cards/song-card";
import { TrackRow } from "@/components/cards/track-row";
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
import { cn } from "@/lib/utils";
import { cachedArtworkUrl, isRequestCancelled } from "@/services/api-client";
import {
  bulkRemovePlaylistItems,
  clearPlaylistItems,
  deletePlaylist,
  duplicatePlaylist,
  getPlaylist,
  getPlaylistExportUrl,
  removeLibraryTrackFromPlaylist,
  reorderPlaylist,
  updatePlaylist,
} from "@/services/music-api";
import { usePlayerStore } from "@/stores/player-store";
import type { PlaylistDetail, PlaylistItemReference } from "@/types/api";
import type { PlayerTrack } from "@/types/player";
import { libraryTrackToPlayerTrack, songToPlayerTrack } from "@/types/player";
import { formatDuration } from "@/utils/format";

type PlaylistItem = NonNullable<PlaylistDetail["items"]>[number];
type SortChoice = "custom" | "title" | "artist" | "album" | "duration";

export function PlaylistDetailPage() {
  const { playlistId } = useParams<{ playlistId: string }>();
  const navigate = useNavigate();
  const [playlist, setPlaylist] = useState<PlaylistDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const { playPlaylist, addToQueue } = usePlayerStore();
  const artworkUrl = cachedArtworkUrl(playlist?.artwork_path);

  useEffect(() => {
    const resolvedPlaylistId = Number(playlistId);
    if (!Number.isSafeInteger(resolvedPlaylistId) || resolvedPlaylistId <= 0) {
      setIsLoading(false);
      return;
    }
    const controller = new AbortController();
    getPlaylist(resolvedPlaylistId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setPlaylist(result);
      })
      .catch((error: unknown) => {
        if (!isRequestCancelled(error)) toast(error instanceof Error ? error.message : "Could not load playlist", "error");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [playlistId]);

  const items = useMemo(() => playlistItems(playlist), [playlist]);
  const context = useMemo(() => items.map(itemToPlayerTrack).filter((track): track is PlayerTrack => Boolean(track)), [items]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleItems = useMemo(() => items.filter((entry) => {
    const track = itemToPlayerTrack(entry);
    return !normalizedQuery || [track?.title, track?.artistName, track?.albumTitle].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
  }), [items, normalizedQuery]);
  const selectedItems = items.filter((item) => selected.has(itemKey(item)));

  function handlePlayAll() {
    if (context.length > 0) playPlaylist(context, 0);
  }

  function handleShuffle() {
    if (context.length === 0) return;
    const shuffled = [...context].sort(() => Math.random() - 0.5);
    playPlaylist(shuffled, 0);
  }

  async function handleDelete() {
    if (!playlist || !window.confirm(`Delete playlist “${playlist.name}”? The songs remain in your library.`)) return;
    try {
      await deletePlaylist(playlist.id);
      navigate("/library/playlists");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not delete playlist", "error");
    }
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
    for (const track of tracks) addToQueue(track);
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
    if (!playlist) return;
    getPlaylist(playlist.id).then(setPlaylist).catch((error: unknown) => {
      if (!isRequestCancelled(error)) toast(error instanceof Error ? error.message : "Could not refresh playlist", "error");
    });
  }

  if (isLoading) return <div className="flex min-h-screen items-center justify-center"><p className="text-muted-foreground">Loading…</p></div>;
  if (!playlist) return <div className="flex min-h-screen items-center justify-center"><p className="text-muted-foreground">Playlist not found</p></div>;

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
            <Button onClick={handlePlayAll} disabled={context.length === 0}><Play className="h-4 w-4 fill-current" />Play</Button>
            <Button variant="glass" onClick={handleShuffle} disabled={context.length === 0}><Shuffle className="h-4 w-4" />Shuffle</Button>
            <Button variant="glass" onClick={openEditor}><Pencil className="h-4 w-4" />Edit</Button>
            <Button variant="glass" onClick={handleDuplicate} disabled={isMutating}><Copy className="h-4 w-4" />Duplicate</Button>
            <Button variant="glass" asChild><a href={getPlaylistExportUrl(playlist.id)} download><Download className="h-4 w-4" />Export M3U</a></Button>
            <Button variant="glass" onClick={sharePlaylist}><Share2 className="h-4 w-4" />Share</Button>
            <Button variant="glass" className="text-red-400" onClick={handleDelete}><Trash2 className="h-4 w-4" />Delete</Button>
          </div>
        </div>
      </section>

      {items.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-card/45 p-3 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this playlist" className="h-10 pl-9 text-sm" /></div>
            <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">Sort
              <select defaultValue="custom" onChange={(event) => sortPlaylist(event.target.value as SortChoice)} disabled={isMutating} className="h-10 rounded-xl border border-white/10 bg-card px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring">
                <option value="custom">Custom order</option><option value="title">Title</option><option value="artist">Artist</option><option value="album">Album</option><option value="duration">Duration</option>
              </select>
            </label>
            <Button variant="glass" size="sm" onClick={() => setSelected(selected.size === items.length ? new Set() : new Set(items.map(itemKey)))}><CheckSquare2 className="h-4 w-4" />{selected.size === items.length ? "Deselect all" : "Select all"}</Button>
            <Button variant="glass" size="sm" className="text-red-400" onClick={handleClear} disabled={isMutating}><Trash2 className="h-4 w-4" />Clear</Button>
          </div>

          {selected.size > 0 && (
            <div className="sticky top-3 z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-primary/25 bg-background/90 p-3 shadow-xl backdrop-blur-xl">
              <p className="mr-auto text-sm font-semibold">{selected.size} selected</p>
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
          <div className="space-y-3"><Input value={editName} onChange={(event) => setEditName(event.target.value)} placeholder="Playlist name" aria-label="Playlist name" /><textarea value={editDescription} onChange={(event) => setEditDescription(event.target.value)} maxLength={2000} rows={5} placeholder="Description (optional)" aria-label="Playlist description" className="w-full resize-y rounded-2xl border border-input bg-card/80 p-4 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary/70 focus:ring-4 focus:ring-primary/15" /></div>
          <DialogFooter><Button variant="ghost" onClick={() => setEditOpen(false)}>Cancel</Button><Button onClick={saveEditor} disabled={isMutating || !editName.trim()}>{isMutating ? "Saving…" : "Save changes"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

function SortablePlaylist({ allItems, visibleItems, context, playlistId, selected, disabled, onToggleSelected, onReorder, onSongRemoved, onTrackRemoved }: {
  allItems: PlaylistItem[];
  visibleItems: PlaylistItem[];
  context: PlayerTrack[];
  playlistId: number;
  selected: Set<string>;
  disabled: boolean;
  onToggleSelected: (key: string) => void;
  onReorder: (items: PlaylistItem[]) => void;
  onSongRemoved: () => void;
  onTrackRemoved: (trackId: number) => Promise<void>;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const activeItem = visibleItems.find((item) => itemKey(item) === activeId) ?? null;

  function dragEnd(event: DragEndEvent) {
    setActiveId(null);
    if (!event.over || event.active.id === event.over.id) return;
    const from = allItems.findIndex((item) => itemKey(item) === event.active.id);
    const to = allItems.findIndex((item) => itemKey(item) === event.over?.id);
    if (from >= 0 && to >= 0) onReorder(arrayMove(allItems, from, to));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={(event: DragStartEvent) => setActiveId(String(event.active.id))} onDragCancel={() => setActiveId(null)} onDragEnd={dragEnd}>
      <SortableContext items={visibleItems.map(itemKey)} strategy={verticalListSortingStrategy}>
        <ol className="space-y-2">{visibleItems.map((item) => <SortablePlaylistRow key={itemKey(item)} item={item} context={context} playlistId={playlistId} selected={selected.has(itemKey(item))} disabled={disabled} onToggleSelected={() => onToggleSelected(itemKey(item))} onSongRemoved={onSongRemoved} onTrackRemoved={onTrackRemoved} />)}</ol>
      </SortableContext>
      <DragOverlay adjustScale={false}>{activeItem ? <PlaylistDragPreview item={activeItem} /> : null}</DragOverlay>
    </DndContext>
  );
}

function SortablePlaylistRow({ item, context, playlistId, selected, disabled, onToggleSelected, onSongRemoved, onTrackRemoved }: { item: PlaylistItem; context: PlayerTrack[]; playlistId: number; selected: boolean; disabled: boolean; onToggleSelected: () => void; onSongRemoved: () => void; onTrackRemoved: (trackId: number) => Promise<void> }) {
  const id = itemKey(item);
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition: transition ?? "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)", opacity: isDragging ? 0.28 : 1 };
  return (
    <li ref={setNodeRef} style={style} className="flex min-w-0 items-center gap-1.5">
      <div className="flex w-9 shrink-0 flex-col items-center gap-1">
        <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} className="grid h-8 w-8 touch-none cursor-grab place-items-center rounded-lg text-muted-foreground hover:bg-white/10 hover:text-foreground active:cursor-grabbing" aria-label={`Drag ${itemTitle(item)} to reorder`}><GripVertical className="h-4 w-4" /></button>
        <input type="checkbox" checked={selected} onChange={onToggleSelected} aria-label={`Select ${itemTitle(item)}`} className="h-4 w-4 rounded border-white/20 accent-primary" />
      </div>
      <div className="min-w-0 flex-1">
        {item.item_type === "song" && item.song ? <SongCard song={item.song} playerContext={context} showAlbum showArtist playlistId={playlistId} onRemoved={onSongRemoved} /> : item.track ? <TrackRow track={libraryTrackToPlayerTrack(item.track)} context={context} leading={<span className="hidden w-7 shrink-0 text-center text-xs tabular-nums text-muted-foreground sm:block">{item.position + 1}</span>} isDownloaded={item.track.is_downloaded} onRemoveFromPlaylist={() => onTrackRemoved(item.track!.id)} /> : null}
      </div>
    </li>
  );
}

function PlaylistDragPreview({ item }: { item: PlaylistItem }) {
  const track = itemToPlayerTrack(item);
  return <div className="flex w-[min(80vw,34rem)] items-center gap-3 rounded-2xl border border-white/20 bg-card/95 p-3 shadow-2xl backdrop-blur-xl"><GripVertical className="h-5 w-5 text-muted-foreground" /><ArtworkImage src={track?.artworkUrl || null} alt="" className="h-12 w-12 rounded-xl object-cover" /><div className="min-w-0"><p className="truncate text-sm font-semibold">{track?.title}</p><p className="truncate text-xs text-muted-foreground">{track?.artistName || "Unknown artist"}</p></div></div>;
}

function PlaylistMosaic({ items }: { items: PlaylistItem[] }) {
  const artwork = items.map(itemToPlayerTrack).map((track) => track?.artworkUrl).filter((url): url is string => Boolean(url)).slice(0, 4);
  if (artwork.length === 0) return <div className="flex h-full w-full items-center justify-center bg-white/10"><ListMusic className="h-20 w-20 text-muted-foreground" /></div>;
  return <div className={cn("grid h-full w-full", artwork.length === 1 ? "grid-cols-1" : "grid-cols-2")}>{artwork.map((url, index) => <ArtworkImage key={`${url}-${index}`} src={url} alt="" className="h-full min-h-0 w-full object-cover" />)}</div>;
}

function playlistItems(playlist: PlaylistDetail | null): PlaylistItem[] {
  if (!playlist) return [];
  if (playlist.items) return [...playlist.items].sort((left, right) => left.position - right.position);
  return [
    ...playlist.songs.map((song, position) => ({ item_type: "song" as const, position, song, track: null })),
    ...(playlist.library_tracks ?? []).map((entry) => ({ item_type: "library_track" as const, position: entry.position, song: null, track: entry.track })),
  ].sort((left, right) => left.position - right.position);
}

function withOrderedItems(playlist: PlaylistDetail, items: PlaylistItem[]): PlaylistDetail {
  return { ...playlist, items: items.map((item, position) => ({ ...item, position })) };
}

function itemToPlayerTrack(item: PlaylistItem): PlayerTrack | null {
  return item.song ? songToPlayerTrack(item.song) : item.track ? libraryTrackToPlayerTrack(item.track) : null;
}

function itemKey(item: PlaylistItem) {
  return item.item_type === "song" && item.song ? `song:${item.song.id}` : item.track ? `library_track:${item.track.id}` : `missing:${item.position}`;
}

function itemReference(item: PlaylistItem): PlaylistItemReference {
  if (item.item_type === "song" && item.song) return { item_type: "song", item_id: item.song.id };
  if (item.track) return { item_type: "library_track", item_id: item.track.id };
  throw new Error("Playlist item is missing its track");
}

function itemTitle(item: PlaylistItem) {
  return item.song?.title || item.track?.title || "playlist track";
}

function toggleSet(values: Set<string>, key: string) {
  const next = new Set(values);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

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
import { GripVertical, ListMusic } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { ArtworkImage } from "@/components/cards/artwork-image";
import { SongCard } from "@/components/cards/song-card";
import { TrackRow } from "@/components/cards/track-row";
import { cn } from "@/lib/utils";
import type { PlayerTrack } from "@/types/player";
import { libraryTrackToPlayerTrack } from "@/types/player";
import { itemKey, itemTitle, itemToPlayerTrack, type PlaylistItem } from "@/features/playlists/playlist-model";

export function SortablePlaylist({ allItems, visibleItems, context, playlistId, selected, disabled, onToggleSelected, onReorder, onSongRemoved, onTrackRemoved, reorderable = true }: {
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
  /** Drag reordering only makes sense on the unfiltered list. */
  reorderable?: boolean;
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
        <ol className="space-y-0.5">{visibleItems.map((item) => <SortablePlaylistRow key={itemKey(item)} item={item} context={context} playlistId={playlistId} selected={selected.has(itemKey(item))} selectionActive={selected.size > 0} disabled={disabled || !reorderable} onToggleSelected={() => onToggleSelected(itemKey(item))} onSongRemoved={onSongRemoved} onTrackRemoved={onTrackRemoved} />)}</ol>
      </SortableContext>
      <DragOverlay adjustScale={false}>{activeItem ? <PlaylistDragPreview item={activeItem} /> : null}</DragOverlay>
    </DndContext>
  );
}

function SortablePlaylistRow({ item, context, playlistId, selected, selectionActive, disabled, onToggleSelected, onSongRemoved, onTrackRemoved }: { item: PlaylistItem; context: PlayerTrack[]; playlistId: number; selected: boolean; selectionActive: boolean; disabled: boolean; onToggleSelected: () => void; onSongRemoved: () => void; onTrackRemoved: (trackId: number) => Promise<void> }) {
  const id = itemKey(item);
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition: transition ?? "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)", opacity: isDragging ? 0.28 : 1 };
  const reveal = "opacity-100 sm:opacity-0 sm:group-hover/row:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100";
  return (
    <li ref={setNodeRef} style={style} className={cn("group/row flex min-w-0 items-center gap-0.5 rounded-xl", selected && "bg-primary/[0.08]")}>
      <div className="flex shrink-0 items-center">
        <label className={cn("grid h-9 w-7 cursor-pointer place-items-center", selected || selectionActive ? "opacity-100" : reveal)}>
          <input type="checkbox" checked={selected} onChange={onToggleSelected} aria-label={`Select ${itemTitle(item)}`} className="h-4 w-4 cursor-pointer rounded border-white/20 accent-primary" />
        </label>
        <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} disabled={disabled} className={cn("hidden h-9 w-6 touch-none cursor-grab place-items-center rounded-lg text-muted-foreground hover:text-foreground active:cursor-grabbing disabled:cursor-default disabled:opacity-30 sm:grid", reveal)} aria-label={`Drag ${itemTitle(item)} to reorder`}><GripVertical className="h-4 w-4" /></button>
      </div>
      <div className="min-w-0 flex-1">
        {item.item_type === "song" && item.song ? <SongCard song={item.song} playerContext={context} showAlbum showArtist playlistId={playlistId} onRemoved={onSongRemoved} variant="list" number={item.position + 1} /> : item.track ? <TrackRow variant="list" number={item.position + 1} track={libraryTrackToPlayerTrack(item.track)} context={context} explicit={item.track.explicit} isDownloaded={item.track.is_downloaded} onRemoveFromPlaylist={() => onTrackRemoved(item.track!.id)} /> : null}
      </div>
    </li>
  );
}

function PlaylistDragPreview({ item }: { item: PlaylistItem }) {
  const track = itemToPlayerTrack(item);
  return <div className="flex w-[min(80vw,34rem)] items-center gap-3 rounded-2xl border border-white/20 bg-card/95 p-3 shadow-2xl backdrop-blur-xl"><GripVertical className="h-5 w-5 text-muted-foreground" /><ArtworkImage src={track?.artworkUrl || null} alt="" className="h-12 w-12 rounded-xl object-cover" /><div className="min-w-0"><p className="truncate text-sm font-semibold">{track?.title}</p><p className="truncate text-xs text-muted-foreground">{track?.artistName || "Unknown artist"}</p></div></div>;
}

export function PlaylistMosaic({ items, fallback }: { items: PlaylistItem[]; fallback?: ReactNode }) {
  // Distinct covers only; 2-3 covers would leave holes in a 2x2 grid, so use one.
  const distinct = [...new Set(items.map(itemToPlayerTrack).map((track) => track?.artworkUrl).filter((url): url is string => Boolean(url)))];
  const artwork = distinct.length >= 4 ? distinct.slice(0, 4) : distinct.slice(0, 1);
  if (artwork.length === 0) return fallback ?? <div className="flex h-full w-full items-center justify-center bg-white/10"><ListMusic className="h-20 w-20 text-muted-foreground" /></div>;
  return <div className={cn("grid h-full w-full", artwork.length === 1 ? "grid-cols-1" : "grid-cols-2")}>{artwork.map((url, index) => <ArtworkImage key={`${url}-${index}`} src={url} alt="" className="h-full min-h-0 w-full object-cover" />)}</div>;
}

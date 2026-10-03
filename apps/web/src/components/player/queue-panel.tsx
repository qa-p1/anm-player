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
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDownToLine,
  ChevronDown,
  CopyX,
  Download,
  GripVertical,
  History,
  ListMusic,
  Play,
  Repeat,
  Repeat1,
  Save,
  Search,
  Shuffle,
  SkipForward,
  Trash2,
  Undo2,
} from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";

import { ArtworkImage } from "@/components/cards/artwork-image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { usePlayerStore, type QueueSnapshot } from "@/stores/player-store";
import type { PlayerTrack } from "@/types/player";
import { formatTime } from "@/utils/format";

type QueueTab = "up-next" | "history" | "saved";

interface QueueEntry {
  id: string;
  song: PlayerTrack;
  queueIndex: number;
}

export function QueuePanel({ onClose }: { onClose: () => void }) {
  const {
    queue,
    queueHistory,
    queueSnapshots,
    lastQueueEdit,
    shuffle,
    repeat,
    toggleShuffle,
    cycleRepeat,
    reorderQueue,
    removeFromQueue,
    clearQueue,
    playQueueIndex,
    moveQueueItemNext,
    moveQueueItemToEnd,
    undoLastQueueEdit,
    deduplicateQueue,
    saveQueueSnapshot,
    loadQueueSnapshot,
    deleteQueueSnapshot,
    replayHistoryItem,
    setIsPlaying,
  } = usePlayerStore(useShallow((state) => ({
    queue: state.queue,
    queueHistory: state.queueHistory,
    queueSnapshots: state.queueSnapshots,
    lastQueueEdit: state.lastQueueEdit,
    shuffle: state.shuffle,
    repeat: state.repeat,
    toggleShuffle: state.toggleShuffle,
    cycleRepeat: state.cycleRepeat,
    reorderQueue: state.reorderQueue,
    removeFromQueue: state.removeFromQueue,
    clearQueue: state.clearQueue,
    playQueueIndex: state.playQueueIndex,
    moveQueueItemNext: state.moveQueueItemNext,
    moveQueueItemToEnd: state.moveQueueItemToEnd,
    undoLastQueueEdit: state.undoLastQueueEdit,
    deduplicateQueue: state.deduplicateQueue,
    saveQueueSnapshot: state.saveQueueSnapshot,
    loadQueueSnapshot: state.loadQueueSnapshot,
    deleteQueueSnapshot: state.deleteQueueSnapshot,
    replayHistoryItem: state.replayHistoryItem,
    setIsPlaying: state.setIsPlaying,
  })));
  const [tab, setTab] = useState<QueueTab>("up-next");
  const [query, setQuery] = useState("");
  const [snapshotName, setSnapshotName] = useState("");
  const RepeatIcon = repeat === "one" ? Repeat1 : Repeat;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredQueue = useMemo(
    () => queue
      .map((song, queueIndex) => ({ song, queueIndex }))
      .filter(({ song }) => !normalizedQuery || [song.title, song.artistName, song.albumTitle].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery))),
    [normalizedQuery, queue],
  );
  const queueSeconds = queue.reduce((total, song) => total + (song.durationSeconds ?? 0), 0);

  function playIndex(index: number) {
    const track = playQueueIndex(index);
    if (track) setIsPlaying(true);
  }

  function replayHistory(index: number) {
    const track = replayHistoryItem(index);
    if (track) setIsPlaying(true);
  }

  function undo() {
    if (undoLastQueueEdit()) toast("Queue restored", "success");
  }

  function removeDuplicates() {
    const before = usePlayerStore.getState().queue.length;
    deduplicateQueue();
    const removed = before - usePlayerStore.getState().queue.length;
    toast(removed ? `Removed ${removed} duplicate ${removed === 1 ? "track" : "tracks"}` : "No duplicates found", removed ? "success" : "info");
  }

  function saveSnapshot() {
    const result = saveQueueSnapshot(snapshotName);
    if (!result) {
      toast("Add something to the queue before saving it", "error");
      return;
    }
    setSnapshotName("");
    setTab("saved");
    toast(`Saved “${result.name}”`, "success");
  }

  function loadSnapshot(snapshot: QueueSnapshot) {
    const first = loadQueueSnapshot(snapshot.id, true);
    if (first) {
      setIsPlaying(true);
      setTab("up-next");
      toast(`Loaded “${snapshot.name}”`, "success");
    }
  }

  return (
    <section className="relative mx-auto flex h-full w-full max-w-3xl flex-col px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-8">
      <header className="mb-3 grid shrink-0 grid-cols-[2.75rem_1fr_2.75rem] items-center">
        <button type="button" aria-label="Return to player" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white"><ChevronDown className="h-6 w-6" /></button>
        <div className="text-center"><h2 className="text-base font-bold">Play queue</h2><p className="text-[0.68rem] text-white/50">{queue.length} upcoming · {formatQueueDuration(queueSeconds)}</p></div>
        <span />
      </header>

      <div className="mb-3 grid shrink-0 grid-cols-3 rounded-2xl bg-black/15 p-1.5">
        <QueueTabButton active={tab === "up-next"} onClick={() => setTab("up-next")} icon={ListMusic} label="Up next" count={queue.length} />
        <QueueTabButton active={tab === "history"} onClick={() => setTab("history")} icon={History} label="Played" count={queueHistory.length} />
        <QueueTabButton active={tab === "saved"} onClick={() => setTab("saved")} icon={Save} label="Saved" count={queueSnapshots.length} />
      </div>

      {tab === "up-next" ? (
        <>
          <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
            <Button variant="glass" size="sm" onClick={toggleShuffle} className={cn("border-white/15 bg-white/10 text-white", shuffle && "bg-white text-black hover:bg-white/90")}><Shuffle className="h-4 w-4" />Shuffle</Button>
            <Button variant="glass" size="sm" onClick={cycleRepeat} className={cn("border-white/15 bg-white/10 text-white", repeat !== "off" && "bg-white text-black hover:bg-white/90")}><RepeatIcon className="h-4 w-4" />{repeat === "one" ? "One" : repeat === "all" ? "All" : "Repeat"}</Button>
            {lastQueueEdit && <Button variant="glass" size="sm" onClick={undo}><Undo2 className="h-4 w-4" />Undo {lastQueueEdit.kind}</Button>}
            {queue.length > 1 && <Button variant="glass" size="sm" onClick={removeDuplicates}><CopyX className="h-4 w-4" />Dedupe</Button>}
            {queue.length > 0 && <Button variant="glass" size="sm" onClick={() => exportTracks(queue, "anm-queue")}><Download className="h-4 w-4" />M3U</Button>}
            {queue.length > 0 && <Button variant="glass" size="sm" className="text-red-300" onClick={clearQueue}><Trash2 className="h-4 w-4" />Clear</Button>}
          </div>
          {queue.length > 0 && (
            <div className="relative mb-3 shrink-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/45" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find in queue" className="h-10 border-white/10 bg-white/8 pl-9 text-sm text-white placeholder:text-white/40" />
            </div>
          )}
          <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto pb-4">
            {queue.length === 0 ? (
              <EmptyQueue icon={ListMusic} title="Your queue is empty" description="Add a track from any song menu, or load a saved queue." />
            ) : filteredQueue.length === 0 ? (
              <EmptyQueue icon={Search} title="Nothing matched" description={`No queued track matches “${query.trim()}”.`} />
            ) : (
              <SortableQueue
                entries={queueEntries(filteredQueue)}
                onMove={reorderQueue}
                onPlay={playIndex}
                onMoveNext={moveQueueItemNext}
                onMoveEnd={moveQueueItemToEnd}
                onRemove={removeFromQueue}
              />
            )}
          </div>
        </>
      ) : tab === "history" ? (
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto pb-4">
          {queueHistory.length === 0 ? <EmptyQueue icon={History} title="No session history yet" description="Tracks played in this queue will collect here." /> : (
            <ul className="space-y-2">
              {[...queueHistory].map((song, index) => ({ song, index })).reverse().map(({ song, index }) => (
                <li key={`${song.id}:${index}`} className="flex items-center gap-3 rounded-2xl bg-white/8 p-3">
                  <button type="button" onClick={() => replayHistory(index)} className="group relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-white/10" aria-label={`Replay ${song.title}`}><ArtworkImage src={song.artworkUrl} alt="" className="h-full w-full object-cover" /><span className="absolute inset-0 grid place-items-center bg-black/45 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100"><Play className="h-4 w-4 fill-current" /></span></button>
                  <button type="button" onClick={() => replayHistory(index)} className="min-w-0 flex-1 text-left"><p className="truncate text-sm font-semibold">{song.title}</p><p className="truncate text-xs text-white/50">{song.artistName || "Unknown artist"}</p></button>
                  <span className="text-xs tabular-nums text-white/40">{formatTime(song.durationSeconds ?? 0)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto pb-4">
          <div className="mb-4 flex gap-2 rounded-2xl bg-white/8 p-3">
            <Input value={snapshotName} onChange={(event) => setSnapshotName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveSnapshot(); }} placeholder="Queue name" className="h-10 border-white/10 bg-black/10 text-sm text-white placeholder:text-white/40" />
            <Button onClick={saveSnapshot} disabled={queue.length === 0}><Save className="h-4 w-4" />Save current</Button>
          </div>
          {queueSnapshots.length === 0 ? <EmptyQueue icon={Save} title="No saved queues" description="Save a listening session and return to it any time on this device." /> : (
            <ul className="space-y-2">
              {queueSnapshots.map((snapshot) => (
                <li key={snapshot.id} className="rounded-2xl bg-white/8 p-3">
                  <div className="flex items-center gap-3"><button type="button" onClick={() => loadSnapshot(snapshot)} className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/10 hover:bg-white/15" aria-label={`Load ${snapshot.name}`}><Play className="h-5 w-5 fill-current" /></button><button type="button" onClick={() => loadSnapshot(snapshot)} className="min-w-0 flex-1 text-left"><p className="truncate text-sm font-semibold">{snapshot.name}</p><p className="text-xs text-white/50">{snapshot.tracks.length} tracks · {formatQueueDuration(snapshot.tracks.reduce((sum, track) => sum + (track.durationSeconds ?? 0), 0))} · {new Date(snapshot.updatedAt).toLocaleDateString()}</p></button><Button variant="ghost" size="icon" className="h-9 w-9 text-white/55 hover:text-white" onClick={() => exportTracks(snapshot.tracks, snapshot.name)} aria-label={`Export ${snapshot.name}`}><Download className="h-4 w-4" /></Button><Button variant="ghost" size="icon" className="h-9 w-9 text-white/55 hover:text-red-300" onClick={() => deleteQueueSnapshot(snapshot.id)} aria-label={`Delete ${snapshot.name}`}><Trash2 className="h-4 w-4" /></Button></div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function queueEntries(items: Array<{ song: PlayerTrack; queueIndex: number }>): QueueEntry[] {
  const occurrences = new Map<string, number>();
  return items.map(({ song, queueIndex }) => {
    const baseId = `${song.source}:${song.id}`;
    const occurrence = occurrences.get(baseId) ?? 0;
    occurrences.set(baseId, occurrence + 1);
    return { id: `${baseId}:${occurrence}:${queueIndex}`, song, queueIndex };
  });
}

function SortableQueue({ entries, onMove, onPlay, onMoveNext, onMoveEnd, onRemove }: {
  entries: QueueEntry[];
  onMove: (fromIndex: number, toIndex: number) => void;
  onPlay: (index: number) => void;
  onMoveNext: (index: number) => void;
  onMoveEnd: (index: number) => void;
  onRemove: (index: number) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const activeEntry = entries.find((entry) => entry.id === activeId) ?? null;

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    if (!event.over || event.active.id === event.over.id) return;
    const from = entries.find((entry) => entry.id === event.active.id);
    const to = entries.find((entry) => entry.id === event.over?.id);
    if (from && to) onMove(from.queueIndex, to.queueIndex);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={(event: DragStartEvent) => setActiveId(String(event.active.id))} onDragCancel={() => setActiveId(null)} onDragEnd={handleDragEnd}>
      <SortableContext items={entries.map((entry) => entry.id)} strategy={verticalListSortingStrategy}>
        <ul className="space-y-2">{entries.map((entry) => <SortableQueueRow key={entry.id} entry={entry} lastQueueIndex={Math.max(...entries.map((item) => item.queueIndex))} onPlay={onPlay} onMoveNext={onMoveNext} onMoveEnd={onMoveEnd} onRemove={onRemove} />)}</ul>
      </SortableContext>
      <DragOverlay adjustScale={false} dropAnimation={{ duration: 240, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }}>{activeEntry ? <QueueDragPreview song={activeEntry.song} /> : null}</DragOverlay>
    </DndContext>
  );
}

function SortableQueueRow({ entry, lastQueueIndex, onPlay, onMoveNext, onMoveEnd, onRemove }: { entry: QueueEntry; lastQueueIndex: number; onPlay: (index: number) => void; onMoveNext: (index: number) => void; onMoveEnd: (index: number) => void; onRemove: (index: number) => void }) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.id });
  const { song, queueIndex } = entry;
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition: transition ?? "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)", opacity: isDragging ? 0.28 : 1 };
  return (
    <li ref={setNodeRef} style={style} className={cn("group flex items-center gap-2 rounded-2xl bg-white/8 p-2.5 backdrop-blur-xl will-change-transform hover:bg-white/12", isDragging && "ring-1 ring-white/20")}>
      <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} aria-label={`Drag ${song.title} to reorder`} className="grid h-10 w-7 shrink-0 touch-none cursor-grab place-items-center rounded-lg text-white/35 transition hover:bg-white/10 hover:text-white/80 active:cursor-grabbing"><GripVertical className="h-5 w-5" /></button>
      <button type="button" onClick={() => onPlay(queueIndex)} className="min-w-0 flex flex-1 items-center gap-3 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
        <div className="group/art relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-white/10"><ArtworkImage src={song.artworkUrl} alt="" className="h-full w-full object-cover" /><span className="absolute inset-0 grid place-items-center bg-black/45 opacity-0 transition group-hover/art:opacity-100"><Play className="h-4 w-4 fill-current" /></span></div>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{song.title}</p><p className="truncate text-xs text-white/50">{song.artistName || "Unknown artist"}</p></div>
        <span className="hidden shrink-0 text-xs tabular-nums text-white/40 sm:block">{formatTime(song.durationSeconds ?? 0)}</span>
      </button>
      <div className="flex shrink-0 items-center">
        {queueIndex > 0 && <QueueAction label={`Move ${song.title} to next`} onClick={() => onMoveNext(queueIndex)}><SkipForward className="h-4 w-4" /></QueueAction>}
        {queueIndex < lastQueueIndex && <QueueAction label={`Move ${song.title} to end`} onClick={() => onMoveEnd(queueIndex)} className="hidden sm:grid"><ArrowDownToLine className="h-4 w-4" /></QueueAction>}
        <QueueAction label={`Remove ${song.title} from queue`} onClick={() => onRemove(queueIndex)} destructive><Trash2 className="h-4 w-4" /></QueueAction>
      </div>
    </li>
  );
}

function QueueAction({ label, onClick, destructive = false, className, children }: { label: string; onClick: () => void; destructive?: boolean; className?: string; children: React.ReactNode }) {
  return <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={onClick} aria-label={label} title={label} className={cn("grid h-8 w-8 place-items-center rounded-lg text-white/45 transition hover:bg-white/10 hover:text-white", destructive && "hover:text-red-300", className)}>{children}</button>;
}

function QueueDragPreview({ song }: { song: PlayerTrack }) {
  return <div className="flex cursor-grabbing items-center gap-3 rounded-2xl border border-white/25 bg-white/20 p-3 shadow-2xl shadow-black/45 backdrop-blur-2xl"><GripVertical className="h-5 w-5 text-white/70" /><ArtworkImage src={song.artworkUrl} alt="" className="h-12 w-12 rounded-lg object-cover" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{song.title}</p><p className="truncate text-xs text-white/55">{song.artistName || "Unknown artist"}</p></div></div>;
}

function QueueTabButton({ active, onClick, icon: Icon, label, count }: { active: boolean; onClick: () => void; icon: typeof ListMusic; label: string; count: number }) {
  return <button type="button" onClick={onClick} className={cn("flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-semibold text-white/50 transition", active && "bg-white text-black")}><Icon className="h-4 w-4" /><span>{label}</span>{count > 0 && <span className={cn("rounded-full px-1.5 py-0.5 text-[0.58rem]", active ? "bg-black/10" : "bg-white/10")}>{count}</span>}</button>;
}

function EmptyQueue({ icon: Icon, title, description }: { icon: typeof ListMusic; title: string; description: string }) {
  return <div className="flex h-full min-h-56 flex-col items-center justify-center p-6 text-center"><Icon className="mb-4 h-10 w-10 text-white/35" /><p className="text-lg font-bold">{title}</p><p className="mt-1 max-w-sm text-sm text-white/50">{description}</p></div>;
}

function exportTracks(tracks: PlayerTrack[], name: string) {
  const lines = ["#EXTM3U"];
  for (const track of tracks) {
    const duration = Math.round(track.durationSeconds ?? -1);
    lines.push(`#EXTINF:${duration},${track.artistName ? `${track.artistName} - ` : ""}${track.title}`);
    lines.push(trackExportUrl(track));
  }
  const blob = new Blob([`${lines.join("\n")}\n`], { type: "audio/x-mpegurl;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFileName(name)}.m3u8`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function trackExportUrl(track: PlayerTrack) {
  if (track.source === "youtube") return track.rawItem.url || `https://music.youtube.com/watch?v=${track.videoId}`;
  if (track.localKind === "song") return track.rawSong.source_url || new URL(`/api/v1/media/songs/${track.songId}/stream`, window.location.href).toString();
  return track.rawLibraryTrack.source_url || new URL(`/api/v1/media/library-tracks/${track.libraryTrackId}/stream`, window.location.href).toString();
}

function safeFileName(name: string) {
  const reserved = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);
  return Array.from(name.trim(), (character) => reserved.has(character) || character.charCodeAt(0) < 32 ? "-" : character).join("").replace(/\s+/g, " ").slice(0, 100) || "anm-queue";
}

function formatQueueDuration(seconds: number) {
  if (!seconds) return "unknown length";
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.ceil((seconds % 3_600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

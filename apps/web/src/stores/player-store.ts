import { create } from "zustand";
import { persist } from "zustand/middleware";

import { createPersistStorage } from "@/lib/persist-storage";
import type { PlayerTrack } from "@/types/player";
import { normalizeStoredPlayerQueue, normalizeStoredPlayerTrack } from "@/types/player";

type RepeatMode = "off" | "all" | "one";
export type PlaybackStatus = "idle" | "loading" | "buffering" | "ready" | "playing" | "paused" | "stalled" | "error";

export interface QueueSnapshot {
  id: string;
  name: string;
  tracks: PlayerTrack[];
  createdAt: number;
  updatedAt: number;
}

interface PendingPlaybackHistoryEvent {
  id: string;
  track: PlayerTrack;
  positionSeconds: number;
  eventType: "skipped";
}

interface QueueUndoPayload {
  queue: PlayerTrack[];
  originalQueue: PlayerTrack[];
  queueHistory: PlayerTrack[];
}

interface PlayerState {
  currentSong: PlayerTrack | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRequestId: number;
  playbackStatus: PlaybackStatus;
  playbackError: string | null;
  bufferedUntil: number;
  retryAttempt: number;
  volume: number;
  isMuted: boolean;

  queue: PlayerTrack[];
  queueHistory: PlayerTrack[];
  originalQueue: PlayerTrack[];
  queueSnapshots: QueueSnapshot[];
  lastQueueEdit: { kind: "remove" | "clear"; trackCount: number } | null;
  _queueUndo: QueueUndoPayload | null;
  pendingHistoryEvents: PendingPlaybackHistoryEvent[];

  shuffle: boolean;
  repeat: RepeatMode;

  setCurrentSong: (song: PlayerTrack | null) => void;
  setIsPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setPlaybackStatus: (status: PlaybackStatus, error?: string | null) => void;
  setBufferedUntil: (time: number) => void;
  retryCurrentSong: () => boolean;
  setVolume: (volume: number) => void;
  toggleMute: () => void;

  setQueue: (songs: PlayerTrack[]) => void;
  addToQueue: (song: PlayerTrack) => void;
  playNext: (song: PlayerTrack) => void;
  removeFromQueue: (index: number) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  setQueueOrder: (songs: PlayerTrack[]) => void;
  clearQueue: () => void;
  moveToHistory: () => void;
  playQueueIndex: (index: number) => PlayerTrack | null;
  moveQueueItemNext: (index: number) => boolean;
  moveQueueItemToEnd: (index: number) => boolean;
  undoLastQueueEdit: () => boolean;
  deduplicateQueue: () => number;
  saveQueueSnapshot: (name: string) => QueueSnapshot | null;
  loadQueueSnapshot: (id: string, autoplay?: boolean) => PlayerTrack | null;
  deleteQueueSnapshot: (id: string) => void;
  replayHistoryItem: (index: number) => PlayerTrack | null;

  toggleShuffle: () => void;
  setRepeat: (mode: RepeatMode) => void;
  cycleRepeat: () => void;

  playNextSong: () => PlayerTrack | null;
  playNextManually: () => PlayerTrack | null;
  playNextAfterError: () => PlayerTrack | null;
  playPreviousSong: () => PlayerTrack | null;

  playSong: (song: PlayerTrack, context?: PlayerTrack[]) => void;
  playAlbum: (songs: PlayerTrack[], startIndex?: number) => void;
  playPlaylist: (songs: PlayerTrack[], startIndex?: number) => void;
  consumePendingHistoryEvent: (id: string) => void;
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => {
      const clearUndo = { lastQueueEdit: null, _queueUndo: null } as const;

      const advance = (honorRepeatOne: boolean, recordSkip: boolean): PlayerTrack | null => {
        const state = get();
        if (honorRepeatOne && state.repeat === "one" && state.currentSong) {
          set({
            currentTime: 0,
            playbackStatus: "loading",
            playbackError: null,
            bufferedUntil: 0,
            retryAttempt: 0,
            playbackRequestId: state.playbackRequestId + 1,
          });
          return state.currentSong;
        }

        const pendingHistoryEvents = recordSkip && state.currentSong && shouldRecordSkip(state.currentTime, state.duration)
          ? [...state.pendingHistoryEvents, createSkippedEvent(state.currentSong, state.currentTime)]
          : state.pendingHistoryEvents;
        const queueHistory = state.currentSong
          ? [...state.queueHistory, state.currentSong].slice(-250)
          : state.queueHistory;

        if (state.queue.length > 0) {
          const [nextSong, ...remainingQueue] = state.queue;
          set({
            queue: remainingQueue,
            queueHistory,
            currentSong: nextSong,
            currentTime: 0,
            duration: 0,
            bufferedUntil: 0,
            playbackStatus: "loading",
            playbackError: null,
            retryAttempt: 0,
            pendingHistoryEvents,
            playbackRequestId: state.playbackRequestId + 1,
            ...clearUndo,
          });
          return nextSong;
        }

        if (state.repeat === "all" && state.originalQueue.length > 0) {
          const replayQueue = state.shuffle ? shuffleTracks(state.originalQueue) : [...state.originalQueue];
          const [nextSong, ...remainingQueue] = replayQueue;
          set({
            queue: remainingQueue,
            currentSong: nextSong,
            currentTime: 0,
            duration: 0,
            bufferedUntil: 0,
            queueHistory: [],
            playbackStatus: "loading",
            playbackError: null,
            retryAttempt: 0,
            pendingHistoryEvents,
            playbackRequestId: state.playbackRequestId + 1,
            ...clearUndo,
          });
          return nextSong;
        }

        set({
          currentSong: null,
          isPlaying: false,
          currentTime: 0,
          duration: 0,
          bufferedUntil: 0,
          playbackStatus: "idle",
          playbackError: null,
          retryAttempt: 0,
          queueHistory,
          pendingHistoryEvents,
          ...clearUndo,
        });
        return null;
      };

      const playContext = (songs: PlayerTrack[], startIndex: number): PlayerTrack | null => {
        if (songs.length === 0) return null;
        const safeIndex = normalizedStartIndex(startIndex, songs.length);
        const currentSong = songs[safeIndex];
        const queue = get().shuffle
          ? shuffleTracks(songs.filter((_, index) => index !== safeIndex))
          : songs.slice(safeIndex + 1);
        set((state) => ({
          currentSong,
          queue,
          originalQueue: songs,
          queueHistory: [],
          currentTime: 0,
          duration: 0,
          bufferedUntil: 0,
          playbackStatus: "loading",
          playbackError: null,
          retryAttempt: 0,
          isPlaying: true,
          playbackRequestId: state.playbackRequestId + 1,
          ...clearUndo,
        }));
        return currentSong;
      };

      return {
        currentSong: null,
        isPlaying: false,
        currentTime: 0,
        duration: 0,
        playbackRequestId: 0,
        playbackStatus: "idle",
        playbackError: null,
        bufferedUntil: 0,
        retryAttempt: 0,
        volume: 0.8,
        isMuted: false,

        queue: [],
        queueHistory: [],
        originalQueue: [],
        queueSnapshots: [],
        lastQueueEdit: null,
        _queueUndo: null,
        pendingHistoryEvents: [],

        shuffle: false,
        repeat: "off",

        setCurrentSong: (currentSong) => set((state) => ({
          currentSong,
          isPlaying: currentSong ? state.isPlaying : false,
          currentTime: 0,
          duration: 0,
          bufferedUntil: 0,
          playbackStatus: currentSong ? "loading" : "idle",
          playbackError: null,
          retryAttempt: 0,
          playbackRequestId: state.playbackRequestId + 1,
        })),
        setIsPlaying: (isPlaying) => set((state) => {
          let playbackStatus = state.playbackStatus;
          if (!state.currentSong) playbackStatus = "idle";
          else if (isPlaying && playbackStatus === "error") playbackStatus = "loading";
          else if (!isPlaying && playbackStatus !== "error") playbackStatus = "paused";
          return { isPlaying, playbackStatus };
        }),
        setCurrentTime: (currentTime) => set({ currentTime: Math.max(0, finiteOr(currentTime, 0)) }),
        setDuration: (duration) => set({ duration: Math.max(0, finiteOr(duration, 0)) }),
        setPlaybackStatus: (playbackStatus, error) => set((state) => ({
          playbackStatus,
          playbackError: playbackStatus === "error" ? error ?? state.playbackError : null,
          ...(playbackStatus === "playing" ? { retryAttempt: 0 } : {}),
        })),
        setBufferedUntil: (bufferedUntil) => set({ bufferedUntil: Math.max(0, finiteOr(bufferedUntil, 0)) }),
        retryCurrentSong: () => {
          const state = get();
          if (!state.currentSong) return false;
          set({
            isPlaying: true,
            playbackStatus: "loading",
            playbackError: null,
            retryAttempt: state.retryAttempt + 1,
            playbackRequestId: state.playbackRequestId + 1,
          });
          return true;
        },
        setVolume: (volume) => {
          const clampedVolume = clamp(volume, 0, 1);
          set({ volume: clampedVolume, isMuted: clampedVolume === 0 });
        },
        toggleMute: () => {
          const state = get();
          set(state.isMuted
            ? { isMuted: false, volume: state.volume > 0 ? state.volume : 0.8 }
            : { isMuted: true });
        },

        setQueue: (songs) => set((state) => ({
          queue: state.shuffle ? shuffleTracks(songs) : songs,
          originalQueue: rebuildOriginalQueue(state.originalQueue, state.queue, songs),
          ...clearUndo,
        })),
        addToQueue: (song) => {
          const state = get();
          const queue = [...state.queue, song];
          set({ queue, originalQueue: rebuildOriginalQueue(state.originalQueue, state.queue, queue), ...clearUndo });
        },
        playNext: (song) => {
          const state = get();
          const queue = [song, ...state.queue];
          set({ queue, originalQueue: rebuildOriginalQueue(state.originalQueue, state.queue, queue), ...clearUndo });
        },
        removeFromQueue: (index) => {
          const state = get();
          if (index < 0 || index >= state.queue.length) return;
          const queue = state.queue.filter((_, queueIndex) => queueIndex !== index);
          set({
            queue,
            originalQueue: rebuildOriginalQueue(state.originalQueue, state.queue, queue),
            lastQueueEdit: { kind: "remove", trackCount: 1 },
            _queueUndo: queueUndoPayload(state),
          });
        },
        reorderQueue: (fromIndex, toIndex) => {
          const state = get();
          if (!validQueueIndex(fromIndex, state.queue) || !validQueueIndex(toIndex, state.queue) || fromIndex === toIndex) return;
          const queue = moveItem(state.queue, fromIndex, toIndex);
          set({ queue, originalQueue: rebuildOriginalQueue(state.originalQueue, state.queue, queue), ...clearUndo });
        },
        setQueueOrder: (queue) => set((state) => ({
          queue,
          originalQueue: rebuildOriginalQueue(state.originalQueue, state.queue, queue),
          ...clearUndo,
        })),
        clearQueue: () => {
          const state = get();
          if (state.queue.length === 0 && state.queueHistory.length === 0) return;
          set({
            queue: [],
            originalQueue: [],
            queueHistory: [],
            lastQueueEdit: { kind: "clear", trackCount: state.queue.length },
            _queueUndo: queueUndoPayload(state),
          });
        },
        moveToHistory: () => {
          const state = get();
          if (state.currentSong) set({ queueHistory: [...state.queueHistory, state.currentSong].slice(-250) });
        },
        playQueueIndex: (index) => {
          const state = get();
          if (!validQueueIndex(index, state.queue)) return null;
          const currentSong = state.queue[index];
          const queue = state.queue.slice(index + 1);
          const pendingHistoryEvents = state.currentSong && shouldRecordSkip(state.currentTime, state.duration)
            ? [...state.pendingHistoryEvents, createSkippedEvent(state.currentSong, state.currentTime)]
            : state.pendingHistoryEvents;
          set({
            currentSong,
            queue,
            originalQueue: rebuildOriginalQueue(state.originalQueue, state.queue, [currentSong, ...queue]),
            queueHistory: state.currentSong ? [...state.queueHistory, state.currentSong].slice(-250) : state.queueHistory,
            currentTime: 0,
            duration: 0,
            bufferedUntil: 0,
            isPlaying: true,
            playbackStatus: "loading",
            playbackError: null,
            retryAttempt: 0,
            pendingHistoryEvents,
            playbackRequestId: state.playbackRequestId + 1,
            ...clearUndo,
          });
          return currentSong;
        },
        moveQueueItemNext: (index) => {
          const state = get();
          if (!validQueueIndex(index, state.queue)) return false;
          const queue = moveItem(state.queue, index, 0);
          set({ queue, originalQueue: rebuildOriginalQueue(state.originalQueue, state.queue, queue), ...clearUndo });
          return true;
        },
        moveQueueItemToEnd: (index) => {
          const state = get();
          if (!validQueueIndex(index, state.queue)) return false;
          const queue = moveItem(state.queue, index, state.queue.length - 1);
          set({ queue, originalQueue: rebuildOriginalQueue(state.originalQueue, state.queue, queue), ...clearUndo });
          return true;
        },
        undoLastQueueEdit: () => {
          const undo = get()._queueUndo;
          if (!undo) return false;
          set({ ...undo, ...clearUndo });
          return true;
        },
        deduplicateQueue: () => {
          const state = get();
          const queue = deduplicateTracks(state.queue, state.currentSong ? new Set([state.currentSong.id]) : new Set());
          const removed = state.queue.length - queue.length;
          if (removed === 0) return 0;
          set({
            queue,
            originalQueue: deduplicateTracks(rebuildOriginalQueue(state.originalQueue, state.queue, queue)),
            ...clearUndo,
          });
          return removed;
        },
        saveQueueSnapshot: (name) => {
          const state = get();
          const tracks = state.currentSong ? [state.currentSong, ...state.queue] : [...state.queue];
          if (tracks.length === 0) return null;
          const now = Date.now();
          const snapshot: QueueSnapshot = {
            id: createId("queue"),
            name: name.trim() || `Queue ${state.queueSnapshots.length + 1}`,
            tracks,
            createdAt: now,
            updatedAt: now,
          };
          set({ queueSnapshots: [...state.queueSnapshots, snapshot] });
          return snapshot;
        },
        loadQueueSnapshot: (id, autoplay = false) => {
          const state = get();
          const snapshot = state.queueSnapshots.find((entry) => entry.id === id);
          if (!snapshot || snapshot.tracks.length === 0) return null;
          const [currentSong, ...queue] = snapshot.tracks;
          set({
            currentSong,
            queue,
            originalQueue: snapshot.tracks,
            queueHistory: [],
            currentTime: 0,
            duration: 0,
            bufferedUntil: 0,
            isPlaying: autoplay,
            playbackStatus: autoplay ? "loading" : "paused",
            playbackError: null,
            retryAttempt: 0,
            playbackRequestId: state.playbackRequestId + 1,
            ...clearUndo,
          });
          return currentSong;
        },
        deleteQueueSnapshot: (id) => set((state) => ({ queueSnapshots: state.queueSnapshots.filter((snapshot) => snapshot.id !== id) })),
        replayHistoryItem: (index) => {
          const state = get();
          if (!validQueueIndex(index, state.queueHistory)) return null;
          const selected = state.queueHistory[index];
          const afterSelected = state.queueHistory.slice(index + 1);
          const queue = [...afterSelected, ...(state.currentSong ? [state.currentSong] : []), ...state.queue];
          set({
            currentSong: selected,
            queue,
            queueHistory: state.queueHistory.slice(0, index),
            currentTime: 0,
            duration: 0,
            bufferedUntil: 0,
            isPlaying: true,
            playbackStatus: "loading",
            playbackError: null,
            retryAttempt: 0,
            playbackRequestId: state.playbackRequestId + 1,
            ...clearUndo,
          });
          return selected;
        },

        toggleShuffle: () => {
          const state = get();
          const shuffle = !state.shuffle;
          set({
            shuffle,
            queue: shuffle ? shuffleTracks(state.queue) : orderRemainingTracks(state.originalQueue, state.queue),
            ...clearUndo,
          });
        },
        setRepeat: (repeat) => set({ repeat }),
        cycleRepeat: () => {
          const modes: RepeatMode[] = ["off", "all", "one"];
          const currentIndex = modes.indexOf(get().repeat);
          set({ repeat: modes[(currentIndex + 1) % modes.length] });
        },

        playNextSong: () => advance(true, false),
        playNextManually: () => advance(false, true),
        playNextAfterError: () => {
          const failedId = get().currentSong?.id;
          if (failedId) {
            set((state) => ({
              queue: state.queue.filter((track) => track.id !== failedId),
              originalQueue: state.originalQueue.filter((track) => track.id !== failedId),
            }));
          }
          return advance(false, true);
        },
        playPreviousSong: () => {
          const state = get();
          if (state.currentTime > 3) {
            set({ currentTime: 0 });
            return state.currentSong;
          }
          if (state.queueHistory.length > 0) {
            const queueHistory = [...state.queueHistory];
            const previousSong = queueHistory.pop();
            if (previousSong) {
              const queue = state.currentSong ? [state.currentSong, ...state.queue] : state.queue;
              set({
                currentSong: previousSong,
                queue,
                queueHistory,
                currentTime: 0,
                duration: 0,
                bufferedUntil: 0,
                isPlaying: true,
                playbackStatus: "loading",
                playbackError: null,
                retryAttempt: 0,
                playbackRequestId: state.playbackRequestId + 1,
                ...clearUndo,
              });
              return previousSong;
            }
          }
          set({ currentTime: 0 });
          return state.currentSong;
        },

        playSong: (song, context) => {
          if (context && context.length > 0) {
            const currentIndex = context.findIndex((entry) => entry.id === song.id);
            // Match playAlbum/playPlaylist: with shuffle on, the whole list
            // (minus the picked track) forms the shuffled cycle.
            const queue = get().shuffle
              ? shuffleTracks(context.filter((_, index) => index !== currentIndex))
              : currentIndex >= 0 ? context.slice(currentIndex + 1) : context;
            set((state) => ({
              currentSong: song,
              queue,
              originalQueue: context,
              queueHistory: [],
              currentTime: 0,
              duration: 0,
              bufferedUntil: 0,
              isPlaying: true,
              playbackStatus: "loading",
              playbackError: null,
              retryAttempt: 0,
              playbackRequestId: state.playbackRequestId + 1,
              ...clearUndo,
            }));
          } else {
            playContext([song], 0);
          }
        },
        playAlbum: (songs, startIndex = 0) => { playContext(songs, startIndex); },
        playPlaylist: (songs, startIndex = 0) => { playContext(songs, startIndex); },
        consumePendingHistoryEvent: (id) => set((state) => ({
          pendingHistoryEvents: state.pendingHistoryEvents.filter((event) => event.id !== id),
        })),
      };
    },
    {
      name: "aura-player-storage",
      // Playback position changes several times per second; coalesce writes.
      storage: createPersistStorage({ writeDelayMs: 1_000 }),
      version: 3,
      migrate: (persistedState) => {
        if (!persistedState || typeof persistedState !== "object") return persistedState;
        const state = persistedState as Record<string, unknown>;
        return {
          ...state,
          currentSong: normalizeStoredPlayerTrack(state.currentSong),
          queue: normalizeStoredPlayerQueue(state.queue),
          originalQueue: normalizeStoredPlayerQueue(state.originalQueue),
          queueHistory: normalizeStoredPlayerQueue(state.queueHistory),
          queueSnapshots: normalizeQueueSnapshots(state.queueSnapshots),
        };
      },
      partialize: (state) => ({
        currentSong: state.currentSong,
        queue: state.queue,
        originalQueue: state.originalQueue,
        queueHistory: state.queueHistory,
        queueSnapshots: state.queueSnapshots,
        volume: state.volume,
        isMuted: state.isMuted,
        shuffle: state.shuffle,
        repeat: state.repeat,
        currentTime: state.currentTime,
      }),
    },
  ),
);

function shuffleTracks(tracks: PlayerTrack[]): PlayerTrack[] {
  const shuffled = [...tracks];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function normalizedStartIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(length - 1, Math.trunc(index)));
}

function rebuildOriginalQueue(original: PlayerTrack[], previousQueue: PlayerTrack[], nextQueue: PlayerTrack[]): PlayerTrack[] {
  const remainingCounts = trackCounts(previousQueue);
  const consumed = original.filter((track) => {
    const count = remainingCounts.get(track.id) ?? 0;
    if (count === 0) return true;
    remainingCounts.set(track.id, count - 1);
    return false;
  });
  return [...consumed, ...nextQueue];
}

function orderRemainingTracks(original: PlayerTrack[], remaining: PlayerTrack[]): PlayerTrack[] {
  const remainingCounts = trackCounts(remaining);
  return original.filter((track) => {
    const count = remainingCounts.get(track.id) ?? 0;
    if (count === 0) return false;
    remainingCounts.set(track.id, count - 1);
    return true;
  });
}

function trackCounts(tracks: PlayerTrack[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const track of tracks) counts.set(track.id, (counts.get(track.id) ?? 0) + 1);
  return counts;
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  const result = [...items];
  const [moved] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, moved);
  return result;
}

function validQueueIndex(index: number, tracks: PlayerTrack[]): boolean {
  return Number.isInteger(index) && index >= 0 && index < tracks.length;
}

function queueUndoPayload(state: Pick<PlayerState, "queue" | "originalQueue" | "queueHistory">): QueueUndoPayload {
  return {
    queue: [...state.queue],
    originalQueue: [...state.originalQueue],
    queueHistory: [...state.queueHistory],
  };
}

function deduplicateTracks(tracks: PlayerTrack[], existing = new Set<string>()): PlayerTrack[] {
  const seen = new Set(existing);
  return tracks.filter((track) => {
    if (seen.has(track.id)) return false;
    seen.add(track.id);
    return true;
  });
}

function shouldRecordSkip(positionSeconds: number, durationSeconds: number): boolean {
  if (durationSeconds <= 0) return true;
  return positionSeconds < durationSeconds * 0.9;
}

function createSkippedEvent(track: PlayerTrack, positionSeconds: number): PendingPlaybackHistoryEvent {
  return {
    id: createId("history"),
    track,
    positionSeconds: Math.max(0, Math.floor(finiteOr(positionSeconds, 0))),
    eventType: "skipped",
  };
}

function normalizeQueueSnapshots(value: unknown): QueueSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const snapshot = candidate as Record<string, unknown>;
    const tracks = normalizeStoredPlayerQueue(snapshot.tracks);
    if (typeof snapshot.id !== "string" || tracks.length === 0) return [];
    const createdAt = typeof snapshot.createdAt === "number" ? snapshot.createdAt : Date.now();
    return [{
      id: snapshot.id,
      name: typeof snapshot.name === "string" && snapshot.name.trim() ? snapshot.name : "Saved queue",
      tracks,
      createdAt,
      updatedAt: typeof snapshot.updatedAt === "number" ? snapshot.updatedAt : createdAt,
    }];
  });
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function createId(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return `${prefix}:${globalThis.crypto.randomUUID()}`;
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

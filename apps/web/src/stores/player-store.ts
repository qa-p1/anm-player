import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { PlayerTrack } from "@/types/player";
import { normalizeStoredPlayerQueue, normalizeStoredPlayerTrack } from "@/types/player";

export type RepeatMode = "off" | "all" | "one";

interface PlayerState {
  // Current playback
  currentSong: PlayerTrack | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRequestId: number;
  volume: number;
  isMuted: boolean;

  // Queue
  queue: PlayerTrack[];
  queueHistory: PlayerTrack[];
  originalQueue: PlayerTrack[];

  // Playback modes
  shuffle: boolean;
  repeat: RepeatMode;

  // Actions - Playback control
  setCurrentSong: (song: PlayerTrack | null) => void;
  setIsPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;

  // Actions - Queue management
  setQueue: (songs: PlayerTrack[]) => void;
  addToQueue: (song: PlayerTrack) => void;
  playNext: (song: PlayerTrack) => void;
  removeFromQueue: (index: number) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  setQueueOrder: (songs: PlayerTrack[]) => void;
  clearQueue: () => void;
  moveToHistory: () => void;

  // Actions - Playback modes
  toggleShuffle: () => void;
  setRepeat: (mode: RepeatMode) => void;
  cycleRepeat: () => void;

  // Actions - Navigation
  playNextSong: () => PlayerTrack | null;
  playPreviousSong: () => PlayerTrack | null;

  // Actions - Play from context
  playSong: (song: PlayerTrack, context?: PlayerTrack[]) => void;
  playAlbum: (songs: PlayerTrack[], startIndex?: number) => void;
  playPlaylist: (songs: PlayerTrack[], startIndex?: number) => void;
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      // Initial state
      currentSong: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      playbackRequestId: 0,
      volume: 0.8,
      isMuted: false,

      queue: [],
      queueHistory: [],
      originalQueue: [],

      shuffle: false,
      repeat: "off",

      // Playback control
      setCurrentSong: (song) => set((state) => ({ currentSong: song, playbackRequestId: state.playbackRequestId + 1 })),
      
      setIsPlaying: (playing) => set({ isPlaying: playing }),
      
      setCurrentTime: (time) => set({ currentTime: time }),
      
      setDuration: (duration) => set({ duration }),
      
      setVolume: (volume) => {
        const clampedVolume = Math.max(0, Math.min(1, volume));
        set({ volume: clampedVolume, isMuted: clampedVolume === 0 });
      },
      
      toggleMute: () => {
        const state = get();
        if (state.isMuted) {
          set({ isMuted: false, volume: state.volume > 0 ? state.volume : 0.8 });
        } else {
          set({ isMuted: true });
        }
      },

      // Queue management
      setQueue: (songs) => {
        set({ queue: songs, originalQueue: songs });
      },

      addToQueue: (song) => {
        const state = get();
        set({ queue: [...state.queue, song] });
      },

      playNext: (song) => {
        const state = get();
        set({ queue: [song, ...state.queue] });
      },

      removeFromQueue: (index) => {
        const state = get();
        const newQueue = state.queue.filter((_, i) => i !== index);
        set({ queue: newQueue });
      },

      reorderQueue: (fromIndex, toIndex) => {
        const state = get();
        if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= state.queue.length || toIndex >= state.queue.length) return;
        const queue = [...state.queue];
        const [moved] = queue.splice(fromIndex, 1);
        queue.splice(toIndex, 0, moved);
        set({ queue });
      },

      setQueueOrder: (queue) => set({ queue }),

      clearQueue: () => {
        set({ queue: [], queueHistory: [] });
      },

      moveToHistory: () => {
        const state = get();
        if (state.currentSong) {
          set({ queueHistory: [...state.queueHistory, state.currentSong] });
        }
      },

      // Playback modes
      toggleShuffle: () => {
        const state = get();
        const newShuffle = !state.shuffle;
        
        if (newShuffle) {
          set({ shuffle: true, queue: shuffleTracks(state.queue) });
        } else {
          const currentIndex = state.currentSong
            ? state.originalQueue.findIndex((track) => track.id === state.currentSong?.id)
            : -1;
          const restoredQueue = currentIndex >= 0
            ? state.originalQueue.slice(currentIndex + 1)
            : state.originalQueue;
          set({ shuffle: false, queue: restoredQueue });
        }
      },

      setRepeat: (mode) => set({ repeat: mode }),

      cycleRepeat: () => {
        const state = get();
        const modes: RepeatMode[] = ["off", "all", "one"];
        const currentIndex = modes.indexOf(state.repeat);
        const nextMode = modes[(currentIndex + 1) % modes.length];
        set({ repeat: nextMode });
      },

      // Navigation
      playNextSong: () => {
        const state = get();
        
        // Repeat one - replay current song
        if (state.repeat === "one" && state.currentSong) {
          set({ currentTime: 0 });
          return state.currentSong;
        }

        // Move current to history
        if (state.currentSong) {
          get().moveToHistory();
        }

        // Get next from queue
        if (state.queue.length > 0) {
          const [nextSong, ...remainingQueue] = state.queue;
          set({ queue: remainingQueue, currentSong: nextSong, currentTime: 0, playbackRequestId: state.playbackRequestId + 1 });
          return nextSong;
        }

        // Repeat all - restart from original queue
        if (state.repeat === "all" && state.originalQueue.length > 0) {
          const replayQueue = state.shuffle ? shuffleTracks(state.originalQueue) : [...state.originalQueue];
          const [nextSong, ...remainingQueue] = replayQueue;
          set({ 
            queue: remainingQueue, 
            currentSong: nextSong, 
            currentTime: 0,
            queueHistory: [],
            playbackRequestId: state.playbackRequestId + 1,
          });
          return nextSong;
        }

        // No more songs
        set({ currentSong: null, isPlaying: false, currentTime: 0 });
        return null;
      },

      playPreviousSong: () => {
        const state = get();
        
        // If more than 3 seconds into the song, restart it
        if (state.currentTime > 3) {
          set({ currentTime: 0 });
          return state.currentSong;
        }

        // Get previous from history
        if (state.queueHistory.length > 0) {
          const previousSongs = [...state.queueHistory];
          const previousSong = previousSongs.pop();
          
          if (previousSong) {
            // Put current song back at the start of queue
            const newQueue = state.currentSong 
              ? [state.currentSong, ...state.queue] 
              : state.queue;
            
            set({
              currentSong: previousSong,
              queue: newQueue,
              queueHistory: previousSongs,
              currentTime: 0,
              playbackRequestId: state.playbackRequestId + 1,
            });
            return previousSong;
          }
        }

        // Just restart current song
        set({ currentTime: 0 });
        return state.currentSong;
      },

      // Play from context
      playSong: (song, context) => {
        if (context && context.length > 0) {
          const currentIndex = context.findIndex((s) => s.id === song.id);
          const queueSongs = currentIndex >= 0 
            ? context.slice(currentIndex + 1)
            : context;
          
          set({
            currentSong: song,
            queue: queueSongs,
            originalQueue: context,
            queueHistory: [],
            currentTime: 0,
            isPlaying: true,
            playbackRequestId: get().playbackRequestId + 1,
          });
        } else {
          set({
            currentSong: song,
            queue: [],
            originalQueue: [],
            queueHistory: [],
            currentTime: 0,
            isPlaying: true,
            playbackRequestId: get().playbackRequestId + 1,
          });
        }
      },

      playAlbum: (songs, startIndex = 0) => {
        if (songs.length === 0) return;
        
        const currentSong = songs[startIndex];
        const queueSongs = get().shuffle
          ? shuffleTracks(songs.filter((_, index) => index !== startIndex))
          : songs.slice(startIndex + 1);
        
        set({
          currentSong,
          queue: queueSongs,
          originalQueue: songs,
          queueHistory: [],
          currentTime: 0,
          isPlaying: true,
          playbackRequestId: get().playbackRequestId + 1,
        });
      },

      playPlaylist: (songs, startIndex = 0) => {
        if (songs.length === 0) return;
        
        const currentSong = songs[startIndex];
        const queueSongs = get().shuffle
          ? shuffleTracks(songs.filter((_, index) => index !== startIndex))
          : songs.slice(startIndex + 1);
        
        set({
          currentSong,
          queue: queueSongs,
          originalQueue: songs,
          queueHistory: [],
          currentTime: 0,
          isPlaying: true,
          playbackRequestId: get().playbackRequestId + 1,
        });
      },
    }),
    {
      name: "aura-player-storage",
      version: 2,
      migrate: (persistedState) => {
        if (!persistedState || typeof persistedState !== "object") return persistedState;
        const state = persistedState as Record<string, unknown>;

        return {
          ...state,
          currentSong: normalizeStoredPlayerTrack(state.currentSong),
          queue: normalizeStoredPlayerQueue(state.queue),
          originalQueue: normalizeStoredPlayerQueue(state.originalQueue),
          queueHistory: normalizeStoredPlayerQueue(state.queueHistory),
        };
      },
      partialize: (state) => ({
        currentSong: state.currentSong,
        queue: state.queue,
        originalQueue: state.originalQueue,
        queueHistory: state.queueHistory,
        volume: state.volume,
        shuffle: state.shuffle,
        repeat: state.repeat,
        currentTime: state.currentTime,
      }),
    },
  ),
);

function shuffleTracks(tracks: PlayerTrack[]): PlayerTrack[] {
  const shuffled = [...tracks];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

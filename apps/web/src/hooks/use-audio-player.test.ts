import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlayerTrack } from "@/types/player";

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, () => void>();
  const subscriptions = new Map<string, ReturnType<typeof vi.fn>>();
  const mediaHandlers: Record<string, () => void> = {};
  const subscribe = (name: string) => (callback: () => void) => {
    listeners.set(name, callback);
    const unsubscribe = vi.fn();
    subscriptions.set(name, unsubscribe);
    return unsubscribe;
  };
  return {
    listeners,
    subscriptions,
    mediaHandlers,
    addHistory: vi.fn().mockResolvedValue({}),
    toast: vi.fn(),
    invalidateQueries: vi.fn(),
    audioService: {
      stop: vi.fn(),
      pause: vi.fn(),
      loadSong: vi.fn().mockResolvedValue(undefined),
      restorePosition: vi.fn(),
      play: vi.fn().mockResolvedValue(undefined),
      setVolume: vi.fn(),
      setMuted: vi.fn(),
      getCurrentTime: vi.fn(() => 12),
      getDuration: vi.fn(() => 60),
      updateMediaSessionPosition: vi.fn(),
      updateMediaSessionPlaybackState: vi.fn(),
      getError: vi.fn(() => null),
      seek: vi.fn(),
      onTimeUpdate: subscribe("timeupdate"),
      onLoadedMetadata: subscribe("loadedmetadata"),
      onEnded: subscribe("ended"),
      onPlay: subscribe("play"),
      onPause: subscribe("pause"),
      onError: subscribe("error"),
      setMediaSessionHandlers: vi.fn((handlers: Record<string, () => void>) => Object.assign(mediaHandlers, handlers)),
      clearMediaSessionHandlers: vi.fn(),
    },
  };
});

vi.mock("@/services/audio-service", () => ({ audioService: mocks.audioService }));
vi.mock("@/services/music-api", () => ({ addHistory: mocks.addHistory }));
vi.mock("@/components/ui/toast", () => ({ toast: mocks.toast }));
vi.mock("@/lib/query-client", () => ({ queryClient: { invalidateQueries: mocks.invalidateQueries } }));

import { useAudioPlayer } from "@/hooks/use-audio-player";
import { usePlayerStore } from "@/stores/player-store";

function track(id: string): PlayerTrack {
  return {
    source: "youtube",
    id,
    videoId: id,
    title: id,
    artistName: null,
    albumTitle: null,
    artworkUrl: null,
    durationSeconds: 60,
    rawItem: {
      source: "youtube",
      kind: "song",
      id,
      title: id,
      subtitle: null,
      artists: [],
      album: null,
      thumbnail: null,
      duration_seconds: 60,
      explicit: false,
      playable: true,
      browse_id: null,
      playlist_id: null,
      endpoint: null,
      url: `https://music.youtube.com/watch?v=${id}`,
    },
  };
}

const first = track("first");
const second = track("second");

describe("useAudioPlayer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listeners.clear();
    mocks.subscriptions.clear();
    for (const key of Object.keys(mocks.mediaHandlers)) delete mocks.mediaHandlers[key];
    usePlayerStore.setState({
      currentSong: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      playbackRequestId: 0,
      queue: [],
      queueHistory: [],
      originalQueue: [],
      shuffle: false,
      repeat: "off",
    });
  });

  it("loads current-song changes and records each playback session once", async () => {
    renderHook(() => useAudioPlayer());
    act(() => usePlayerStore.getState().playSong(first));

    await waitFor(() => expect(mocks.audioService.loadSong).toHaveBeenCalledWith(first));
    await waitFor(() => expect(mocks.addHistory).toHaveBeenCalledTimes(1));

    act(() => usePlayerStore.getState().setIsPlaying(false));
    act(() => usePlayerStore.getState().setIsPlaying(true));
    await Promise.resolve();
    expect(mocks.addHistory).toHaveBeenCalledTimes(1);

    act(() => usePlayerStore.getState().setCurrentSong(first));
    await waitFor(() => expect(mocks.addHistory).toHaveBeenCalledTimes(2));
  });

  it("advances automatically and wires Media Session play, pause, and next", () => {
    renderHook(() => useAudioPlayer());
    act(() => usePlayerStore.getState().playAlbum([first, second]));
    act(() => mocks.listeners.get("ended")?.());
    expect(usePlayerStore.getState().currentSong?.id).toBe("second");

    act(() => mocks.mediaHandlers.pause());
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    act(() => mocks.mediaHandlers.play());
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    act(() => mocks.mediaHandlers.nexttrack());
    expect(usePlayerStore.getState().currentSong).toBeNull();
  });

  it("surfaces playback failures and cleans up listeners", async () => {
    mocks.audioService.loadSong.mockRejectedValueOnce(new Error("provider details"));
    const { unmount } = renderHook(() => useAudioPlayer());
    act(() => usePlayerStore.getState().playSong(first));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("ANM Player couldn't play this track.", "error"));
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    unmount();

    for (const unsubscribe of mocks.subscriptions.values()) expect(unsubscribe).toHaveBeenCalled();
    expect(mocks.audioService.clearMediaSessionHandlers).toHaveBeenCalled();
  });
});

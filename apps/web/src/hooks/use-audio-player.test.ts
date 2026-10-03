import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlayerTrack } from "@/types/player";

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const subscriptions = new Map<string, ReturnType<typeof vi.fn>>();
  const mediaHandlers: Record<string, (details?: MediaSessionActionDetails) => void> = {};
  const subscribe = (name: string) => (callback: (...args: unknown[]) => void) => {
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
    getYouTubeRelated: vi.fn().mockResolvedValue({ seed_video_id: "first", items: [] }),
    toast: vi.fn(),
    invalidateQueries: vi.fn(),
    audioService: {
      stop: vi.fn(),
      pause: vi.fn(),
      loadSong: vi.fn().mockResolvedValue(undefined),
      restorePosition: vi.fn(),
      play: vi.fn().mockResolvedValue(undefined),
      reload: vi.fn(),
      setVolume: vi.fn(),
      setMuted: vi.fn(),
      setPlaybackRate: vi.fn(),
      configureAudioProcessing: vi.fn(() => true),
      setOutputDevice: vi.fn().mockResolvedValue(undefined),
      listOutputDevices: vi.fn().mockResolvedValue([]),
      getCapabilities: vi.fn(() => ({ webAudio: false, equalizer: false, stereoBalance: false, outputSelection: false, preservesPitch: true })),
      fadeOut: vi.fn().mockResolvedValue(undefined),
      resetFade: vi.fn(),
      getCurrentTime: vi.fn(() => 12),
      getDuration: vi.fn(() => 60),
      getBufferedUntil: vi.fn(() => 0),
      hasPlaybackData: vi.fn(() => false),
      isPaused: vi.fn(() => false),
      isEnded: vi.fn(() => false),
      updateMediaSessionPosition: vi.fn(),
      updateMediaSessionPlaybackState: vi.fn(),
      getError: vi.fn(() => null),
      seek: vi.fn(),
      onTimeUpdate: subscribe("timeupdate"),
      onLoadedMetadata: subscribe("loadedmetadata"),
      onEnded: subscribe("ended"),
      onPlay: subscribe("play"),
      onPlaying: subscribe("playing"),
      onPause: subscribe("pause"),
      onLoadStart: subscribe("loadstart"),
      onWaiting: subscribe("waiting"),
      onStalled: subscribe("stalled"),
      onCanPlay: subscribe("canplay"),
      onProgress: subscribe("progress"),
      onRateChange: subscribe("ratechange"),
      onError: subscribe("error"),
      setMediaSessionHandlers: vi.fn((handlers: Record<string, (details?: MediaSessionActionDetails) => void>) => Object.assign(mediaHandlers, handlers)),
      clearMediaSessionHandlers: vi.fn(),
    },
  };
});

vi.mock("@/services/audio-service", () => ({ audioService: mocks.audioService }));
vi.mock("@/services/music-api", () => ({ addHistory: mocks.addHistory, getYouTubeRelated: mocks.getYouTubeRelated }));
vi.mock("@/components/ui/toast", () => ({ toast: mocks.toast }));
vi.mock("@/lib/query-client", () => ({ queryClient: { invalidateQueries: mocks.invalidateQueries } }));

import { useAudioPlayer } from "@/hooks/use-audio-player";
import { usePlaybackPreferencesStore } from "@/stores/playback-preferences-store";
import { usePlayerStore } from "@/stores/player-store";

function track(id: string): Extract<PlayerTrack, { source: "youtube" }> {
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
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listeners.clear();
    mocks.subscriptions.clear();
    for (const key of Object.keys(mocks.mediaHandlers)) delete mocks.mediaHandlers[key];
    mocks.audioService.loadSong.mockReset().mockResolvedValue(undefined);
    mocks.audioService.play.mockReset().mockResolvedValue(undefined);
    mocks.audioService.isPaused.mockReturnValue(false);
    mocks.audioService.hasPlaybackData.mockReturnValue(false);
    mocks.audioService.getCurrentTime.mockReturnValue(12);
    mocks.audioService.getBufferedUntil.mockReturnValue(0);
    mocks.getYouTubeRelated.mockReset().mockResolvedValue({ seed_video_id: "first", items: [] });
    usePlayerStore.setState({
      currentSong: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      playbackRequestId: 0,
      playbackStatus: "idle",
      playbackError: null,
      bufferedUntil: 0,
      retryAttempt: 0,
      queue: [],
      queueHistory: [],
      originalQueue: [],
      queueSnapshots: [],
      lastQueueEdit: null,
      _queueUndo: null,
      pendingHistoryEvents: [],
      shuffle: false,
      repeat: "off",
    });
    usePlaybackPreferencesStore.setState({
      playbackRate: 1,
      preservesPitch: true,
      seekStepSeconds: 10,
      equalizerEnabled: false,
      equalizerGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      preampDb: 0,
      stereoBalance: 0,
      monoEnabled: false,
      normalizationEnabled: false,
      outputDeviceId: null,
      sleepTimerEndsAt: null,
      sleepTimerEndOfTrack: false,
      stopAfterCurrent: false,
      autoplayEnabled: false,
      skipOnPlaybackError: true,
      abRepeat: { trackId: null, startSeconds: null, endSeconds: null, enabled: false },
      bookmarks: [],
    });
  });

  it("loads current-song changes and records each playback session once", async () => {
    renderHook(() => useAudioPlayer());
    act(() => usePlayerStore.getState().playSong(first));

    await waitFor(() => expect(mocks.audioService.loadSong).toHaveBeenCalledWith(first, { forceReload: false }));
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

  it("retries once, surfaces the final failure, and cleans up listeners", async () => {
    mocks.audioService.loadSong.mockRejectedValue(new Error("provider details"));
    const { unmount } = renderHook(() => useAudioPlayer());
    act(() => usePlayerStore.getState().playSong(first));

    await waitFor(() => expect(mocks.audioService.loadSong.mock.calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("Playback stopped because the audio could not be loaded.", "error"));
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    unmount();

    for (const unsubscribe of mocks.subscriptions.values()) expect(unsubscribe).toHaveBeenCalled();
    expect(mocks.audioService.clearMediaSessionHandlers).toHaveBeenCalled();
  });

  it("tracks buffering readiness, buffered ranges, and A-B repeat", async () => {
    renderHook(() => useAudioPlayer());
    act(() => usePlayerStore.getState().playSong(first));
    await waitFor(() => expect(mocks.audioService.loadSong).toHaveBeenCalled());

    act(() => mocks.listeners.get("waiting")?.());
    expect(usePlayerStore.getState().playbackStatus).toBe("buffering");
    act(() => mocks.listeners.get("progress")?.(42));
    expect(usePlayerStore.getState().bufferedUntil).toBe(42);
    act(() => mocks.listeners.get("canplay")?.());
    expect(usePlayerStore.getState().playbackStatus).toBe("ready");

    act(() => {
      usePlaybackPreferencesStore.getState().setAbRepeatStart(first.id, 5);
      usePlaybackPreferencesStore.getState().setAbRepeatEnd(first.id, 10);
      mocks.audioService.getCurrentTime.mockReturnValueOnce(10.5);
      mocks.listeners.get("timeupdate")?.();
    });
    expect(mocks.audioService.seek).toHaveBeenCalledWith(5);
  });

  it("uses configurable Media Session seeking, seek-to, stop, and manual skip history", async () => {
    renderHook(() => useAudioPlayer());
    act(() => usePlayerStore.getState().playAlbum([first, second]));
    await waitFor(() => expect(mocks.audioService.loadSong).toHaveBeenCalledWith(first, expect.any(Object)));
    act(() => usePlaybackPreferencesStore.getState().setSeekStepSeconds(15));

    act(() => mocks.mediaHandlers.seekforward({ action: "seekforward" }));
    expect(mocks.audioService.seek).toHaveBeenCalledWith(27);
    act(() => mocks.mediaHandlers.seekto({ action: "seekto", seekTime: 31 }));
    expect(mocks.audioService.seek).toHaveBeenCalledWith(31);

    act(() => {
      usePlayerStore.getState().setDuration(60);
      usePlayerStore.getState().setCurrentTime(12);
      mocks.mediaHandlers.nexttrack({ action: "nexttrack" });
    });
    await waitFor(() => expect(mocks.addHistory).toHaveBeenCalledWith(expect.objectContaining({
      event_type: "skipped",
      position_seconds: 12,
    })));

    act(() => mocks.mediaHandlers.stop({ action: "stop" }));
    expect(mocks.audioService.stop).toHaveBeenCalled();
    expect(usePlayerStore.getState().isPlaying).toBe(false);
  });

  it("extends an empty queue from related tracks when autoplay is enabled", async () => {
    mocks.getYouTubeRelated.mockResolvedValueOnce({
      seed_video_id: "first",
      items: [second.rawItem],
    });
    renderHook(() => useAudioPlayer());
    act(() => {
      usePlaybackPreferencesStore.getState().setAutoplayEnabled(true);
      usePlayerStore.getState().playSong(first);
    });
    await waitFor(() => expect(mocks.audioService.loadSong).toHaveBeenCalled());
    act(() => mocks.listeners.get("ended")?.());
    await waitFor(() => expect(usePlayerStore.getState().currentSong?.id).toBe("youtube:second"));
    expect(mocks.getYouTubeRelated).toHaveBeenCalledWith("first");
  });

  it("does not re-render its host on playback-progress ticks", async () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      useAudioPlayer();
    });
    act(() => usePlayerStore.getState().playSong(first));
    await waitFor(() => expect(mocks.audioService.play).toHaveBeenCalled());
    const settledRenders = renders;

    // The hook is mounted at the application root, so any re-render here
    // re-renders every route below it.
    for (let tick = 1; tick <= 20; tick += 1) {
      act(() => {
        usePlayerStore.getState().setCurrentTime(tick);
        usePlayerStore.getState().setBufferedUntil(tick + 5);
      });
    }
    act(() => usePlayerStore.getState().setDuration(240));

    expect(renders).toBe(settledRenders);
  });

  it("keeps the first play request alive when a source change dispatches a delayed pause", async () => {
    let finishPlaying!: () => void;
    mocks.audioService.play.mockImplementationOnce(() => new Promise<void>((resolve) => { finishPlaying = resolve; }));
    renderHook(() => useAudioPlayer());
    act(() => usePlayerStore.getState().playSong(first));
    await waitFor(() => expect(mocks.audioService.play).toHaveBeenCalledOnce());

    act(() => mocks.listeners.get("pause")?.());
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    await act(async () => finishPlaying());
    // A queued event can also arrive after play() has resolved.
    act(() => mocks.listeners.get("pause")?.());
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    expect(mocks.audioService.play).toHaveBeenCalledOnce();
  });

  it("does not reload a successful retry when playing resets the retry count", async () => {
    mocks.audioService.loadSong.mockRejectedValueOnce(new Error("temporary network failure"));
    renderHook(() => useAudioPlayer());
    act(() => usePlayerStore.getState().playSong(first));
    await waitFor(() => expect(mocks.audioService.play).toHaveBeenCalledOnce());
    expect(usePlayerStore.getState().retryAttempt).toBe(1);

    act(() => mocks.listeners.get("play")?.());
    expect(usePlayerStore.getState().retryAttempt).toBe(1);
    act(() => mocks.listeners.get("playing")?.());
    expect(usePlayerStore.getState()).toMatchObject({ playbackStatus: "playing", retryAttempt: 0 });
    expect(mocks.audioService.loadSong).toHaveBeenCalledTimes(2);
    expect(mocks.audioService.play).toHaveBeenCalledOnce();
  });

  it("does not show stalled for buffered playback or let late events override pause", async () => {
    renderHook(() => useAudioPlayer());
    act(() => usePlayerStore.getState().playSong(first));
    await waitFor(() => expect(mocks.audioService.play).toHaveBeenCalledOnce());
    act(() => mocks.listeners.get("playing")?.());
    mocks.audioService.hasPlaybackData.mockReturnValue(true);
    act(() => mocks.listeners.get("stalled")?.());
    act(() => mocks.listeners.get("canplay")?.());
    expect(usePlayerStore.getState().playbackStatus).toBe("playing");

    act(() => usePlayerStore.getState().setIsPlaying(false));
    act(() => {
      for (const event of ["play", "playing", "stalled", "waiting", "canplay", "loadstart", "loadedmetadata"]) mocks.listeners.get(event)?.();
    });
    expect(usePlayerStore.getState()).toMatchObject({ isPlaying: false, playbackStatus: "paused" });
  });

  it("automatically retries a hung start once and reports failure instead of stalling forever", async () => {
    vi.useFakeTimers();
    usePlaybackPreferencesStore.setState({ skipOnPlaybackError: false });
    mocks.audioService.play.mockImplementation(() => new Promise<void>(() => {}));
    renderHook(() => useAudioPlayer());
    await act(async () => usePlayerStore.getState().playSong(first));
    act(() => mocks.listeners.get("stalled")?.());
    expect(usePlayerStore.getState().playbackStatus).toBe("buffering");

    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(mocks.audioService.loadSong).toHaveBeenLastCalledWith(first, { forceReload: true });
    expect(mocks.audioService.play).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(usePlayerStore.getState()).toMatchObject({ isPlaying: false, playbackStatus: "error" });
    expect(mocks.audioService.loadSong).toHaveBeenCalledTimes(2);
  });

  it("allows slow streams to keep loading while their buffer makes progress", async () => {
    vi.useFakeTimers();
    mocks.audioService.play.mockImplementation(() => new Promise<void>(() => {}));
    renderHook(() => useAudioPlayer());
    await act(async () => usePlayerStore.getState().playSong(first));
    for (let index = 1; index <= 4; index += 1) {
      mocks.audioService.getBufferedUntil.mockReturnValue(index * 5);
      await act(async () => vi.advanceTimersByTimeAsync(20_000));
    }
    expect(mocks.audioService.loadSong).toHaveBeenCalledOnce();
    act(() => usePlayerStore.getState().setIsPlaying(false));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(mocks.audioService.loadSong).toHaveBeenCalledOnce();
  });

  it("discards an old request when another song is selected before loading finishes", async () => {
    let finishLoading!: () => void;
    mocks.audioService.loadSong.mockImplementationOnce(() => new Promise<void>((resolve) => { finishLoading = resolve; }));
    renderHook(() => useAudioPlayer());
    act(() => usePlayerStore.getState().playSong(first));
    act(() => usePlayerStore.getState().playSong(second));
    await waitFor(() => expect(mocks.audioService.play).toHaveBeenCalledOnce());
    await act(async () => finishLoading());
    expect(mocks.audioService.play).toHaveBeenCalledOnce();
    expect(mocks.addHistory).toHaveBeenCalledOnce();
    expect(mocks.addHistory).toHaveBeenCalledWith(expect.objectContaining({ external_id: second.videoId }));
  });
});

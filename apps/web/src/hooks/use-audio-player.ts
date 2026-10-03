import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";

import { toast } from "@/components/ui/toast";
import { queryClient } from "@/lib/query-client";
import { audioService } from "@/services/audio-service";
import { addHistory, getYouTubeRelated } from "@/services/music-api";
import { usePlaybackPreferencesStore } from "@/stores/playback-preferences-store";
import { usePlayerStore } from "@/stores/player-store";
import type { HistoryCreateRequest } from "@/types/api";
import type { PlayerTrack } from "@/types/player";
import { onlineItemToPlayerTrack } from "@/types/player";

export function useAudioPlayer() {
  const isSwitchingSourceRef = useRef(false);
  const playedSessionRef = useRef<string | null>(null);
  const handledFailuresRef = useRef(new Set<string>());
  const defaultDocumentTitleRef = useRef(typeof document === "undefined" ? "ANM Player" : document.title || "ANM Player");
  // This hook runs at the application root. Select only what the effects
  // need: subscribing to the whole store re-rendered every route on each
  // timeupdate, progress, and status event.
  const {
    currentSong,
    isPlaying,
    volume,
    isMuted,
    playbackRequestId,
    pendingHistoryEvents,
    setPlaybackStatus,
  } = usePlayerStore(useShallow((state) => ({
    currentSong: state.currentSong,
    isPlaying: state.isPlaying,
    volume: state.volume,
    isMuted: state.isMuted,
    playbackRequestId: state.playbackRequestId,
    pendingHistoryEvents: state.pendingHistoryEvents,
    setPlaybackStatus: state.setPlaybackStatus,
  })));
  const {
    playbackRate,
    preservesPitch,
    equalizerEnabled,
    equalizerGains,
    preampDb,
    stereoBalance,
    monoEnabled,
    normalizationEnabled,
    outputDeviceId,
    sleepTimerEndsAt,
    sleepFadeSeconds,
  } = usePlaybackPreferencesStore(useShallow((state) => ({
    playbackRate: state.playbackRate,
    preservesPitch: state.preservesPitch,
    equalizerEnabled: state.equalizerEnabled,
    equalizerGains: state.equalizerGains,
    preampDb: state.preampDb,
    stereoBalance: state.stereoBalance,
    monoEnabled: state.monoEnabled,
    normalizationEnabled: state.normalizationEnabled,
    outputDeviceId: state.outputDeviceId,
    sleepTimerEndsAt: state.sleepTimerEndsAt,
    sleepFadeSeconds: state.sleepFadeSeconds,
  })));

  useEffect(() => {
    isSwitchingSourceRef.current = false;
    if (!currentSong) {
      audioService.stop();
      setPlaybackStatus("idle");
      return;
    }
    if (!isPlaying) {
      audioService.pause();
      return;
    }

    let cancelled = false;
    // Retry count is metadata for this request. Resetting it on `playing` must
    // not start another load/play effect and interrupt the successful retry.
    const retryAttempt = usePlayerStore.getState().retryAttempt;
    const isCurrentRequest = () => {
      const state = usePlayerStore.getState();
      return !cancelled && state.isPlaying && state.playbackRequestId === playbackRequestId;
    };
    isSwitchingSourceRef.current = true;
    setPlaybackStatus("loading");

    const loadAndPlay = async () => {
      try {
        await audioService.loadSong(currentSong, { forceReload: retryAttempt > 0 });
        if (!isCurrentRequest()) return;
        audioService.restorePosition(usePlayerStore.getState().currentTime);
        await audioService.play();
        if (isCurrentRequest()) recordPlayedHistory(currentSong, playbackRequestId, playedSessionRef);
      } catch (error) {
        if (!cancelled) handlePlaybackFailure(error, handledFailuresRef.current, {
          songId: currentSong.id,
          requestId: playbackRequestId,
          attempt: retryAttempt,
        });
      } finally {
        if (!cancelled) isSwitchingSourceRef.current = false;
      }
    };

    // A stalled fetch does not necessarily reject play(). Recover a request
    // that makes no playback or buffering progress instead of waiting forever.
    let lastTime = audioService.getCurrentTime();
    let lastBuffered = audioService.getBufferedUntil();
    let lastProgressAt = Date.now();
    const watchdog = window.setInterval(() => {
      if (!isCurrentRequest()) return;
      const time = audioService.getCurrentTime();
      const buffered = audioService.getBufferedUntil();
      if (time !== lastTime || buffered !== lastBuffered) lastProgressAt = Date.now();
      lastTime = time;
      lastBuffered = buffered;
      if (Date.now() - lastProgressAt >= 30_000) {
        window.clearInterval(watchdog);
        handlePlaybackFailure(new Error("Audio made no progress for 30 seconds."), handledFailuresRef.current, {
          songId: currentSong.id,
          requestId: playbackRequestId,
          attempt: usePlayerStore.getState().retryAttempt,
        });
      }
    }, 1_000);

    void loadAndPlay();
    return () => {
      cancelled = true;
      window.clearInterval(watchdog);
    };
  }, [currentSong, isPlaying, playbackRequestId, setPlaybackStatus]);

  useEffect(() => audioService.setVolume(volume), [volume]);
  useEffect(() => audioService.setMuted(isMuted), [isMuted]);
  useEffect(() => audioService.setPlaybackRate(playbackRate, preservesPitch), [playbackRate, preservesPitch]);

  useEffect(() => {
    audioService.configureAudioProcessing({
      equalizerEnabled,
      equalizerGains,
      preampDb,
      stereoBalance,
      monoEnabled,
      normalizationEnabled,
    });
  }, [equalizerEnabled, equalizerGains, monoEnabled, normalizationEnabled, preampDb, stereoBalance]);

  useEffect(() => {
    if (!outputDeviceId) return;
    void audioService.setOutputDevice(outputDeviceId).catch((error: unknown) => {
      console.warn("Could not restore the selected audio output:", error);
    });
  }, [outputDeviceId]);

  useEffect(() => {
    const unsubscribers = [
      audioService.onTimeUpdate(() => {
        const state = usePlayerStore.getState();
        if (isSwitchingSourceRef.current) return;
        const preferences = usePlaybackPreferencesStore.getState();
        const currentTime = audioService.getCurrentTime();
        const loop = preferences.abRepeat;
        if (
          loop.enabled
          && state.currentSong?.id === loop.trackId
          && loop.startSeconds !== null
          && loop.endSeconds !== null
          && currentTime >= loop.endSeconds
        ) {
          audioService.seek(loop.startSeconds);
          state.setCurrentTime(loop.startSeconds);
        } else {
          state.setCurrentTime(currentTime);
        }
        audioService.updateMediaSessionPosition();
      }),
      audioService.onLoadedMetadata(() => {
        const state = usePlayerStore.getState();
        state.setDuration(audioService.getDuration());
        if (state.isPlaying && state.playbackStatus !== "playing") state.setPlaybackStatus("ready");
        audioService.updateMediaSessionPosition();
      }),
      audioService.onLoadStart(() => {
        const state = usePlayerStore.getState();
        if (state.isPlaying) state.setPlaybackStatus("loading");
      }),
      audioService.onWaiting(() => {
        const state = usePlayerStore.getState();
        if (state.isPlaying) state.setPlaybackStatus("buffering");
      }),
      audioService.onStalled(() => {
        const state = usePlayerStore.getState();
        if (state.isPlaying && !audioService.hasPlaybackData()) state.setPlaybackStatus("buffering");
      }),
      audioService.onCanPlay(() => {
        const state = usePlayerStore.getState();
        if (state.isPlaying && state.playbackStatus !== "playing") state.setPlaybackStatus("ready");
      }),
      audioService.onProgress((bufferedUntil) => usePlayerStore.getState().setBufferedUntil(bufferedUntil)),
      audioService.onEnded(() => { void handleTrackEnded(); }),
      audioService.onPlay(() => {
        const state = usePlayerStore.getState();
        if (!state.isPlaying || audioService.isPaused()) return;
        // `play` means playback was requested; `playing` confirms audio started.
        audioService.updateMediaSessionPlaybackState(true);
      }),
      audioService.onPlaying(() => {
        const state = usePlayerStore.getState();
        if (!state.isPlaying || audioService.isPaused()) return;
        isSwitchingSourceRef.current = false;
        state.setPlaybackStatus("playing");
        audioService.updateMediaSessionPlaybackState(true);
        if (state.currentSong) recordPlayedHistory(state.currentSong, state.playbackRequestId, playedSessionRef);
      }),
      audioService.onPause(() => {
        // load() queues pause events. By dispatch time the new source may
        // already be playing, so the event alone cannot cancel playback intent.
        if (isSwitchingSourceRef.current || !audioService.isPaused() || audioService.isEnded()) return;
        const state = usePlayerStore.getState();
        const failed = state.playbackStatus === "error";
        state.setIsPlaying(false);
        if (!failed) state.setPlaybackStatus(state.currentSong ? "paused" : "idle");
        audioService.updateMediaSessionPlaybackState(false);
      }),
      audioService.onRateChange(() => audioService.updateMediaSessionPosition()),
      audioService.onError((error) => {
        if (!isSwitchingSourceRef.current) handlePlaybackFailure(error, handledFailuresRef.current);
      }),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);

  useEffect(() => {
    if (pendingHistoryEvents.length === 0) return;
    for (const event of pendingHistoryEvents) {
      usePlayerStore.getState().consumePendingHistoryEvent(event.id);
      const payload = historyPayload(event.track);
      if (!payload) continue;
      void addHistory({
        ...payload,
        event_type: event.eventType,
        position_seconds: event.positionSeconds,
      }).then(invalidatePlaybackHistory).catch(logHistoryFailure);
    }
  }, [pendingHistoryEvents]);

  useEffect(() => {
    audioService.setMediaSessionHandlers({
      play: () => usePlayerStore.getState().setIsPlaying(true),
      pause: () => usePlayerStore.getState().setIsPlaying(false),
      stop: () => {
        audioService.stop();
        const state = usePlayerStore.getState();
        state.setCurrentTime(0);
        state.setIsPlaying(false);
        state.setPlaybackStatus(state.currentSong ? "paused" : "idle");
      },
      previoustrack: () => {
        const state = usePlayerStore.getState();
        const currentId = state.currentSong?.id;
        const previous = state.playPreviousSong();
        if (previous) {
          if (previous.id === currentId) audioService.seek(0);
          state.setIsPlaying(true);
        }
      },
      nexttrack: () => {
        const state = usePlayerStore.getState();
        const nextSong = state.playNextManually();
        if (nextSong) state.setIsPlaying(true);
      },
      seekbackward: (details) => {
        const offset = details.seekOffset ?? usePlaybackPreferencesStore.getState().seekStepSeconds;
        audioService.seek(Math.max(0, audioService.getCurrentTime() - offset));
      },
      seekforward: (details) => {
        const offset = details.seekOffset ?? usePlaybackPreferencesStore.getState().seekStepSeconds;
        audioService.seek(Math.min(audioService.getDuration(), audioService.getCurrentTime() + offset));
      },
      seekto: (details) => {
        if (details.seekTime !== undefined) audioService.seek(details.seekTime);
      },
    });
    return () => audioService.clearMediaSessionHandlers();
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const defaultTitle = defaultDocumentTitleRef.current;
    if (!currentSong) document.title = defaultTitle;
    else {
      const artist = currentSong.artistName ? ` — ${currentSong.artistName}` : "";
      document.title = `${isPlaying ? "▶ " : ""}${currentSong.title}${artist} | ANM Player`;
    }
    return () => {
      document.title = defaultTitle;
    };
  }, [currentSong, isPlaying]);

  useEffect(() => {
    if (sleepTimerEndsAt === null) return;
    let cancelled = false;
    const remaining = Math.max(0, sleepTimerEndsAt - Date.now());
    const fadeDuration = Math.min(remaining, sleepFadeSeconds * 1_000);
    const fadeDelay = Math.max(0, remaining - fadeDuration);
    const timer = window.setTimeout(() => {
      void audioService.fadeOut(fadeDuration).then(() => {
        if (cancelled || usePlaybackPreferencesStore.getState().sleepTimerEndsAt !== sleepTimerEndsAt) return;
        usePlayerStore.getState().setIsPlaying(false);
        usePlaybackPreferencesStore.getState().clearSleepTimer();
      });
    }, fadeDelay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      audioService.resetFade();
    };
  }, [sleepFadeSeconds, sleepTimerEndsAt]);

  return {
    seek: (time: number) => audioService.seek(time),
    skipForward: (seconds = usePlaybackPreferencesStore.getState().seekStepSeconds) => {
      audioService.seek(Math.min(audioService.getDuration(), audioService.getCurrentTime() + seconds));
    },
    skipBackward: (seconds = usePlaybackPreferencesStore.getState().seekStepSeconds) => {
      audioService.seek(Math.max(0, audioService.getCurrentTime() - seconds));
    },
    retry: () => usePlayerStore.getState().retryCurrentSong(),
    stop: () => {
      audioService.stop();
      usePlayerStore.getState().setIsPlaying(false);
    },
    capabilities: audioService.getCapabilities(),
    listOutputDevices: () => audioService.listOutputDevices(),
    selectOutputDevice: async (deviceId: string | null) => {
      await audioService.setOutputDevice(deviceId);
      usePlaybackPreferencesStore.getState().setOutputDeviceId(deviceId);
    },
  };
}

async function handleTrackEnded(): Promise<void> {
  const state = usePlayerStore.getState();
  const completedSong = state.currentSong;
  if (completedSong) {
    const payload = historyPayload(completedSong);
    if (payload) {
      void addHistory({
        ...payload,
        event_type: "completed",
        position_seconds: Math.floor(audioService.getDuration()),
      }).then(invalidatePlaybackHistory).catch(logHistoryFailure);
    }
  }

  const preferences = usePlaybackPreferencesStore.getState();
  if (preferences.stopAfterCurrent || preferences.sleepTimerEndOfTrack) {
    if (preferences.stopAfterCurrent) preferences.setStopAfterCurrent(false);
    if (preferences.sleepTimerEndOfTrack) preferences.clearSleepTimer();
    state.setIsPlaying(false);
    state.setPlaybackStatus(completedSong ? "paused" : "idle");
    return;
  }

  if (state.repeat === "off" && state.queue.length === 0 && preferences.autoplayEnabled && completedSong?.source === "youtube") {
    const autoplayTracks = await relatedAutoplayTracks(completedSong);
    const latestState = usePlayerStore.getState();
    if (latestState.currentSong?.id !== completedSong.id) return;
    if (autoplayTracks.length > 0) latestState.setQueue(autoplayTracks);
  }

  const nextSong = usePlayerStore.getState().playNextSong();
  if (nextSong) usePlayerStore.getState().setIsPlaying(true);
}

async function relatedAutoplayTracks(seed: Extract<PlayerTrack, { source: "youtube" }>): Promise<PlayerTrack[]> {
  try {
    const response = await getYouTubeRelated(seed.videoId);
    const state = usePlayerStore.getState();
    const excluded = new Set([
      seed.id,
      ...state.queue.map((track) => track.id),
      ...state.queueHistory.map((track) => track.id),
      ...state.originalQueue.map((track) => track.id),
    ]);
    const tracks: PlayerTrack[] = [];
    for (const item of response.items) {
      if (!item.playable || !["song", "video", "episode"].includes(item.kind)) continue;
      const track = onlineItemToPlayerTrack(item);
      if (excluded.has(track.id)) continue;
      excluded.add(track.id);
      tracks.push(track);
      if (tracks.length >= 25) break;
    }
    return tracks;
  } catch (error) {
    console.error("Could not extend the queue with related tracks:", error);
    return [];
  }
}

function isIgnorablePlaybackAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function handlePlaybackFailure(
  error: unknown,
  handledFailures: Set<string>,
  request?: { songId: string; requestId: number; attempt: number },
): void {
  if (isIgnorablePlaybackAbort(error)) return;
  const state = usePlayerStore.getState();
  const song = state.currentSong;
  if (!song) return;
  const songId = request?.songId ?? song.id;
  const requestId = request?.requestId ?? state.playbackRequestId;
  const attempt = request?.attempt ?? state.retryAttempt;
  if (song.id !== songId || state.playbackRequestId !== requestId) return;
  const failureKey = `${songId}:${requestId}:${attempt}`;
  if (handledFailures.has(failureKey)) return;
  handledFailures.add(failureKey);
  if (handledFailures.size > 50) {
    const oldest = handledFailures.values().next().value;
    if (oldest) handledFailures.delete(oldest);
  }

  const message = playbackErrorMessage(error);
  console.error("Playback failure:", error, audioService.getError());
  if (attempt < 1) {
    state.setPlaybackStatus("loading");
    state.retryCurrentSong();
    return;
  }

  state.setPlaybackStatus("error", message);
  if (usePlaybackPreferencesStore.getState().skipOnPlaybackError) {
    const nextSong = state.playNextAfterError();
    if (nextSong) {
      state.setIsPlaying(true);
      toast(`Skipped ${song.title} after playback failed.`, "warning");
      return;
    }
  }
  state.setIsPlaying(false);
  toast(message, "error");
}

function playbackErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") return "Playback needs a user gesture before it can start.";
  return "Playback stopped because the audio could not be loaded.";
}

function historyPayload(song: PlayerTrack): HistoryCreateRequest | null {
  if (song.source === "local" && song.localKind === "song") {
    return {
      source: "local",
      song_id: song.songId,
      title: song.title,
      artist_name: song.artistName,
      album_title: song.albumTitle,
      artwork_url: song.rawSong.artwork_path || song.rawSong.artwork_url,
      duration_seconds: song.durationSeconds,
      source_url: song.rawSong.source_url,
    };
  }
  if (song.source === "local") {
    if (!song.rawLibraryTrack.song_id) return null;
    return {
      source: "local",
      song_id: song.rawLibraryTrack.song_id,
      title: song.title,
      artist_name: song.artistName,
      album_title: song.albumTitle,
      artwork_url: song.rawLibraryTrack.artwork_path || song.rawLibraryTrack.artwork_url,
      duration_seconds: song.durationSeconds,
      source_url: song.rawLibraryTrack.source_url,
    };
  }
  return {
    source: "youtube",
    external_id: song.videoId,
    title: song.title,
    artist_name: song.artistName,
    album_title: song.albumTitle,
    artwork_url: song.rawItem.thumbnail,
    duration_seconds: song.durationSeconds,
    source_url: song.rawItem.url,
  };
}

function invalidatePlaybackHistory() {
  return queryClient.invalidateQueries({ queryKey: ["music", "history"] });
}

function recordPlayedHistory(song: PlayerTrack, playbackRequestId: number, playedSessionRef: { current: string | null }) {
  const playbackSession = `${song.id}:${playbackRequestId}`;
  if (playedSessionRef.current === playbackSession) return;
  playedSessionRef.current = playbackSession;
  const payload = historyPayload(song);
  if (!payload) return;
  void addHistory({ ...payload, event_type: "played" }).then(invalidatePlaybackHistory).catch(logHistoryFailure);
}

function logHistoryFailure(error: unknown) {
  console.error("Could not record playback history:", error);
}

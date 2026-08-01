import { useEffect, useRef } from "react";

import { toast } from "@/components/ui/toast";
import { audioService } from "@/services/audio-service";
import { addHistory } from "@/services/music-api";
import { queryClient } from "@/lib/query-client";
import { usePlayerStore } from "@/stores/player-store";
import type { HistoryCreateRequest } from "@/types/api";
import type { PlayerTrack } from "@/types/player";

export function useAudioPlayer() {
  const isSwitchingSourceRef = useRef(false);
  const playedSessionRef = useRef<string | null>(null);
  const {
    currentSong,
    isPlaying,
    volume,
    isMuted,
    playbackRequestId,
    setIsPlaying,
    setCurrentTime,
    setDuration,
    playNextSong,
  } = usePlayerStore();

  // Sync audio service with player state. Do not load a persisted currentSong
  // until playback is requested; loading a YouTube src triggers server caching.
  useEffect(() => {
    if (!currentSong) {
      audioService.stop();
      return;
    }

    if (!isPlaying) {
      audioService.pause();
      return;
    }

    let cancelled = false;
    isSwitchingSourceRef.current = true;

    const loadAndPlay = async () => {
      try {
        await audioService.loadSong(currentSong);
        if (cancelled || !usePlayerStore.getState().isPlaying) return;
        audioService.restorePosition(usePlayerStore.getState().currentTime);
        isSwitchingSourceRef.current = false;
        await audioService.play();
        if (!cancelled) {
          recordPlayedHistory(currentSong, playbackRequestId, playedSessionRef);
        }
      } catch (error) {
        if (cancelled || isIgnorablePlaybackAbort(error)) return;
        console.error("Failed to load song:", error);
        toast("ANM Player couldn't play this track.", "error");
        setIsPlaying(false);
      } finally {
        if (!cancelled) {
          isSwitchingSourceRef.current = false;
        }
      }
    };

    loadAndPlay();

    return () => {
      cancelled = true;
    };
  }, [currentSong, isPlaying, playbackRequestId, setIsPlaying]);

  // Handle volume changes
  useEffect(() => {
    audioService.setVolume(volume);
  }, [volume]);

  // Handle mute
  useEffect(() => {
    audioService.setMuted(isMuted);
  }, [isMuted]);

  // Listen to audio events
  useEffect(() => {
    const unsubscribeTimeUpdate = audioService.onTimeUpdate(() => {
      setCurrentTime(audioService.getCurrentTime());
      audioService.updateMediaSessionPosition();
    });

    const unsubscribeLoadedMetadata = audioService.onLoadedMetadata(() => {
      setDuration(audioService.getDuration());
      audioService.updateMediaSessionPosition();
    });

    const unsubscribeEnded = audioService.onEnded(() => {
      // Track as completed
      if (currentSong) {
        const payload = historyPayload(currentSong);
        if (payload) {
          addHistory({
            ...payload,
            event_type: "completed",
            position_seconds: Math.floor(audioService.getDuration()),
          })
            .then(invalidatePlaybackHistory)
            .catch(logHistoryFailure);
        }
      }

      // Play next song
      const nextSong = playNextSong();
      if (nextSong) {
        setIsPlaying(true);
      }
    });

    const unsubscribePlay = audioService.onPlay(() => {
      setIsPlaying(true);
      audioService.updateMediaSessionPlaybackState(true);
      if (currentSong) {
        recordPlayedHistory(currentSong, playbackRequestId, playedSessionRef);
      }
    });

    const unsubscribePause = audioService.onPause(() => {
      if (isSwitchingSourceRef.current) return;
      setIsPlaying(false);
      audioService.updateMediaSessionPlaybackState(false);
    });

    const unsubscribeError = audioService.onError((error) => {
      if (isSwitchingSourceRef.current) return;
      console.error("Audio error:", error, audioService.getError());
      toast("Playback stopped because the audio could not be loaded.", "error");
      setIsPlaying(false);
    });

    return () => {
      unsubscribeTimeUpdate();
      unsubscribeLoadedMetadata();
      unsubscribeEnded();
      unsubscribePlay();
      unsubscribePause();
      unsubscribeError();
    };
  }, [currentSong, playbackRequestId, playNextSong, setCurrentTime, setDuration, setIsPlaying]);

  // Set up Media Session API handlers
  useEffect(() => {
    const { playPreviousSong } = usePlayerStore.getState();

    audioService.setMediaSessionHandlers({
      play: () => setIsPlaying(true),
      pause: () => setIsPlaying(false),
      previoustrack: () => {
        const currentId = usePlayerStore.getState().currentSong?.id;
        const prevSong = playPreviousSong();
        if (prevSong) {
          if (prevSong.id === currentId) audioService.seek(0);
          setIsPlaying(true);
        }
      },
      nexttrack: () => {
        const nextSong = playNextSong();
        if (nextSong) setIsPlaying(true);
      },
      seekbackward: () => {
        const newTime = Math.max(0, audioService.getCurrentTime() - 10);
        audioService.seek(newTime);
      },
      seekforward: () => {
        const newTime = Math.min(audioService.getDuration(), audioService.getCurrentTime() + 10);
        audioService.seek(newTime);
      },
    });
    return () => audioService.clearMediaSessionHandlers();
  }, [playNextSong, setIsPlaying]);

  return {
    seek: (time: number) => audioService.seek(time),
    skipForward: (seconds = 10) => {
      const newTime = Math.min(audioService.getDuration(), audioService.getCurrentTime() + seconds);
      audioService.seek(newTime);
    },
    skipBackward: (seconds = 10) => {
      const newTime = Math.max(0, audioService.getCurrentTime() - seconds);
      audioService.seek(newTime);
    },
  };
}

function isIgnorablePlaybackAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function historyPayload(song: PlayerTrack): HistoryCreateRequest | null {
  if (song.source === "local" && song.localKind === "song") {
    return {
      source: "local" as const,
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
    source: "youtube" as const,
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

function recordPlayedHistory(
  song: PlayerTrack,
  playbackRequestId: number,
  playedSessionRef: { current: string | null },
) {
  const playbackSession = `${song.id}:${playbackRequestId}`;
  if (playedSessionRef.current === playbackSession) return;

  playedSessionRef.current = playbackSession;
  const payload = historyPayload(song);
  if (!payload) return;
  addHistory({
    ...payload,
    event_type: "played",
  })
    .then(invalidatePlaybackHistory)
    .catch(logHistoryFailure);
}

function logHistoryFailure(error: unknown) {
  console.error("Could not record playback history:", error);
}

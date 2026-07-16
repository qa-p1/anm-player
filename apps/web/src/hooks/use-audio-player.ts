import { useEffect, useRef } from "react";

import { audioService } from "@/services/audio-service";
import { addHistory } from "@/services/music-api";
import { queryClient } from "@/lib/query-client";
import { usePlayerStore } from "@/stores/player-store";
import type { PlayerTrack } from "@/types/player";

export function useAudioPlayer() {
  const isSwitchingSourceRef = useRef(false);
  const playedTrackIdRef = useRef<string | null>(null);
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
      } catch (error) {
        if (cancelled || isIgnorablePlaybackAbort(error)) return;
        console.error("Failed to load song:", error);
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
  }, [currentSong?.id, isPlaying, playbackRequestId]);

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
        addHistory({
          ...historyPayload(currentSong),
          event_type: "completed",
          position_seconds: Math.floor(audioService.getDuration()),
        })
          .then(invalidatePlaybackHistory)
          .catch(console.error);
      }

      // Play next song
      const nextSong = playNextSong();
      if (nextSong) {
        if (nextSong.id === currentSong?.id) {
          audioService.seek(0);
          audioService.play().catch(console.error);
        }
        setIsPlaying(true);
      }
    });

    const unsubscribePlay = audioService.onPlay(() => {
      setIsPlaying(true);
      audioService.updateMediaSessionPlaybackState(true);
    });

    const unsubscribePause = audioService.onPause(() => {
      if (isSwitchingSourceRef.current) return;
      setIsPlaying(false);
      audioService.updateMediaSessionPlaybackState(false);
    });

    const unsubscribeError = audioService.onError((error) => {
      if (isSwitchingSourceRef.current) return;
      console.error("Audio error:", error, audioService.getError());
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
  }, [currentSong?.id]);

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
  }, []);

  // Track playback history
  useEffect(() => {
    if (!currentSong || !isPlaying) return;
    if (playedTrackIdRef.current === currentSong.id) return;
    playedTrackIdRef.current = currentSong.id;

    addHistory({
      ...historyPayload(currentSong),
      event_type: "played",
    })
      .then(invalidatePlaybackHistory)
      .catch(console.error);
  }, [currentSong?.id, isPlaying]);

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
  return error instanceof DOMException && error.name === "AbortError";
}

function historyPayload(song: PlayerTrack) {
  if (song.source === "local" && song.localKind === "song") {
    return {
      source: "local" as const,
      song_id: song.songId,
      title: song.title,
      artist_name: song.artistName,
      album_title: song.albumTitle,
      artwork_url: song.artworkUrl,
      duration_seconds: song.durationSeconds,
      source_url: song.rawSong.source_url,
    };
  }

  if (song.source === "local") {
    return {
      source: "youtube" as const,
      external_id: song.rawLibraryTrack.external_id,
      title: song.title,
      artist_name: song.artistName,
      album_title: song.albumTitle,
      artwork_url: song.artworkUrl,
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
    artwork_url: song.artworkUrl,
    duration_seconds: song.durationSeconds,
    source_url: song.rawItem.url,
  };
}

function invalidatePlaybackHistory() {
  queryClient.invalidateQueries({ queryKey: ["music", "history"] });
}

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fetchSongLyrics,
  fetchYouTubeLyrics,
  getSongLyrics,
  getYouTubeLyrics,
  saveSongLyrics,
} from "@/services/music-api";
import type { LyricsResponse } from "@/types/api";

type LyricsTarget =
  | {
      kind: "local";
      songId: number;
      title?: string | null;
      artist?: string | null;
      album?: string | null;
      duration?: number | null;
    }
  | {
      kind: "youtube";
      videoId: string;
      title?: string | null;
      artist?: string | null;
      album?: string | null;
      duration?: number | null;
    };

const inFlight = new Map<string, Promise<LyricsResponse>>();

export function useLyrics(target: LyricsTarget | null) {
  const [data, setData] = useState<LyricsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const key = useMemo(() => {
    if (!target) return null;
    return target.kind === "local" ? `local_song:${target.songId}` : `youtube:${target.videoId}`;
  }, [target]);

  const loadCache = useCallback(
    async (signal?: AbortSignal) => {
      if (!target) return null;
      return target.kind === "local"
        ? getSongLyrics(target.songId, signal)
        : getYouTubeLyrics(
            {
              videoId: target.videoId,
              title: target.title,
              artist: target.artist,
              album: target.album,
              duration: target.duration,
            },
            signal,
          );
    },
    [target],
  );

  const fetchLyrics = useCallback(
    async (force = false, signal?: AbortSignal) => {
      if (!target || !key) return null;
      const requestKey = `${key}:fetch:${force}`;
      let promise = inFlight.get(requestKey);
      if (!promise) {
        promise =
          target.kind === "local"
            ? fetchSongLyrics(target.songId, signal, force)
            : fetchYouTubeLyrics(
                {
                  videoId: target.videoId,
                  title: target.title,
                  artist: target.artist,
                  album: target.album,
                  duration: target.duration,
                },
                signal,
                force,
              );
        inFlight.set(requestKey, promise);
        promise.finally(() => inFlight.delete(requestKey));
      }
      setIsFetching(true);
      try {
        const result = await promise;
        setData(result);
        return result;
      } finally {
        setIsFetching(false);
      }
    },
    [key, target],
  );

  const saveLyrics = useCallback(
    async (lyrics: string) => {
      if (!target || target.kind !== "local") return null;
      setIsSaving(true);
      try {
        const result = await saveSongLyrics(target.songId, lyrics);
        setData(result);
        return result;
      } finally {
        setIsSaving(false);
      }
    },
    [target],
  );

  useEffect(() => {
    if (!target || !key) {
      setData(null);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setData(null);

    loadCache(controller.signal)
      .then((result) => {
        if (controller.signal.aborted || !result) return;
        setData(result);
        if (result.status === "missing") {
          void fetchLyrics(false, controller.signal);
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setData({
          lyrics: null,
          has_lyrics: false,
          status: "error",
          error_code: error instanceof Error ? error.message : "error",
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [fetchLyrics, key, loadCache, target]);

  return {
    data,
    lyrics: data?.lyrics ?? null,
    status: isFetching ? "fetching" : data?.status ?? "missing",
    isLoading,
    isFetching,
    isSaving,
    refresh: () => fetchLyrics(true),
    saveLyrics,
  };
}

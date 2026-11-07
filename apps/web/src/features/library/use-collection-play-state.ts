import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { toast } from "@/components/ui/toast";
import { usePlaybackSourceStore, type PlaybackSource } from "@/stores/playback-source-store";
import { usePlayerStore } from "@/stores/player-store";
import type { PlayerTrack } from "@/types/player";
import { shuffleTracks } from "@/utils/track-collection";

/**
 * Lets a collection's main button act as play/pause when the current song
 * came from this collection, and start the collection otherwise.
 */
export function useCollectionPlayState(tracks: readonly PlayerTrack[], source?: { kind: PlaybackSource["kind"]; id: string | number }) {
  const { currentId, isPlaying } = usePlayerStore(useShallow((state) => ({ currentId: state.currentSong?.id ?? null, isPlaying: state.isPlaying })));
  const ids = useMemo(() => new Set(tracks.map((track) => track.id)), [tracks]);
  const isActive = currentId !== null && ids.has(currentId);

  function playOrToggle() {
    const player = usePlayerStore.getState();
    if (isActive) player.setIsPlaying(!player.isPlaying);
    else if (tracks.length) {
      markSource();
      player.playAlbum([...tracks], 0);
    }
  }

  function markSource() {
    if (source) usePlaybackSourceStore.getState().setSource(source.kind, source.id, tracks.map((track) => track.id));
  }

  function shuffle() {
    if (!tracks.length) return;
    markSource();
    usePlayerStore.getState().playAlbum(shuffleTracks(tracks), 0);
  }

  function queueAll() {
    if (!tracks.length) return;
    usePlayerStore.getState().addTracksToQueue([...tracks]);
    toast(`Added ${tracks.length} ${tracks.length === 1 ? "track" : "tracks"} to the queue`, "success");
  }

  return { isActive, isPlaying: isActive && isPlaying, playOrToggle, shuffle, queueAll };
}

export async function copyLink(url: string, label = "Link") {
  try {
    await navigator.clipboard.writeText(url);
    toast(`${label} copied`, "success");
  } catch {
    toast("Could not copy the link", "error");
  }
}

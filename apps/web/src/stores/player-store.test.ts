import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePlayerStore } from "@/stores/player-store";
import type { PlayerTrack } from "@/types/player";

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

const [a, b, c, d, e] = ["a", "b", "c", "d", "e"].map(track);

describe("player queue invariants", () => {
  beforeEach(() => {
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
    vi.restoreAllMocks();
  });

  it("keeps add, play-next, removal, and reorder edits in the repeat cycle", () => {
    const player = usePlayerStore.getState();
    player.playAlbum([a, b, c]);
    player.addToQueue(d);
    player.playNext(e);
    player.removeFromQueue(1);
    player.reorderQueue(2, 1);

    const state = usePlayerStore.getState();
    expect(state.queue.map(({ id }) => id)).toEqual(["e", "d", "c"]);
    expect(state.originalQueue.map(({ id }) => id)).toEqual(["a", "e", "d", "c"]);
  });

  it("never restores a removed track when shuffle is disabled", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const player = usePlayerStore.getState();
    player.playAlbum([a, b, c, d]);
    player.toggleShuffle();
    const removedId = usePlayerStore.getState().queue[0].id;
    usePlayerStore.getState().removeFromQueue(0);
    usePlayerStore.getState().toggleShuffle();

    const state = usePlayerStore.getState();
    expect(state.queue.map(({ id }) => id)).not.toContain(removedId);
    expect(state.originalQueue.map(({ id }) => id)).not.toContain(removedId);
  });

  it("does not resurrect cleared tracks through repeat-all", () => {
    const player = usePlayerStore.getState();
    player.playAlbum([a, b, c]);
    player.setRepeat("all");
    player.clearQueue();

    expect(usePlayerStore.getState().playNextSong()).toBeNull();
    expect(usePlayerStore.getState().currentSong).toBeNull();
    expect(usePlayerStore.getState().originalQueue).toEqual([]);
  });

  it("repeat-all uses the edited cycle and repeat-one creates a new request", () => {
    const player = usePlayerStore.getState();
    player.playAlbum([a, b, c]);
    player.removeFromQueue(1);
    player.setRepeat("all");

    expect(player.playNextSong()?.id).toBe("b");
    expect(player.playNextSong()?.id).toBe("a");
    expect(usePlayerStore.getState().queue.map(({ id }) => id)).toEqual(["b"]);

    usePlayerStore.getState().setRepeat("one");
    const requestId = usePlayerStore.getState().playbackRequestId;
    expect(usePlayerStore.getState().playNextSong()?.id).toBe("a");
    expect(usePlayerStore.getState().playbackRequestId).toBe(requestId + 1);
  });
});

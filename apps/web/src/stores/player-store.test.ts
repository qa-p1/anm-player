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

  it("lets manual next bypass repeat-one and records a skipped history event", () => {
    const player = usePlayerStore.getState();
    player.playAlbum([a, b, c]);
    player.setRepeat("one");
    player.setDuration(60);
    player.setCurrentTime(12);

    expect(usePlayerStore.getState().playNextSong()?.id).toBe("a");
    usePlayerStore.getState().setDuration(60);
    usePlayerStore.getState().setCurrentTime(12);
    expect(usePlayerStore.getState().playNextManually()?.id).toBe("b");
    expect(usePlayerStore.getState().pendingHistoryEvents).toEqual([
      expect.objectContaining({ track: a, positionSeconds: 12, eventType: "skipped" }),
    ]);
  });

  it("removes a failed track from repeat-all before advancing", () => {
    const player = usePlayerStore.getState();
    player.playAlbum([a]);
    player.setRepeat("all");
    expect(usePlayerStore.getState().playNextAfterError()).toBeNull();
    expect(usePlayerStore.getState().originalQueue).toEqual([]);
    expect(usePlayerStore.getState().currentSong).toBeNull();
  });

  it("plays and repositions queued tracks without corrupting the remaining order", () => {
    const player = usePlayerStore.getState();
    player.playAlbum([a, b, c, d]);
    expect(player.moveQueueItemToEnd(0)).toBe(true);
    expect(usePlayerStore.getState().queue.map(({ id }) => id)).toEqual(["c", "d", "b"]);
    expect(usePlayerStore.getState().moveQueueItemNext(2)).toBe(true);
    expect(usePlayerStore.getState().queue.map(({ id }) => id)).toEqual(["b", "c", "d"]);

    expect(usePlayerStore.getState().playQueueIndex(1)?.id).toBe("c");
    expect(usePlayerStore.getState().queue.map(({ id }) => id)).toEqual(["d"]);
    expect(usePlayerStore.getState().queueHistory.map(({ id }) => id)).toEqual(["a"]);
    expect(usePlayerStore.getState().originalQueue.map(({ id }) => id)).toEqual(["a", "c", "d"]);
  });

  it("undoes removal and clear operations and deduplicates upcoming tracks", () => {
    const player = usePlayerStore.getState();
    player.playAlbum([a, b, c]);
    player.removeFromQueue(0);
    expect(usePlayerStore.getState().queue.map(({ id }) => id)).toEqual(["c"]);
    expect(usePlayerStore.getState().lastQueueEdit).toEqual({ kind: "remove", trackCount: 1 });
    expect(usePlayerStore.getState().undoLastQueueEdit()).toBe(true);
    expect(usePlayerStore.getState().queue.map(({ id }) => id)).toEqual(["b", "c"]);

    usePlayerStore.getState().addToQueue(b);
    usePlayerStore.getState().addToQueue(c);
    expect(usePlayerStore.getState().deduplicateQueue()).toBe(2);
    expect(usePlayerStore.getState().queue.map(({ id }) => id)).toEqual(["b", "c"]);

    usePlayerStore.getState().clearQueue();
    expect(usePlayerStore.getState().queue).toEqual([]);
    expect(usePlayerStore.getState().undoLastQueueEdit()).toBe(true);
    expect(usePlayerStore.getState().queue.map(({ id }) => id)).toEqual(["b", "c"]);
  });

  it("saves, loads, deletes queue snapshots, and replays queue history", () => {
    const player = usePlayerStore.getState();
    player.playAlbum([a, b, c]);
    const snapshot = player.saveQueueSnapshot("Road trip");
    expect(snapshot?.tracks.map(({ id }) => id)).toEqual(["a", "b", "c"]);

    usePlayerStore.getState().playNextManually();
    usePlayerStore.getState().playNextManually();
    expect(usePlayerStore.getState().replayHistoryItem(0)?.id).toBe("a");
    expect(usePlayerStore.getState().queue.map(({ id }) => id)).toEqual(["b", "c"]);

    expect(usePlayerStore.getState().loadQueueSnapshot(snapshot!.id, false)?.id).toBe("a");
    expect(usePlayerStore.getState()).toMatchObject({ isPlaying: false, playbackStatus: "paused" });
    usePlayerStore.getState().deleteQueueSnapshot(snapshot!.id);
    expect(usePlayerStore.getState().queueSnapshots).toEqual([]);
  });

  it("shuffles the rest of the list when a track is picked from it with shuffle on", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    usePlayerStore.setState({ shuffle: true });

    usePlayerStore.getState().playSong(b, [a, b, c, d, e]);

    const state = usePlayerStore.getState();
    expect(state.currentSong?.id).toBe("b");
    // Earlier tracks are part of the shuffled cycle, not just the tail.
    expect(state.queue.map((entry) => entry.id).sort()).toEqual(["a", "c", "d", "e"]);
    expect(state.queue.map((entry) => entry.id)).not.toEqual(["c", "d", "e"]);
    expect(state.originalQueue.map((entry) => entry.id)).toEqual(["a", "b", "c", "d", "e"]);
    random.mockRestore();
  });

  it("keeps list order after the picked track when shuffle is off", () => {
    usePlayerStore.getState().playSong(b, [a, b, c, d, e]);
    expect(usePlayerStore.getState().queue.map((entry) => entry.id)).toEqual(["c", "d", "e"]);
  });
});

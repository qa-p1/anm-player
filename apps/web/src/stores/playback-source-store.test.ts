import { beforeEach, expect, it } from "vitest";

import { usePlaybackSourceStore } from "@/stores/playback-source-store";
import { usePlayerStore } from "@/stores/player-store";
import { playerTrack } from "@/test/music-fixtures";

beforeEach(() => {
  usePlayerStore.setState({ currentSong: null, queue: [], originalQueue: [] });
  usePlaybackSourceStore.getState().clear();
});

it("keeps the playlist marker while its songs play and clears it for outside songs", () => {
  const [first, second, outsider] = [playerTrack(1), playerTrack(2), playerTrack(9)];
  usePlaybackSourceStore.getState().setSource("playlist", 4, [first.id, second.id]);
  usePlayerStore.setState({ currentSong: first });
  usePlayerStore.setState({ currentSong: second });
  expect(usePlaybackSourceStore.getState().source).toMatchObject({ kind: "playlist", id: "4" });
  usePlayerStore.setState({ currentSong: outsider });
  expect(usePlaybackSourceStore.getState().source).toBeNull();
});

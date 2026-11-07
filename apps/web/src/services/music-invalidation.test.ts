import { QueryClient } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { musicKeys } from "@/services/music-keys";
import { invalidateHistory, invalidateLibrary, invalidatePlaylistSummaries } from "@/services/music-invalidation";
it("refreshes every library view after an album, download or metadata change", async () => {
  const client = new QueryClient();
  const views = [musicKeys.counts(), musicKeys.librarySearch("song"), musicKeys.smartCollection("recently-added"), musicKeys.artist(1), musicKeys.songsAll(), musicKeys.libraryAlbums(12), musicKeys.favorites(), musicKeys.playlist(1)];
  for (const key of views) client.setQueryData(key, []);
  client.setQueryData(musicKeys.downloadsList(), []);
  await invalidateLibrary(client);
  expect(views.every((key) => client.getQueryState(key)?.isInvalidated)).toBe(true);
  expect(client.getQueryState(musicKeys.downloadsList())?.isInvalidated).toBe(false);
  client.clear();
});
it("refreshes history-derived views together without reloading the library", async () => {
  const client = new QueryClient();
  const views = [musicKeys.historyLog(), musicKeys.historyRecentlyPlayed(20), musicKeys.historyMostPlayed(100), musicKeys.insights(30)];
  for (const key of views) client.setQueryData(key, []);
  client.setQueryData(musicKeys.songsAll(), []);
  await invalidateHistory(client);
  expect(views.every((key) => client.getQueryState(key)?.isInvalidated)).toBe(true);
  expect(client.getQueryState(musicKeys.songsAll())?.isInvalidated).toBe(false);
  client.clear();
});
it("refreshes playlist counts and favorites without replacing an optimistic detail", async () => {
  const client = new QueryClient();
  for (const key of [musicKeys.playlistsAll(), musicKeys.favorites(), musicKeys.counts(), musicKeys.playlist(1)]) client.setQueryData(key, []);
  await invalidatePlaylistSummaries(client);
  expect(client.getQueryState(musicKeys.counts())?.isInvalidated).toBe(true);
  expect(client.getQueryState(musicKeys.playlistsAll())?.isInvalidated).toBe(true);
  expect(client.getQueryState(musicKeys.playlist(1))?.isInvalidated).toBe(false);
  client.clear();
});

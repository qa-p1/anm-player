import type { QueryClient } from "@tanstack/react-query";
import { musicKeys } from "@/services/music-keys";

export function invalidatePlaylistSummaries(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: musicKeys.playlistsAll() }),
    client.invalidateQueries({ queryKey: musicKeys.favorites() }),
    client.invalidateQueries({ queryKey: musicKeys.counts() }),
  ]);
}

export function invalidatePlaylists(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: musicKeys.playlists() }),
    client.invalidateQueries({ queryKey: musicKeys.favorites() }),
    client.invalidateQueries({ queryKey: musicKeys.counts() }),
  ]);
}

export function invalidateLibrary(client: QueryClient) {
  return Promise.all([musicKeys.songs(), musicKeys.artists(), musicKeys.albums(), musicKeys.library(), musicKeys.playlists(), musicKeys.favorites()]
    .map((queryKey) => client.invalidateQueries({ queryKey })));
}

export function invalidateHistory(client: QueryClient) {
  return client.invalidateQueries({ queryKey: musicKeys.history() });
}

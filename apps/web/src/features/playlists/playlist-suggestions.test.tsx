import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

import { PlaylistSuggestions } from "@/features/playlists/playlist-suggestions";
import * as api from "@/services/music-api";
import * as playlistTracks from "@/services/playlist-tracks";
import { song } from "@/test/music-fixtures";
import type { OnlineMusicItem } from "@/types/api";
import { onlineItemToPlayerTrack } from "@/types/player";

vi.mock("@/services/music-api", () => ({ getYouTubeRelated: vi.fn(), listAllSongs: vi.fn(), getMostPlayedHistory: vi.fn(), getRecentlyPlayedHistory: vi.fn() }));
vi.mock("@/services/playlist-tracks", () => ({ addPlayerTracksToPlaylist: vi.fn(async () => undefined) }));
vi.mock("@/components/ui/toast", () => ({ toast: vi.fn() }));

const item = (id: string, title: string, artist: string): OnlineMusicItem => ({ source: "youtube", kind: "song", id, title, subtitle: artist, artists: [{ id: null, name: artist }], album: null, thumbnail: null, duration_seconds: 200, explicit: false, playable: true, browse_id: null, playlist_id: null, endpoint: null, url: `https://music.youtube.com/watch?v=${id}` });

afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("recommends related songs for the playlist, never its own or unrelated library songs", async () => {
  const inPlaylist = onlineItemToPlayerTrack(item("seed", "Beat It", "Michael Jackson"));
  vi.mocked(api.getYouTubeRelated).mockResolvedValue({ seed_video_id: "seed", items: [item("seed", "Beat It", "Michael Jackson"), item("a", "Billie Jean", "Michael Jackson"), item("b", "Africa", "Toto")] });
  vi.mocked(api.listAllSongs).mockResolvedValue([{ ...song(9, "Unrelated tune"), artist_name: "Someone else" }]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><PlaylistSuggestions playlistId={1} tracks={[inPlaylist]} /></MemoryRouter></QueryClientProvider>);

  expect(await screen.findByText("Billie Jean")).toBeInTheDocument();
  expect(screen.getByText("Africa")).toBeInTheDocument();
  expect(screen.queryByText("Beat It")).not.toBeInTheDocument();
  expect(screen.queryByText("Unrelated tune")).not.toBeInTheDocument();
  expect(api.getMostPlayedHistory).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Add Billie Jean to playlist" }));
  await waitFor(() => expect(playlistTracks.addPlayerTracksToPlaylist).toHaveBeenCalledWith(1, [expect.objectContaining({ title: "Billie Jean" })]));
  expect(await screen.findByRole("button", { name: "Billie Jean added" })).toBeDisabled();
  client.clear();
});

it("seeds an empty playlist from listening history", async () => {
  vi.mocked(api.getMostPlayedHistory).mockResolvedValue([{ id: 1, song_id: null, song: null, source: "youtube", external_id: "fav", title: "Umbrella", artist_name: "Rihanna", album_title: null, artwork_url: null, duration_seconds: 200, source_url: null, event_type: "played", played_at: "2026-01-01", position_seconds: 0 }]);
  vi.mocked(api.getRecentlyPlayedHistory).mockResolvedValue([]);
  vi.mocked(api.getYouTubeRelated).mockResolvedValue({ seed_video_id: "fav", items: [item("c", "Diamonds", "Rihanna")] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><PlaylistSuggestions playlistId={1} tracks={[]} /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByText("Diamonds")).toBeInTheDocument();
  expect(api.getYouTubeRelated).toHaveBeenCalledWith("fav", expect.anything());
  client.clear();
});

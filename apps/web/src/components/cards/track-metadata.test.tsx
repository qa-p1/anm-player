import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

import { TrackMetadata } from "@/components/cards/track-metadata";
import { queryClient } from "@/lib/query-client";
import * as api from "@/services/music-api";
import type { OnlineMusicItem } from "@/types/api";
import { onlineItemToPlayerTrack } from "@/types/player";

vi.mock("@/services/music-api", () => ({ searchYouTubeMusic: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ toast: vi.fn() }));

const base: OnlineMusicItem = { source: "youtube", kind: "song", id: "v1", title: "Umbrella", subtitle: null, artists: [], album: null, thumbnail: null, duration_seconds: 200, explicit: false, playable: true, browse_id: null, playlist_id: null, endpoint: null, url: "https://music.youtube.com/watch?v=v1" };
const result = (kind: "artist" | "album", id: string, title: string, artist = "Rihanna"): OnlineMusicItem => ({ ...base, kind, id, browse_id: id, title, artists: [{ id: null, name: artist }], subtitle: artist, playable: false });

function Path() { return <output aria-label="path">{useLocation().pathname + useLocation().search}</output>; }
function mount(item: OnlineMusicItem) {
  render(<QueryClientProvider client={queryClient}><MemoryRouter><TrackMetadata track={onlineItemToPlayerTrack(item)} /><Path /></MemoryRouter></QueryClientProvider>);
}
afterEach(() => { cleanup(); queryClient.clear(); vi.resetAllMocks(); });

it("links straight to known artist and album pages", () => {
  mount({ ...base, artists: [{ id: "UCartist", name: "Rihanna" }], album: { id: "MPREalbum", name: "Good Girl Gone Bad" } });
  expect(screen.getByRole("link", { name: "Rihanna" })).toHaveAttribute("href", "/library/artists/online/UCartist");
  expect(screen.getByRole("link", { name: "Good Girl Gone Bad" })).toHaveAttribute("href", "/albums/MPREalbum");
});

it("opens the resolved artist and album pages for name-only credits, never the search page", async () => {
  vi.mocked(api.searchYouTubeMusic).mockImplementation(async (query, filter) => ({
    query, filter: filter ?? "all", continuation: null,
    items: filter === "artists" ? [result("artist", "UCwrong", "Rihanna Tribute"), result("artist", "UCright", "Rihanna")] : [result("album", "MPREother", "Loud"), result("album", "MPREgggb", "Good Girl Gone Bad")],
  }));
  mount({ ...base, artists: [{ id: null, name: "Rihanna feat. JAY-Z" }], album: { id: null, name: "Good Girl Gone Bad" } });

  fireEvent.click(screen.getByRole("button", { name: "Rihanna feat. JAY-Z" }));
  await waitFor(() => expect(screen.getByLabelText("path")).toHaveTextContent("/library/artists/online/UCright"));
  expect(api.searchYouTubeMusic).toHaveBeenCalledWith("Rihanna", "artists", undefined, expect.anything());

  fireEvent.click(screen.getByRole("button", { name: "Good Girl Gone Bad" }));
  await waitFor(() => expect(screen.getByLabelText("path")).toHaveTextContent("/albums/MPREgggb"));
  expect(screen.getByLabelText("path")).not.toHaveTextContent("/search");
});

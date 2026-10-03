import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OnlineMusicCard } from "@/components/cards/online-music-card";
import { TrackRow } from "@/components/cards/track-row";
import { usePlayerStore } from "@/stores/player-store";
import type { OnlineMusicItem } from "@/types/api";
import { onlineItemToPlayerTrack } from "@/types/player";

const mocks = vi.hoisted(() => ({ saveAlbum: vi.fn().mockResolvedValue({}), addToQueue: vi.fn() }));
vi.mock("@/services/music-api", () => ({ addUnifiedAlbumToLibrary: mocks.saveAlbum }));
vi.mock("@/components/ui/toast", () => ({ toast: vi.fn() }));
vi.mock("@/components/menus/track-actions-menu", () => ({
  TrackActionsMenu: () => <button type="button" onClick={mocks.addToQueue}>Track actions</button>,
}));

const item: OnlineMusicItem = {
  source: "youtube", kind: "song", id: "first", title: "First song", subtitle: "Test artist",
  artists: [], album: null, thumbnail: "data:image/png;base64,AA==", duration_seconds: 60,
  explicit: false, playable: true, browse_id: null, playlist_id: null, endpoint: null,
  url: "https://music.youtube.com/watch?v=first",
};
const nextItem: OnlineMusicItem = { ...item, id: "next", title: "Next song" };

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

describe("playback cards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlayerStore.setState({ currentSong: null, isPlaying: false, queue: [], originalQueue: [], playbackRequestId: 0 });
  });
  afterEach(cleanup);

  it("plays and pauses a row without resetting the remaining queue", () => {
    render(<TrackRow track={onlineItemToPlayerTrack(item)} context={[item, nextItem].map(onlineItemToPlayerTrack)} />);
    fireEvent.click(screen.getByRole("button", { name: `Play ${item.title}` }));
    expect(usePlayerStore.getState()).toMatchObject({ isPlaying: true, playbackRequestId: 1, currentSong: { id: "youtube:first" }, queue: [{ id: "youtube:next" }] });
    fireEvent.click(screen.getByRole("button", { name: `Pause ${item.title}` }));
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: `Play ${item.title}` }));
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    expect(usePlayerStore.getState().playbackRequestId).toBe(1);
  });

  it("does not trigger playback when a row action is clicked", () => {
    render(<TrackRow track={onlineItemToPlayerTrack(item)} />);
    fireEvent.click(screen.getByRole("button", { name: "Track actions" }));
    expect(mocks.addToQueue).toHaveBeenCalledOnce();
    expect(usePlayerStore.getState().currentSong).toBeNull();
  });

  it.each(["row", "tile"] as const)("plays online %s cards without double-toggling", (variant) => {
    render(<MemoryRouter><OnlineMusicCard item={item} context={[item, nextItem]} variant={variant} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: `Play ${item.title}` }));
    expect(usePlayerStore.getState()).toMatchObject({ isPlaying: true, playbackRequestId: 1, queue: [{ id: "youtube:next" }] });
    fireEvent.click(screen.getByRole("button", { name: "Track actions" }));
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: `Pause ${item.title}` }));
    expect(usePlayerStore.getState().isPlaying).toBe(false);
  });

  it("opens album cards while keeping their save action independent", async () => {
    const album: OnlineMusicItem = { ...item, kind: "album", playable: false, browse_id: "album-id" };
    render(<MemoryRouter><OnlineMusicCard item={album} /><Location /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "In library" })).toBeDisabled());
    expect(mocks.saveAlbum).toHaveBeenCalledWith("album-id");
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
    fireEvent.click(screen.getByText(item.title));
    expect(screen.getByTestId("location")).toHaveTextContent("/albums/album-id");
    expect(usePlayerStore.getState().currentSong).toBeNull();
  });

  it("navigates artist and album links without starting playback", () => {
    const linkedItem: OnlineMusicItem = {
      ...item,
      artists: [{ id: "artist-id", name: "Test artist" }],
      album: { id: "album-id", name: "Test album" },
    };
    render(<MemoryRouter><TrackRow track={onlineItemToPlayerTrack(linkedItem)} /><Location /></MemoryRouter>);
    fireEvent.click(screen.getByRole("link", { name: "Test artist" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/library/artists/online/artist-id");
    fireEvent.click(screen.getByRole("link", { name: "Test album" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/albums/album-id");
    expect(usePlayerStore.getState().currentSong).toBeNull();
  });

  it("does not link the displayed artist to a different credited artist", () => {
    const creditedItem: OnlineMusicItem = {
      ...item,
      artists: [{ id: null, name: "Primary artist" }, { id: "other-id", name: "Other artist" }],
    };
    render(<MemoryRouter><TrackRow track={onlineItemToPlayerTrack(creditedItem)} /></MemoryRouter>);
    expect(screen.getByText("Primary artist")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Primary artist" })).not.toBeInTheDocument();
  });

  it("keeps an album card's artist link independent from opening the album", () => {
    const album: OnlineMusicItem = {
      ...item, kind: "album", playable: false, browse_id: "album-id",
      artists: [{ id: "artist-id", name: "Test artist" }],
    };
    render(<MemoryRouter><OnlineMusicCard item={album} /><Location /></MemoryRouter>);
    fireEvent.click(screen.getByRole("link", { name: "Test artist" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/library/artists/online/artist-id");
    fireEvent.click(screen.getByText(item.title));
    expect(screen.getByTestId("location")).toHaveTextContent("/albums/album-id");
    expect(usePlayerStore.getState().currentSong).toBeNull();
  });

  it("exposes separate accessible playback and action buttons", async () => {
    const { container } = render(<MemoryRouter><OnlineMusicCard item={item} /><TrackRow track={onlineItemToPlayerTrack(nextItem)} /></MemoryRouter>);
    expect(container.querySelector("button button")).toBeNull();
    expect((await axe(container)).violations).toEqual([]);
  });
});

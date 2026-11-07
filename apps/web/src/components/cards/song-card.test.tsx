import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { SongCard } from "@/components/cards/song-card";
import { song } from "@/test/music-fixtures";
vi.mock("@/services/music-api", () => ({ toggleFavorite: vi.fn(async () => ({ is_favorited: true })) }));
vi.mock("@/components/ui/toast", () => ({ toast: vi.fn() }));
vi.mock("@/components/cards/track-row", () => ({ TrackRow: ({ isFavorited, onToggleFavorite }: { isFavorited: boolean; onToggleFavorite: () => void }) => <button aria-pressed={isFavorited} onClick={onToggleFavorite}>Heart</button> }));
afterEach(cleanup);
it("updates a heart inside a privately loaded collection and follows refreshed props", async () => {
  const client = new QueryClient();
  const view = (item: ReturnType<typeof song>) => <QueryClientProvider client={client}><MemoryRouter><SongCard song={item} /></MemoryRouter></QueryClientProvider>;
  const { rerender } = render(view(song()));
  fireEvent.click(screen.getByRole("button", { name: "Heart" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Heart" })).toHaveAttribute("aria-pressed", "true"));
  rerender(view({ ...song(), is_favorited: false }));
  expect(screen.getByRole("button", { name: "Heart" })).toHaveAttribute("aria-pressed", "false");
});

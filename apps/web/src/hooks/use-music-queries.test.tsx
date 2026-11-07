import { musicKeys } from "@/services/music-keys";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCreatePlaylist, useToggleFavorite } from "@/hooks/use-music-queries";
import { playlist } from "@/test/music-fixtures";
vi.mock("@/services/music-api", () => ({ createPlaylist: vi.fn(async () => playlist()), toggleFavorite: vi.fn(async () => ({ is_favorited: true })) }));
afterEach(cleanup);
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}
describe("collection cache consistency", () => {
  it("refreshes playlists even with a caller success callback", async () => {
    const { client, wrapper } = setup();
    client.setQueryData(musicKeys.playlistsAll(), []);
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useCreatePlaylist({ onSuccess }), { wrapper });
    await act(() => result.current.mutateAsync({ name: "Playlist" }));
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(client.getQueryState(musicKeys.playlistsAll())?.isInvalidated).toBe(true);
  });
  it("invalidates favorites and song lists when a heart changes", async () => {
    const { client, wrapper } = setup();
    client.setQueryData(musicKeys.favorites(), { songs: [] });
    client.setQueryData(musicKeys.songsAll(), []);
    const { result } = renderHook(() => useToggleFavorite(), { wrapper });
    await act(() => result.current.mutateAsync({ entity_type: "song", entity_id: 1 }));
    await waitFor(() => expect(client.getQueryState(musicKeys.favorites())?.isInvalidated).toBe(true));
    expect(client.getQueryState(musicKeys.songsAll())?.isInvalidated).toBe(true);
  });
});

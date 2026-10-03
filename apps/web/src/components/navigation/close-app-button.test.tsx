import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CloseAppButton } from "@/components/navigation/close-app-button";
import { useAppLifecycleStore } from "@/stores/app-lifecycle-store";
import { usePlayerStore } from "@/stores/player-store";

const mocks = vi.hoisted(() => ({
  apiPost: vi.fn(), pause: vi.fn(), cancelQueries: vi.fn(), toast: vi.fn(),
}));
vi.mock("@/services/api-client", () => ({ apiPost: mocks.apiPost, cachedArtworkUrl: (value: string | null) => value }));
vi.mock("@/services/audio-service", () => ({ audioService: { pause: mocks.pause } }));
vi.mock("@/lib/query-client", () => ({ queryClient: { cancelQueries: mocks.cancelQueries } }));
vi.mock("@/components/ui/toast", () => ({ toast: mocks.toast }));

describe("CloseAppButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiPost.mockReset().mockResolvedValue({ status: "shutting_down" });
    mocks.cancelQueries.mockResolvedValue(undefined);
    useAppLifecycleStore.setState({ isClosed: false });
    usePlayerStore.setState({ isPlaying: true });
  });
  afterEach(cleanup);

  it("stops playback and closes the interface after shutdown is acknowledged", async () => {
    render(<CloseAppButton />);
    fireEvent.click(screen.getByRole("button", { name: "Close app" }));
    await waitFor(() => expect(useAppLifecycleStore.getState().isClosed).toBe(true));
    expect(mocks.apiPost).toHaveBeenCalledWith("/app/shutdown");
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    expect(mocks.pause).toHaveBeenCalledOnce();
    expect(mocks.cancelQueries).toHaveBeenCalledOnce();
  });

  it("keeps the app usable and allows retry when shutdown fails", async () => {
    mocks.apiPost.mockRejectedValueOnce(new Error("Native launcher is unavailable"));
    render(<CloseAppButton />);
    fireEvent.click(screen.getByRole("button", { name: "Close app" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("Native launcher is unavailable", "error"));
    expect(useAppLifecycleStore.getState().isClosed).toBe(false);
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    expect(mocks.pause).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Close app" })).toBeEnabled();
  });
});

import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AppUpdateControls } from "@/features/updates/app-update-controls";
import { useAppUpdateUi } from "@/features/updates/use-app-updates";
import { queryClient } from "@/lib/query-client";
import { usePlayerStore } from "@/stores/player-store";

const mocks = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), pause: vi.fn() }));
vi.mock("@/services/api-client", () => ({ apiGet: mocks.apiGet, apiPost: mocks.apiPost }));
vi.mock("@/services/audio-service", () => ({ audioService: { pause: mocks.pause } }));
const idle = { supported: true, state: "idle", message: "Check for updates", current_version: "1.0.0" };
const key = ["app", "updates"];
function mount() { return render(<QueryClientProvider client={queryClient}><AppUpdateControls /></QueryClientProvider>); }
beforeEach(() => {
  vi.clearAllMocks(); queryClient.clear();
  mocks.apiPost.mockReset();
  mocks.apiGet.mockResolvedValue(idle);
  useAppUpdateUi.setState({ requesting: null, installing: false, error: null });
  usePlayerStore.setState({ isPlaying: true });
});
afterEach(() => { cleanup(); queryClient.clear(); vi.useRealTimers(); });

it("uses one button that changes from checking to installing, without a popup", async () => {
  mocks.apiPost.mockResolvedValueOnce({ ...idle, state: "checking" }).mockResolvedValueOnce({ ...idle, state: "downloading" });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Check for app updates" }));
  await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/app/updates/check"));
  await waitFor(() => expect(useAppUpdateUi.getState().requesting).toBeNull());
  expect(mocks.pause).not.toHaveBeenCalled();
  act(() => queryClient.setQueryData(key, { ...idle, state: "available", message: "An update is ready" }));
  const button = await screen.findByRole("button", { name: "Install app update and restart" });
  expect(screen.getAllByRole("button")).toHaveLength(1);
  fireEvent.click(button);
  await waitFor(() => expect(mocks.apiPost).toHaveBeenLastCalledWith("/app/updates/install"));
  await waitFor(() => expect(mocks.pause).toHaveBeenCalledOnce());
  expect(usePlayerStore.getState().isPlaying).toBe(false);
  expect(screen.getByRole("progressbar", { name: "App update progress" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("keeps playback and a retry button when installation is rejected", async () => {
  queryClient.setQueryData(key, { ...idle, state: "available" });
  mocks.apiPost.mockRejectedValueOnce(new Error("Finish the storage move first"));
  mount(); fireEvent.click(screen.getByRole("button", { name: "Install app update and restart" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Finish the storage move first" })).toBeEnabled());
  expect(mocks.pause).not.toHaveBeenCalled();
  expect(usePlayerStore.getState().isPlaying).toBe(true);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("prevents repeated requests while checking", async () => {
  mocks.apiPost.mockReturnValue(new Promise(() => {}));
  mount(); const button = screen.getByRole("button", { name: "Check for app updates" });
  fireEvent.click(button); fireEvent.click(button);
  expect(mocks.apiPost).toHaveBeenCalledTimes(1);
  expect(button).toBeDisabled();
});

it("does not offer in-container replacement to Docker installations", async () => {
  queryClient.setQueryData(key, { ...idle, supported: false, state: "unsupported" });
  mount();
  expect(screen.getByRole("button", { name: "Docker updates use Docker Compose" })).toBeDisabled();
  expect(mocks.apiPost).not.toHaveBeenCalled();
});

it("returns the up-to-date tick to refresh after 6.5 seconds", () => {
  vi.useFakeTimers();
  queryClient.setQueryData(key, { ...idle, state: "current", updated_at: 1 });
  mount();
  expect(screen.getByRole("button", { name: "Up to date. Check again" })).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(6499));
  expect(screen.getByRole("button", { name: "Up to date. Check again" })).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(2));
  expect(screen.getByRole("button", { name: "Check for app updates" })).toBeInTheDocument();
});

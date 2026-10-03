import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { playbackStatusLabel, useDelayedPlaybackStatus } from "@/hooks/use-delayed-playback-status";
import type { PlaybackStatus } from "@/stores/player-store";

describe("useDelayedPlaybackStatus", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("suppresses brief playback waits without restarting the delay between busy states", () => {
    const initialProps: { status: PlaybackStatus } = { status: "loading" };
    const { result, rerender } = renderHook(
      ({ status }) => useDelayedPlaybackStatus(status, 650),
      { initialProps },
    );

    act(() => vi.advanceTimersByTime(500));
    expect(result.current).toBeNull();

    rerender({ status: "buffering" });
    act(() => vi.advanceTimersByTime(150));
    expect(result.current).toBe("buffering");

    rerender({ status: "playing" });
    expect(result.current).toBeNull();
  });

  it("shows errors immediately and provides concise status labels", () => {
    const { result } = renderHook(() => useDelayedPlaybackStatus("error"));

    expect(result.current).toBe("error");
    expect(playbackStatusLabel("error", "The stream expired")).toBe("The stream expired");
    expect(playbackStatusLabel("loading", null, 1)).toBe("Loading audio… · retry 1");
  });
});

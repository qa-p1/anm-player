import { beforeEach, describe, expect, it } from "vitest";

import { useLyricsPreferencesStore } from "@/stores/lyrics-preferences-store";

describe("lyrics preferences", () => {
  beforeEach(() => {
    useLyricsPreferencesStore.setState({ offsets: {}, autoScroll: true, fontSize: "normal" });
  });

  it("rounds and clamps per-track timing offsets", () => {
    const preferences = useLyricsPreferencesStore.getState();
    preferences.setOffset("local:1", 2.26);
    preferences.adjustOffset("local:1", 100);
    preferences.setOffset("local:2", Number.NaN);

    expect(useLyricsPreferencesStore.getState().offsets).toEqual({
      "local:1": 30,
      "local:2": 0,
    });

    useLyricsPreferencesStore.getState().resetOffset("local:1");
    expect(useLyricsPreferencesStore.getState().offsets).toEqual({ "local:2": 0 });
  });

  it("cycles all display sizes and stores auto-scroll preference", () => {
    const preferences = useLyricsPreferencesStore.getState();
    preferences.setAutoScroll(false);
    preferences.cycleFontSize();
    expect(useLyricsPreferencesStore.getState()).toMatchObject({ autoScroll: false, fontSize: "large" });

    useLyricsPreferencesStore.getState().cycleFontSize();
    useLyricsPreferencesStore.getState().cycleFontSize();
    expect(useLyricsPreferencesStore.getState().fontSize).toBe("normal");
  });
});

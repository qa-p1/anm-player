import type { PointerEvent } from "react";

import { prepareStream } from "@/services/music-api";
import type { PlayerTrack } from "@/types/player";

/**
 * Looking up a stream link takes about a second. Doing it while the pointer
 * rests on a song (or before the next song starts) makes Play feel instant.
 */
const HOVER_INTENT_MS = 150;
const REMEMBER_MS = 20 * 60 * 1000;
const prepared = new Map<string, number>();
const timers = new WeakMap<EventTarget, number>();

export function prepareTrack(track: PlayerTrack | null | undefined, download = false) {
  if (track?.source !== "youtube") return;
  const key = `${track.videoId}:${download}`;
  const now = Date.now();
  if ((prepared.get(key) ?? 0) > now - REMEMBER_MS) return;
  prepared.set(key, now);
  if (prepared.size > 200) prepared.delete(prepared.keys().next().value!);
  void prepareStream(track.videoId, download).catch(() => prepared.delete(key));
}

/** Pointer handlers for a play button; touch has no hover, so it's skipped. */
export function prepareOnHover(track: PlayerTrack | null | undefined) {
  if (track?.source !== "youtube") return {};
  return {
    onPointerEnter(event: PointerEvent) {
      if (event.pointerType === "touch") return;
      const target = event.currentTarget;
      timers.set(target, window.setTimeout(() => prepareTrack(track), HOVER_INTENT_MS));
    },
    onPointerLeave(event: PointerEvent) {
      window.clearTimeout(timers.get(event.currentTarget));
    },
  };
}

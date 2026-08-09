# Changelog

## 0.2.0 - 2026-08-09

This release expands ANM Player with 30 standard and advanced music-player capabilities:

1. Buffering, stalled, loading, and playback-error states.
2. One-click retry with optional automatic skip after a failed stream.
3. Related-track autoplay radio when the queue ends.
4. Playback speed control with pitch-preservation support.
5. Configurable keyboard and button seek increments.
6. A ten-band equalizer with named presets and custom gains.
7. Preamp gain control.
8. Stereo balance and mono-downmix controls.
9. Optional dynamics-based volume normalization.
10. Browser audio-output device selection when supported.
11. Timed sleep presets and a custom sleep timer.
12. End-of-track sleep, configurable fade-out, and stop-after-current.
13. Per-track A-B repeat loops.
14. Named, seekable track bookmarks.
15. Expanded Media Session seek-to, seek-step, stop, and position support.
16. A richer mini player with transport controls, scrubbing, and status feedback.
17. Dynamic document titles plus offline and reconnection notices.
18. Searchable queues with track counts and total duration.
19. Drag reordering, play-from-here, move-next, move-last, and removal queue actions.
20. Undo for queue removals, queue deduplication, and queue clearing.
21. Replayable session playback history.
22. Named queue snapshots with restore, delete, and M3U8 export.
23. Playlist name and description editing plus duplication.
24. Mixed local/online playlist drag reordering with dense global ordering.
25. Playlist search, sort, selection, bulk play/queue/remove, and clear actions.
26. Playlist artwork mosaics, sharing, and safe M3U8 export.
27. Editable local lyrics with copy, auto-scroll, font-size, and timing-offset controls.
28. Listening insights for totals, streaks, daily/hourly activity, and top music.
29. Filterable, replayable history with single-entry deletion and guarded clear-all.
30. A shortcut guide, expanded global shortcuts, recent/pinned searches, track sharing, and track details.

Quality work in this release also updates stale test expectations for hardened URL and storage behavior, adds coverage for storage recovery, cache concurrency, WebSockets, downloads, and artwork limits, and refreshes vulnerable development-only transitive dependencies.

## 0.1.0 - 2026-08-01

Initial local-first ANM Player release line.

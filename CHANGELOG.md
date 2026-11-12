# Changelog

## Updates after 1.0.0

These arrive through the in-app update button.

- Setup and the launcher now use the computer's own Python, Node.js and FFmpeg. Anything missing is installed system-wide with the package manager (pacman, apt, dnf, zypper, Homebrew, winget or Chocolatey) instead of downloading private copies. Existing installs drop their private `tools/` folder automatically and keep the library.
- ANM Player appears in the app launcher (Linux app menu, macOS Applications, Windows Start menu) and on the desktop, with the app icon and no terminal window. Launch problems show a notification.
- The app environment is rebuilt automatically if a system Python upgrade breaks it.
- The production web preview no longer defaults to listening on every network interface.
- **Downloads page** replaces the download popup: one overall progress bar, Queue / Downloaded / Failed tabs, albums and playlists grouped with their own progress, pause, resume, cancel and retry for every song (including songs inside albums), plus pause all, resume all, cancel all, retry all and clear. The sidebar entry shows a live progress ring; phones get a floating shortcut while something downloads.
- **Download playlist**: one button downloads every song that isn't offline yet, shows a progress ring while it runs and a check when the whole playlist is offline.
- Songs downloaded from a playlist, the song menu or search now show as offline everywhere they're saved, not only in the album they came from.
- Download progress no longer jumps backwards as songs finish, and the queue uses one light poll instead of a live connection per song.
- The Playlists page uses the same header as Albums and Artists.
- **Quick find** (Ctrl K) was rebuilt: the best match comes first, results are grouped (songs, albums, artists, playlists, pages, commands), saved and downloaded songs play straight away, YouTube Music songs appear as you type, Shift+Enter adds a song to the queue, and it no longer loads your whole library every time it opens.
- **Danger zone** has three choices: erase all data and start fresh (no folder to pick any more), uninstall but keep your music and library for a reinstall, or uninstall and delete everything. Setup can also uninstall from the command line with `bootstrap.py --uninstall [--keep-data]`.
- **Settings, rebuilt**: every change saves instantly (no Save button), grouped sections with a section list, switches, steppers and segmented choices, a storage breakdown with per-cache clearing, and update/close controls under About.
- **Region for Home**: "Trending Albums" and the regional chart follow your country, worked out from your computer's time zone without any network lookup, and changeable in Settings. Trending albums are the newest releases from that country's top artists. Times and Insights always follow your own clock.
- Artist pages show the real artist name, their albums and singles with years, and refresh from YouTube Music instead of keeping a stale copy forever.
- Times are shown in your time zone everywhere (new playlists no longer say "Updated 6 hours ago"), and Insights counts days, hours and streaks by your clock.
- Artwork caching: covers are kept by the browser for 30 days instead of being re-requested, a network blip is retried once instead of leaving a blank cover, failures are never cached, and cache clean-up runs at most once a minute instead of scanning the folder after every image.

## 1.0.0 - 2026-11-11

- Download-and-run setup scripts install private Python, Node, FFmpeg and the app automatically, with a launch shortcut and no global PATH changes.
- One update button beside shutdown checks GitHub, changes to download when an update is available, and shows progress inline while installing and restarting. No update popup.
- Updates build in a separate source folder, preserve library/configuration paths, back up the database and restore the previous app/database if startup fails. Old managed copies and caches are cleaned, keeping one rollback copy and two database backups.
- Artists and Albums library pages now use the collection headers and artwork treatment from the app redesign. Search, filtering, sorting and playback remain available.
- Fixed the compressed Save settings button height.
- Docker remains managed through Compose; the desktop updater does not access the Docker daemon.

## 0.3.0 - 2026-11-08

### Highlights

- **A redesigned app.** Albums, playlists, artists, songs, favorites, smart collections, search, the library home and insights all share one cleaner look: big artwork-tinted headers, a large play button, flat track lists, and covers you can play straight from with a hover.
- **A new mini player.** Slim and tinted by the song's artwork, with a thin seek line on its top edge that shows the time under your pointer, shuffle and repeat, a loading ring, a queue count, and swipe gestures on phones.
- **Song suggestions for playlists.** Every playlist recommends songs that fit what's already in it (or what you play most, for an empty one). Add them with one tap and refresh for more.
- **Custom playlist covers.** Click a playlist's cover to upload your own picture.
- **A cleaner sidebar.** Main pages, a compact library grid, a scrollable playlist list with search, pins, generated covers and a "now playing" marker, and small icons for settings, shortcuts and closing the app.
- **Better insights.** History is grouped by day, filters work across your whole history, and "Load more" keeps going back as far as you like.
- **"More by this artist"** on album pages, a "Latest release" card and sortable discography on artist pages, and a "Jump back in" list on the library page.
- **Artist and album names always open the right page,** even for songs that only came with a name.
- **Song lengths everywhere.** Missing lengths are now looked up, and remembered once a song has played, so lists no longer show dashes.
- **Styled tooltips** replace the browser's default boxes, and obvious labels were removed throughout.
- Remembered grid or list view for albums and playlists, a Favorites tab bar, artist play buttons, disc grouping on albums, explicit badges, and proper confirm dialogs instead of browser pop-ups.

### Fixes

- Playlist cover mosaics no longer leave gaps or repeat the same album art.
- Deleting a playlist also removes it from your pins.
- The full player's bottom buttons are evenly spaced, and unknown song lengths no longer show `0:00` or `-0:00`.
- Docker's web proxy accepts playlist covers up to the app's 10 MB limit. Release checks now upload a cover and verify the playlist and image survive container replacement.
- Local legacy music folders are excluded from Docker images, and the self-hosting guide covers setup, updates, persistent storage and private server access.


### Final codebase polish

- Separated provider transport/models/parsing/presentation/playback/client/cache orchestration, catalog presentation, playlist transactions, and saved-album presentation while retaining HTTP contracts and package exports.
- Shared query identity/invalidation and player transport controls; isolated artwork palette extraction, playlist item/drag rendering, equalizer definitions, and settings/storage contracts. Existing layouts and utility controls remain.
- Album preview requests coalesce in a bounded short-lived cache with independent returned models and cancellation isolation. Album metadata hydration is bounded, download settings are read once per batch, and playlist/status favorite queries are batched.
- Paused downloads yield to storage migration; empty audio files report unavailable consistently. Cached library/history views refresh after related actions and expose recoverable loading/error feedback.
- Pinned the existing Starlette dependency to tested version 1.10.0 for reproducible middleware/test-client behavior and clean warnings-as-errors checks.
- Updated Pillow to 13.0.0 after the runtime dependency audit identified 39 advisories against the existing 12.3.0 pin; image-cache/media behavior is regression tested.
- Added an architecture map and regression coverage for service wiring, import isolation, provider cache lifecycle, query synchronization, transport controls and query budgets.

### Utility and reliability upgrade

- Direct sidebar playlist navigation, search, pins, create action, and library/history shortcuts; correct active navigation on detail routes.
- Quick find (`Ctrl/Cmd K`, or the mobile search button) searches pages, playlists, local songs, and player commands. `/` opens online search; `F` opens the player.
- Shared play-all, shuffle, queue-all, save-as-playlist, and M3U controls on songs, favorites, playlists, and smart collections; song multiselect supports working with just the selection.
- Playlist search and sorting by name, latest update, or track count; album/artist search and sorting, and an album downloaded-only filter.
- Mini-player queue access, lyrics and track seeking; long dialogs scroll within the viewport and page loading preserves navigation/player controls.
- Shared keyboard command definitions drive help and quick find. Shortcuts respect native controls, dialogs, browser modifiers, and IME composition.
- Favorites and playlist edits refresh related views; API query ownership replaces duplicated private collection state. Clearing filters cannot leave the library stuck loading.
- Search query/filter state follows URLs and navigation; cancelled pagination cannot append stale results to a new search. Search fields have clear actions.
- Saving repeated queue entries no longer aborts playlist creation. Saved queues support a lone current track. Collection exports use playable app stream URLs and sanitize metadata.
- Damaged stored player/pin data recovers safely; empty-player playback, fractional queue indices, hidden playlist filters, filtered selections, nested Escape handlers, and near-hour duration summaries are guarded.
- Recently played ranks the full history before limiting; history timestamp ties paginate consistently. Playlist names share validation and content edits update modification times. Duplicate/missing-source imported tracks cannot strand download jobs.
- Patched vulnerable serialization, Vite, Undici, Zod, and selector-parser dependencies within supported version ranges; production audit is clean and no high/critical development advisories remain.
- Removed existing Dependabot branches and disabled new version-update pull requests. Security alerts remain enabled.

### Changed

- The Docker API image runs Python 3.14.7 (CI now tests 3.13 and 3.14) and the web image runs nginx 1.31.5.
- Frontend toolchain: Vite 8 (Rolldown; production builds about 3x faster), @vitejs/plugin-react 6, TypeScript 6.0, vitest 5, jsdom 30, knip 6, framer-motion 14, React 19.3, and current minor releases. Screenshots of every main screen and the player match the previous release apart from data.
- Dependencies updated: lucide-react 1.x, @testing-library/jest-dom 7, jest-axe 11, typescript-eslint 8.67, SQLAlchemy 2.0.52, pydantic-settings 2.15, ruff 0.16, and others. Ruff's rule set is now pinned in `ruff.toml`.
- CI audits shipped npm dependencies at `high` and the full tree at `critical`; Dependabot groups minor and patch updates.

### Added

- **Download Database Backup** in Settings: a consistent snapshot of the library database taken with SQLite's online backup API while ANM Player keeps running (`GET /api/v1/settings/backup`).
- **Retry failed** in the download queue requeues every failed download at once (`POST /api/v1/downloads/retry-failed`).

### Fixed

- Downloads interrupted by a crash, restart, or Ctrl+C are returned to the queue on startup instead of staying "downloading" forever, blocking the concurrency limit and re-queueing. Resuming a download paused before a restart now requeues it.
- Saving lyrics no longer writes an ID3 header into M4A, FLAC, Opus, or Ogg files, which made them unreadable to the library scanner; embedded lyrics in those formats are now read too.
- Adding several songs to a playlist in one request no longer always fails with a conflict.
- Re-importing a YouTube Music playlist creates "Name (2)" instead of failing; the playlist list refreshes after an import.
- The Content-Security-Policy and other security headers are now sent with the app shell and its assets, not only API responses.
- Picking a track from a list with shuffle on now shuffles the whole list.
- The download queue summary distinguishes failed from completed downloads.
- Removing a single playlist item now closes the gap in positions, as bulk removal already did.

### Performance

- Playback progress no longer re-renders the whole app several times per second, and player state is persisted at most once per second.
- The 30-second background library sync no longer rewrites every track row when nothing changed, and logs only when it changes something.
- Resolved YouTube stream URLs are reused while valid, so seeking during a first listen no longer re-resolves the stream.
- The download list polls every 2 seconds only while a download is active.

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

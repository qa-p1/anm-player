# Codebase map

ANM Player has one operator, one managed SQLite library and one playback session. API routes remain under `/api/v1`; the web client uses the same-origin authenticated proxy. The refactor preserves the database models, migrations, request/response schemas and HTTP routes.

## Backend

- `app/api/deps.py` composes request-scoped services from a database session; routes import their actual service owners. Authentication stays at the route/router boundary.
- `app/repositories/music.py` owns catalog queries, playlist link positions and batched favorite membership. Models define persisted relationships and constraints.
- `app/services/catalog.py` handles local song/artist/album queries, favorites and history. `catalog_presenter.py` constructs responses with batched favorite and album identity lookups.
- `app/services/playlists.py` owns mixed playlist membership, transactional reordering/removal/duplication and M3U export. Playlist changes use the existing collision-safe temporary-position protocol.
- `app/services/library_albums.py` owns saved-album persistence, playlist imports, provider metadata hydration, download scheduling and file lifecycle. `library_presenter.py` owns saved/unified album and track presentation. Favorites and playlist responses use that same presenter rather than another service's private methods.
- `app/services/file_paths.py` owns managed music path operations and nonempty downloaded-file availability. All path containment remains enforced by `app/storage/paths.py`.
- `app/services/ytmusic_service/models.py` defines provider data, `transport.py` handles InnerTube configuration/requests, `parsing.py` navigates renderers, `presentation.py` maps provider data into app responses, `playback.py` selects/validates audio formats, `client.py` composes provider calls/fallbacks, and `service.py` owns application orchestration and bounded caches.
- Service package exports load lazily. Importing a pure provider helper or catalog service does not instantiate unrelated provider clients.
- `app/workers/downloads/worker.py` retains download acquisition, cancellation, staging/publication and postprocessing. `app/services/download_state.py` owns job ownership and linked album progress reconciliation.
- `app/storage/coordinator.py`, middleware and state store retain the migration/reset/recovery transaction. File publication, stream range validation, storage quiescence and rollback remain explicit.
- Artwork/stream/lyrics caches, metadata enrichment, tagging and scanning retain their existing domain owners. Their limits, safe publication and recovery paths were not replaced with generic infrastructure.

## Frontend

- `services/music-api.ts` owns typed HTTP operations, pagination and bounded status batching. `services/music-keys.ts` owns query identity without importing React.
- `services/music-invalidation.ts` defines which cached views change together after library, playlist or history edits. Hooks and action producers use those boundaries.
- `hooks/use-music-queries.ts` owns collection queries and reusable mutations. Artist detail, smart collections, library overview and insights now use the same cache/cancellation model instead of maintaining parallel request state.
- `features/player/playback-controls.ts` owns transport intent: play/pause/retry, previous/next and bounded seek. Mini/full players, keyboard commands and Media Session handlers share those actions.
- `services/audio-service.ts` owns the actual media element and Web Audio lifecycle. Stable equalizer types, frequencies and presets live in `types/audio.ts`, independently of persisted UI preferences.
- `hooks/use-audio-player.ts` coordinates source lifecycle, history, recovery, media events, repeat/autoplay and timers. The player store retains queue/playback state transitions and persistence.
- `hooks/use-artwork-palette.ts` owns image sampling, color extraction, cancellation and its bounded cache; full-screen player markup only consumes its palette.
- `features/playlists/playlist-model.ts` owns playlist item identity/conversion/order. `playlist-track-list.tsx` owns drag/selection rendering. The detail page coordinates requests and page actions.
- `types/settings.ts` is the shared settings/storage operation contract for Settings and the migration overlay.
- Navigation, quick find, collection utilities and player controls introduced earlier remain available. UI polishing is limited to clearer loading/error/retry feedback and consistent action behavior.

## Changing the app safely

Change response adapters in the presenter that owns the entity, not by copying serialization into a second service. Keep playlist ordering/file publication atomic. Add a query key and the relevant invalidation boundary when introducing a cached view. Add player transport behavior to the shared controls so keyboard, mini/full player and Media Session remain aligned.

Useful verification commands are in README.md. `final-polish-verification.md` records this run's exact results and limits; `final-untangle-decisions.md` and `provider-untangle.md` record why the boundaries changed.

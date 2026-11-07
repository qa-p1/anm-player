# Final whole-codebase untangle

Recovery: `checkpoint/pre-final-polish-2026-11-07` (`78a785f`). Starting source: `a8282eb`. Prior utility work remains in place. Both optional skill cleanups were already authorized; remove code only with established replacement/use evidence.

## Backend domain boundaries

Separate provider models, renderer parsing, HTTP transport, stream-format selection, and cache orchestration. The provider service combines all five and repeats sync/async web-configuration decoding. See provider-untangle.md for the detailed audit.

Separate catalog response building from playlist transactions and catalog queries. CatalogService contains unrelated playlist reorder/export/write workflows, repeated serialization, favorites, history and song/artist reads. Playlist routes need only the playlist domain, but currently construct six repositories. Favorites calls private library-service serializers, hiding a cross-domain dependency.

Separate saved-album presentation from mutation/file lifecycle. LibraryAlbumService constructs unified/legacy response shapes, manages files, schedules downloads, imports playlists and hydrates provider metadata. Presentation and mutation should share response/availability rules without calling each other's private methods. Catalog/library serializers repeat track metadata/artwork fallbacks, and have inconsistent empty-file availability checks.

## Frontend domain boundaries

Keep the UI layout and controls. Move artwork color extraction out of the full-screen transport view; it is independent image processing with its own cache and cancellation lifecycle.

Move immutable audio settings/frequency types out of the persisted preferences store so the audio engine does not import the UI's volatile persistence implementation. Extract the Web Audio graph only if it can own its full lifecycle without exposing nodes or adding forwarding wrappers.

Make remaining collection/history query ownership explicit. Smart collections, artist detail, insights and the library overview duplicate manual request/loading/cancellation state and can miss invalidation from actions elsewhere. Share query keys and mutations without invalidating high-frequency/unrelated provider requests.

Separate playlist ordering/item identity from its page/drag rendering. Shared conversions and query invalidations should be defined once; keep backend ordering transactional and the visible UI unchanged.

## Whole-project audit coverage and conservative retention

Review API routes/schema/auth, repositories/models/migrations, scanner/file publication, worker/download state, metadata/lyrics/artwork/stream caches, storage migrations/reset, launcher/process lifecycle, client API/playback/stores, every page/navigation/dialog, build/container/release configuration and tests.

Keep authentication gates, stream-range validation, cancellation ownership, managed path containment, staging/rollback, storage quiescence and crash-recovery state machines. They encode externally observable safety/recovery requirements, not removable special cases. Keep backwards-compatible HTTP aliases. Do not split long transactional algorithms solely to reduce file length or replace cohesive code with mixins.

Run existing behavior tests before/after each domain change; retain useful regression tests, adapt ownership-coupled imports only when code moves, and add tests for actual changed edge behavior. Record retained complexity and final verification limits.

## Implemented and checked

- Catalog queries/favorites/history, playlist transactions and catalog response building now have separate owners. Dependency factories accept one session; API routes preserve their request/response contracts. Library presentation is shared with catalog favorites and playlists.
- Batched favorite membership lives in FavoriteRepository. Mixed playlist detail builds each saved-track response once, batches its favorite lookup, and preserves actual library membership. A 30-track regression limits database queries to a fixed small budget. Album status checks batch favorites too.
- Download availability shares managed-path/nonempty-file checks. A regression covers empty audio files consistently in song and playlist views.
- Album jobs read shared runtime settings once per batch. Missing-duration hydration permits at most four concurrent provider lookups; the provider's bounded short-lived preview cache coalesces repeat requests, returns independent copies and does not cache failures.
- The paused download loop checks migration cancellation on every wakeup, avoiding blocked storage quiescence. Existing publication/rollback and download ownership protocols remain intact.
- Service compatibility exports are lazy; a fresh-process regression verifies pure playback and catalog imports do not initialize provider clients. Existing provider/service package export names remain available.
- Query identity and invalidation have explicit shared owners. Library/artist/smart/history/insights views use query-owned loading/cancellation, with retries for recoverable failures. Playback history refreshes history-derived views together; download completion, album edits, enrichment and manual sync refresh affected library views.
- Player controls share retry, previous/next and bounded seek semantics across mini/full players, commands and Media Session. Equalizer definitions, artwork palette lifecycle and playlist item/drag rendering have separate stable owners.
- Settings and storage overlay use one typed contract. Existing page layouts/controls remain; UI changes add only restrained loading/error/retry feedback.

## Removal evidence and deliberately retained complexity

Removed renderer/config duplicates with replacement implementations; removed the unused artist-search method and unused/unimplemented SearchFilters fields only after checking all application/test callers. Kept tested album-search behavior, public HTTP aliases, provider compatibility aliases and useful regression tests. Removed restating comments from scanner, metadata, search and client modules; retained comments explaining provider/browser/storage/transaction constraints. One provider test was rewritten to assert assembly behavior rather than patch an unrelated client.

Reviewed route/auth/schema/model/migration wiring; repository and response query budgets; scanning/tagging/metadata/lyrics; worker/download/stream/artwork caching; storage move/reset/recovery; launcher and container/release configuration; client transport/stores/query cancellation; home/search/library/settings/insights; and navigation/player/queue/lyrics/dialog behavior. Not every reviewed module needed edits.

Kept the Web Audio graph with the media-element lifecycle: splitting it further would expose nodes or add forwarding methods. Kept storage migration/reset and file publication algorithms together because their lock/transaction/rollback ordering is one requirement. Retained provider-specific fallbacks and byte/range checks because they reflect upstream behavior. No new database migration, additional runtime dependency, feature redesign or persisted shell/environment change was introduced. The final dependency audit required updating the existing Pillow pin to 13.0.0. Starlette, already used by the app through FastAPI and direct middleware imports, is explicitly pinned to the tested 1.10.0 version so fresh and existing environments use the same compatible test-client/middleware implementation. Artwork/media and full backend checks run against those versions in an isolated environment.

Follow-up review found cache invalidation gaps and one missing presenter reference; these were corrected before final checks. A Python 3.14 shared-task cancellation warning was eliminated with per-listener waiting and a regression for a later provider failure. Final module ownership is documented in architecture.md.

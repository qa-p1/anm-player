# YouTube Music provider boundaries

## Audit and design

- `service.py` mixes transport configuration/requests, provider renderer parsing, application-schema mapping, direct stream selection, yt-dlp fallback, and cache/home orchestration in one 1,868-line module. A parser-only change requires reading networking and playback details.
- `playback.py` currently imports its whole implementation from `service.py`, so a low-level stream validator depends on the orchestration service and instantiates its global clients on import.
- Sync and async web-config loading independently decode the same HTML configuration and update the same session fields; they have already drifted in version fallback behavior.
- Tests import pure parser and provider model symbols through the orchestration module, hiding the actual responsibility they exercise.

Use explicit, one-way boundaries: `models` owns provider results; `transport` owns client configuration and InnerTube HTTP; `parsing` owns renderer navigation; `presentation` maps parsed provider data into app responses; `playback` owns format selection/range validation; `client` composes requests/parsing and playback fallback; `service` owns caches and application orchestration. Keep public package exports unchanged. Pure helpers move to functions, not mixin classes or delegating wrappers.

Preserve endpoint shapes, Home section IDs/order, regional selection and fallback rules, cache durations/bounds, quality ordering, direct-stream validation spans, headers and yt-dlp fallback. Preserve provider-specific comments where they document upstream constraints.

## Implemented

- Public package imports remain `SEARCH_FILTERS`, `PlaybackData`, `YouTubeMusicClient`, `YouTubeMusicService`, and `ytmusic_service`; imports now name their actual owning modules.
- `playback.py` implements format choice, signature decoding and stream validation itself; it no longer imports orchestration.
- `service.py` retains request orchestration and cache policy; the provider client, transport, renderer parser, data models and app response mapping have explicit separate owners. Shared parser helpers have public names rather than callers importing private service methods.
- Removed duplicate browse/playlist endpoint readers and the pass-through album-thumbnail helper. Removed unused signature-timestamp/PO-token configuration flags after confirming no readers or nondefault values. Kept the existing documented India-client alias rather than guessing whether compatibility could be removed.
- Sync and async config loading use one decoder; async now has the same provider-version fallback as sync. Cancellation still propagates without caching a fallback.
- Album previews have a 120-second, 128-entry cache. Concurrent same-ID requests share a single provider browse; canceled listeners cannot cancel other listeners; failures are not cached; callers receive deep copies. This makes repeat missing-duration hydration use a recent successful browse, including responses whose durations remain unavailable.

## Verification

- AST comparison with `checkpoint/pre-final-polish-2026-11-07` found 105 function bodies unchanged after the intended helper renaming and pure-method extraction. Only old config-loading functions, the service constructor and `album()` changed behavior; dedicated tests cover those paths.
- 65 focused provider, playback-source, download-stream and lyrics tests passed.
- New regression coverage: sync/async transport configuration and locale parity, provider-version fallback, cancellation, quality selection and later-range validation, concurrent preview coalescing, cache expiry/bounds, failure retry and copy isolation.
- Replaced a home-assembly test that patched an unrelated client with a direct pure-assembly behavior assertion. Existing parsing, cache, home-fallback and duration regressions remain.
- Ruff and whitespace checks pass for this domain.

## Read-only neighboring-domain review

- Reported paused-download migration cancellation not being rechecked inside the pause wait loop; parent fixes the worker's control flow.
- Stream caching already has active-key deduplication, bounded fetch slots, byte/budget limits and safe publication. Retained this design rather than introduce speculative concurrency changes.
- Found and reported one missing LibraryPresenter method reference during the catalog/library extraction. No other missing service-to-presenter links were found by an AST attribute check.

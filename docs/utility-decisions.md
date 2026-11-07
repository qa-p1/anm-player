# Utility and structure decisions

Recovery: `checkpoint/pre-utility-2026-11-07` (`85a2c68`). Existing 66 web tests passed before changes. Runtime library/cache files remain private and untouched.

## Put navigation and playback commands in shared registries
- Sidebar has no direct playlist selection or quick links to favorites, songs or history.
- Library descendants do not highlight Library in navigation.
- Shortcut help duplicates shortcut behavior, and shortcuts intercept buttons, selects, browser modifiers and dialogs.
- App has no universal find/jump action usable on mobile and desktop.

## Use query-owned collections and mutation invalidation
- Mutation options overwrite required onSuccess invalidations.
- Playlist detail/favorites keep private fetch state disconnected from edits elsewhere.
- Playlist changes leave counts and sidebar names stale; local-track adds bypass invalidation.
- Song favorites duplicate prop state and drift after refetches.

## Share track collection operations
- Queue exports implement their own URL/filename conventions.
- Bulk queueing emits one store/persistence update per song.
- Songs lack play-all, shuffle, queue-all, export and multiselect actions.
- Favorites lack search and playback as a single collection; playlists lack find/sort.
- Playlist shuffle uses biased random comparator; filtered selection selects invisible items.
- Queue snapshots cannot save a lone currently playing track from their UI.

## Preserve native controls and bounded overlays
- Global keyboard listeners must respect native interactive controls and editable ancestors.
- Long dialogs need viewport bounds and scrolling on small displays.
- Route loading should leave navigation/player mounted.

## Verification
Add behavior regressions for shared commands, collection operations, query invalidation, navigation and collection screens. Run web lint/typecheck/tests/build/bundle and backend tests. Review findings before final commit and push.

## Review corrections
- Keep quick-find Enter/arrow handling on its input so native result/Close buttons own activation; ignore composing keystrokes.
- Deduplicate playlist insertions by stable track identity while preserving mixed source order.
- Keep active sidebar filter visible even when playlist count drops below the usual filter threshold.
- Invalidate favorite snapshots after artist/album/player favorites and playlist metadata/content/deletion changes.
- Use one collection toolbar for playlist transport/export instead of duplicated header controls.
- Recover current-version corrupt saved player/pin data at merge, preserving store methods and paused restore.
- Include library pins in fresh-start cleanup, so reused playlist IDs do not inherit pins.
- Export app stream endpoints rather than HTML watch pages; sharing retains provider URLs.

Existing tests were retained: no inspected test was redundant enough to justify deleting its regression coverage. Removed implementation-restating comments in touched modules; preserved explanations for external behavior and transactional requirements.

## Final consistency checks
- Full-screen hearts now read the live favorites query, rather than stale player-track snapshots; a close/reopen regression test covers this.
- Song cards synchronize refreshed props while retaining immediate mutation feedback for privately fetched artist collections.
- Batched status lookups live in the API client domain; Home no longer owns its own 200-ID splitting convention, and paginated Search inherits the same protection.
- Targeted dependency patches remove production vulnerabilities and high/critical development advisories without major upgrades.

Final checks and material verification limits are recorded in `utility-verification.md`.

# Backend utility decisions

## Rank history in SQL using one track identity
- Recent-history sampling truncates the event stream before deduplication: a heavily repeated track hides older distinct tracks.
- Recent and most-played history implement track identity separately in Python and SQL.
- History pagination has no deterministic tie breaker for identical timestamps.

Use the same SQL track key for both ranked history queries; apply limits after ranking, and order timestamp ties by record ID. Remove the superseded Python deduplication helpers.

## Validate playlist names once at the request boundary
- Create accepts whitespace-only names and saves leading/trailing whitespace while rename and duplicate trim and reject blanks.

Use one constrained name type for create, rename, and duplicate, preserving the optional/null behavior of each request.

## Update playlist modification time with content changes
- Adding, removing, reordering or clearing playlist items changes link records but leaves the parent playlist timestamp untouched.

Make content mutations explicitly touch the owning playlist within the existing transaction.

## Deduplicate imported tracks before building download jobs
- Playlist imports deduplicate membership but build download items from the original list; repeated videos violate the per-job track constraint.

Deduplicate imported track IDs once, preserving provider order, before playlist membership and download scheduling. Build download totals from tracks with source URLs; finish empty jobs immediately, as regular album downloads do, so unavailable provider entries cannot leave imports permanently queued.

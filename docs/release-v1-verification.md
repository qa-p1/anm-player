# v1 verification

Checked on 2026-11-11.

- Frontend checks cover the single update button, its download state, inline progress, request failures and the 6.5-second success tick. There is no update dialog or unused dialog state. ESLint, TypeScript, Knip and production builds pass.
- Backend and launcher checks cover authenticated control requests, cross-origin rejection, archive validation, isolated staging, failed builds, interrupted updates, backups, custom storage protection and cleanup retention.
- The standalone setup has completed on Windows, macOS and Ubuntu in GitHub CI: private Python, Node, FFmpeg/FFprobe, app download, dependency installation, web build and database migrations.
- On Linux, the real setup also ran in an isolated local folder containing spaces and `#`, using the downloaded runtimes without changing a shell profile or global PATH.
- A real update through the running app downloaded a pinned GitHub `main` commit, installed isolated dependencies, built the frontend, backed up the database, replaced both servers and served the new revision. The saved playlist remained available; caches were removed and the prior app was retained.
- A second real update deliberately broke only the staged copy's API startup. The launcher stopped that replacement, restored the database, restarted the old app and removed the failed copy. The selected source pointer and playlist remained correct.
- Normal startup checks `main` in the background. Restarting as part of an update skips that check until the handover is finished, so it cannot hide the completion state from the browser.
- Production Docker integration continues to test the proxy, assets, SPA routes, WebSockets, cover uploads and persistence. Docker installation updates remain controlled by Compose.

Cleanup keeps the active app, one previous managed app copy and two database backups. Unmarked folders, Git working copies, custom library storage and the required runtimes are protected. Download caches and failed stages are disposable. Windows may hold an old file open briefly; a subsequent startup retries cleanup safely.

GUI download/trust prompts belong to each operating system. CI verifies execution of the setup scripts rather than those desktop prompts.

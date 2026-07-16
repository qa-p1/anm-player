# Aura

Aura is a modern self-hosted music application built with React, TypeScript, Vite, TailwindCSS, shadcn/ui patterns, Framer Motion, FastAPI, and Docker Compose.

**Current Phase: 4 (In Progress)** - Music Player, Library Management & Playback Experience

Aura now includes a complete music playback system with queue management, favorites, playlists, and a beautiful Apple Music-inspired player interface.

## Features

✅ **Phase 1-3 Complete:**
- Beautiful UI foundation with glassmorphism and smooth animations
- Search and download music from YouTube using yt-dlp
- Live download progress via WebSockets
- Background download workers
- Download queue management

✅ **Phase 4 (In Progress):**
- Complete music player with play/pause/next/previous
- Playback queue with shuffle and repeat modes
- Volume control and mute
- Mini player and full-screen player with smooth transitions
- Favorites system (songs, artists, albums, playlists)
- Playback history tracking
- Playlist creation and management
- Keyboard shortcuts for playback control
- Media Session API integration (lock screen controls)
- Real-time audio streaming from local library

## Development

```bash
npm install
npm run dev
```

Frontend: `http://localhost:5173`

Backend:

```bash
cd apps/api
python -m venv .venv
.venv\Scripts\activate  # Windows
# source .venv/bin/activate  # Linux/Mac
pip install -r requirements.txt
mkdir data
alembic upgrade head
uvicorn app.main:app --reload
```

API docs: `http://localhost:8000/api/v1/docs`

Downloads require FFmpeg to be available on your system. The Docker image installs FFmpeg automatically.

## Docker

```bash
cp .env.example .env
docker compose up --build
```

Aura stores all managed data below one mounted root (`/data`) and keeps the small,
atomically-written storage pointer on a separate persistent mount (`/aura-state`).
Changing the location in Settings can only select directories visible inside the
API container; mount any host destination into the container before selecting it.

Existing split-volume installations can be consolidated once without deleting the
old volumes. Stop Aura, mount the legacy paths and an empty target, then run:

```bash
python docker/consolidate-storage.py --target /new-data --database /legacy-db/aura.db \
  --music /legacy-music --downloads /legacy-downloads --cache /legacy-cache \
  --config /legacy-config --thumbnails /legacy-thumbnails --logs /legacy-logs
```

The helper hashes every copied file and leaves every legacy source untouched. Start
Aura with `AURA_DATA_ROOT=/new-data` only after the verification succeeds.

## Architecture

- `apps/web`: React application with player system, library management, and playback controls
- `apps/api`: FastAPI service with music catalog, favorites, playlists, history tracking, and audio streaming

## Backend API

Versioned endpoints live under `/api/v1`.

### Core
- `/api/v1/health`, `/api/v1/health/version`, `/api/v1/health/info`

### Search & Downloads
- `/api/v1/search`
- `/api/v1/downloads`, `/api/v1/downloads/{job_id}/cancel`, `/api/v1/downloads/{job_id}/retry`
- `/api/v1/downloads/{job_id}/events` WebSocket progress stream

### Library
- `/api/v1/library`, `/api/v1/library/summary`
- `/api/v1/songs`, `/api/v1/songs/search`, `/api/v1/songs/favorites`, `/api/v1/songs/recently-played`
- `/api/v1/artists`, `/api/v1/artists/{artist_id}`
- `/api/v1/albums`, `/api/v1/albums/{album_id}`
- `/api/v1/playlists`, `/api/v1/playlists/{playlist_id}`

### Player
- `/api/v1/favorites/toggle`
- `/api/v1/history`
- `/api/v1/media/songs/{song_id}/stream`

### Other
- `/api/v1/settings`
- `/api/v1/queue`

## Keyboard Shortcuts

- `Space` - Play/Pause
- `Ctrl/Cmd + Left` - Previous track
- `Ctrl/Cmd + Right` - Next track
- `Left Arrow` - Seek backward 10s
- `Right Arrow` - Seek forward 10s
- `Up Arrow` - Volume up
- `Down Arrow` - Volume down
- `M` - Mute/Unmute

## State Management

Aura uses Zustand for client state with persistence. The player state is saved to localStorage, allowing playback to resume after page refresh.

## Player Features

- **Queue Management**: Add songs to queue, play next, reorder queue
- **Playback Modes**: Shuffle and repeat (off/all/one)
- **Favorites**: Mark songs, albums, artists, and playlists as favorites
- **History**: Automatic playback history tracking
- **Media Session API**: Lock screen and system media controls
- **Persistent State**: Resume playback after page refresh

## Future Phases

- **Phase 5**: Metadata enhancement, lyrics integration, recommendations
- **Phase 6**: Performance optimization, accessibility improvements, final polish

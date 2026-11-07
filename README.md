# ANM Player

Your own music app that runs on your computer. Search anything on YouTube Music, play it straight away, save songs for offline listening, and keep your playlists, favorites and listening history in one place. No account, no ads, no subscription.

It's built for one person. Your library stays on your computer, or on your own server if you use Docker.

---

## Getting started

You need three free programs installed first:

- [Python 3.13](https://www.python.org/downloads/)
- [Node.js 24 LTS](https://nodejs.org/)
- [FFmpeg](https://ffmpeg.org/download.html) (used to save songs for offline listening)

Then download ANM Player from the [latest release](https://github.com/qa-p1/anm-player/releases/latest) (or clone this repository) and start it:

- **Windows:** double-click `start-anm-player.cmd`
- **Mac or Linux:** open a terminal in the folder and run `./start-anm-player.sh` (the first time, run `chmod +x start-anm-player.sh` before it)

The first start takes a few minutes while everything installs. After that it opens in seconds. Your browser opens ANM Player automatically at <http://127.0.0.1:5173>.

**To close it,** click the power button at the bottom of the sidebar. Closing the browser tab alone keeps it running in the background.

> **Self-hosting with Docker?** Docker includes the app and its dependencies—no Python or Node installation needed. Follow the [Docker setup and update guide](docs/advanced-setup.md#docker-quick-start).

---

## Finding music

- **Home** shows today's picks, quick picks based on what you play, and what's trending.
- **Search** finds songs, videos, albums and artists. Your recent searches stay as chips; pin the ones you use a lot.
- **Quick find** (`Ctrl K`, or the magnifier at the top of the sidebar) jumps to any page, playlist or song in your library, or runs a player command.
- Click any **artist or album name** on a song to open that artist or album.

## Playing music

- Click a song to play it. Hover a cover and press the play button to play a whole album, playlist or artist.
- The **mini player** sits at the bottom. Drag the thin line on its top edge to skip around in the song. Click anywhere else on it to open the full player.
- On a phone, **swipe** the mini player left or right to change songs, or up to open the full player.
- The **full player** has lyrics, the queue, and the playback studio (speed, equalizer, sleep timer, A-B repeat and bookmarks).
- When a song ends and the queue is empty, **autoplay** keeps going with similar music. Turn it off with `A`.

## Your library

Open **Library** from the sidebar to see everything you've saved: songs, albums, artists, playlists and favorites, plus Recently added, Recently played and Most played.

- **Heart** a song, album or artist to add it to Favorites.
- **Save an album** with "Add to library", and download it for offline listening with "Download".
- Albums and playlists can be shown as a grid or a list. Your choice is remembered.

## Playlists

- Create one with the **+** next to "Playlists" in the sidebar, or with "New playlist" on the Playlists page.
- Add songs from any song's **⋯** menu → Add to playlist.
- Under every playlist you'll find **Recommended** songs that match what's already in it. Press **Add** to drop one in, or **Refresh** for new ideas.
- Drag songs to reorder them, tick several to play, queue or remove them together, and search inside a playlist.
- Click the cover to **upload your own picture**. Pin favorite playlists so they stay at the top of the sidebar.
- Import a YouTube Music playlist with **Import URL** on the Playlists page.

## Insights

**Insights** shows how much you listen, your streak, when you listen most, and your top songs, artists and albums for the last week, month, three months or all time.

Your full listening history is underneath. Filter it by played, completed or skipped, and press **Load more** to keep going back. You can remove single entries or clear everything.

## Keyboard shortcuts

Press `?` anytime to see them all. The most useful:

| Key | Does |
| --- | --- |
| `Space` | Play or pause |
| `←` / `→` | Skip back / forward a few seconds |
| `Ctrl ←` / `Ctrl →` | Previous / next song |
| `↑` / `↓` | Volume up / down |
| `M` | Mute |
| `S` / `R` | Shuffle / repeat |
| `L` / `Q` | Open lyrics / queue |
| `F` | Open the full player |
| `T` | 30-minute sleep timer |
| `Ctrl K` | Quick find |

## Settings and backups

**Settings** is where you pick the download quality, where your music is stored, lyrics and playback options, and the look of the app.

- **Download Database Backup** saves a copy of your library (playlists, favorites, history) without stopping the app.
- **Sync library now** picks up songs you've added or removed by hand.

---

## Good to know

- **Keep it on your computer.** Anyone who can open ANM Player in a browser can control it, so don't expose it to your network or the internet.
- **If search or playback stops working,** YouTube Music may have changed something. Wait a little and try again.
- **"Port already in use"?** Something else is using it. Start with `start-anm-player.cmd --web-port 5180` (or `./start-anm-player.sh --web-port 5180`).
- Only download music you're allowed to. ANM Player doesn't give you rights to any music.

Want Docker, manual installation, storage details or to work on the code? See [Advanced setup](docs/advanced-setup.md). What's new in each version is in the [changelog](CHANGELOG.md).

ANM Player is free and open source under the [MIT License](LICENSE).

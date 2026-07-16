import type { HistoryEntry, LibraryTrack, OnlineMusicItem, Song } from "@/types/api";
import { cachedArtworkUrl, upgradeArtworkUrl } from "@/services/api-client";

export type PlayerTrack =
  | {
      source: "local";
      localKind: "song";
      id: string;
      songId: number;
      title: string;
      artistName: string | null;
      albumTitle: string | null;
      artworkUrl: string | null;
      durationSeconds: number | null;
      rawSong: Song;
    }
  | {
      source: "local";
      localKind: "library_track";
      id: string;
      libraryTrackId: number;
      title: string;
      artistName: string | null;
      albumTitle: string | null;
      artworkUrl: string | null;
      durationSeconds: number | null;
      rawLibraryTrack: LibraryTrack;
    }
  | {
      source: "youtube";
      id: string;
      videoId: string;
      title: string;
      artistName: string | null;
      albumTitle: string | null;
      artworkUrl: string | null;
      durationSeconds: number | null;
      rawItem: OnlineMusicItem;
    };

export function songToPlayerTrack(song: Song): PlayerTrack {
  // A YouTube-backed song stays a YouTube player track even after download.
  // The canonical backend stream endpoint will choose its local file first.
  const videoId = youtubeVideoId(song.source_url);
  if (videoId) {
    return onlineItemToPlayerTrack({
      source: "youtube",
      kind: "song",
      id: videoId,
      title: song.title,
      subtitle: song.artist_name,
      artists: song.artist_name ? [{ id: null, name: song.artist_name }] : [],
      album: song.album_title ? { id: null, name: song.album_title } : null,
      thumbnail: song.artwork_path || song.artwork_url,
      duration_seconds: song.duration_seconds,
      explicit: false,
      playable: true,
      browse_id: null,
      playlist_id: null,
      endpoint: null,
      url: song.source_url!,
    });
  }
  return {
    source: "local",
    localKind: "song",
    id: `local:${song.id}`,
    songId: song.id,
    title: song.title,
    artistName: song.artist_name,
    albumTitle: song.album_title,
    artworkUrl: cachedArtworkUrl(song.artwork_path || song.artwork_url),
    durationSeconds: song.duration_seconds,
    rawSong: song,
  };
}

function youtubeVideoId(sourceUrl: string | null): string | null {
  if (!sourceUrl) return null;
  try {
    const url = new URL(sourceUrl);
    if (url.hostname === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] ?? null;
    if (url.hostname.endsWith("youtube.com")) return url.searchParams.get("v");
  } catch {
    return null;
  }
  return null;
}

export function libraryTrackToPlayerTrack(track: LibraryTrack): PlayerTrack {
  if (track.source !== "youtube" && track.is_downloaded) {
    return {
      source: "local",
      localKind: "library_track",
      id: `library-track:${track.id}`,
      libraryTrackId: track.id,
      title: track.title,
      artistName: track.artist_name,
      albumTitle: track.album_title,
      artworkUrl: cachedArtworkUrl(track.artwork_path || track.artwork_url),
      durationSeconds: track.duration_seconds,
      rawLibraryTrack: track,
    };
  }

  return onlineItemToPlayerTrack({
    source: "youtube",
    kind: "song",
    id: track.external_id,
    title: track.title,
    subtitle: track.artist_name,
    artists: track.artist_name ? [{ id: track.artist_external_id, name: track.artist_name }] : [],
    album: track.album_title ? { id: null, name: track.album_title } : null,
    thumbnail: track.artwork_path || track.artwork_url,
    duration_seconds: track.duration_seconds,
    explicit: track.explicit,
    playable: true,
    browse_id: null,
    playlist_id: null,
    endpoint: null,
    url: track.source_url || `https://music.youtube.com/watch?v=${track.external_id}`,
  });
}

export function onlineItemToPlayerTrack(item: OnlineMusicItem): PlayerTrack {
  return {
    source: "youtube",
    id: `youtube:${item.id}`,
    videoId: item.id,
    title: item.title,
    artistName: item.artists[0]?.name ?? item.subtitle,
    albumTitle: item.album?.name ?? null,
    artworkUrl: cachedArtworkUrl(item.thumbnail),
    durationSeconds: item.duration_seconds,
    rawItem: item,
  };
}

export function historyEntryToPlayerTrack(entry: HistoryEntry): PlayerTrack | null {
  if (entry.song) return songToPlayerTrack(entry.song);
  if (entry.source !== "youtube" || !entry.external_id || !entry.title) return null;

  return onlineItemToPlayerTrack({
    source: "youtube",
    kind: "song",
    id: entry.external_id,
    title: entry.title,
    subtitle: entry.artist_name,
    artists: entry.artist_name ? [{ id: null, name: entry.artist_name }] : [],
    album: entry.album_title ? { id: null, name: entry.album_title } : null,
    thumbnail: entry.artwork_url,
    duration_seconds: entry.duration_seconds,
    explicit: false,
    playable: true,
    browse_id: null,
    playlist_id: null,
    endpoint: null,
    url: entry.source_url || `https://music.youtube.com/watch?v=${entry.external_id}`,
  });
}

export function normalizeStoredPlayerTrack(value: unknown): PlayerTrack | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;

  if (
    candidate.source === "local" &&
    candidate.localKind === "library_track" &&
    typeof candidate.libraryTrackId === "number" &&
    typeof candidate.title === "string"
  ) {
    const rawLibraryTrack = (candidate.rawLibraryTrack && typeof candidate.rawLibraryTrack === "object"
      ? candidate.rawLibraryTrack
      : candidate) as LibraryTrack;
    if (rawLibraryTrack.source === "youtube" && rawLibraryTrack.external_id) {
      return libraryTrackToPlayerTrack(rawLibraryTrack);
    }
    return {
      source: "local",
      localKind: "library_track",
      id: typeof candidate.id === "string" ? candidate.id : `library-track:${candidate.libraryTrackId}`,
      libraryTrackId: candidate.libraryTrackId,
      title: candidate.title,
      artistName: nullableString(candidate.artistName),
      albumTitle: nullableString(candidate.albumTitle),
      artworkUrl: cachedArtworkUrl(nullableString(candidate.artworkUrl)),
      durationSeconds: nullableNumber(candidate.durationSeconds),
      rawLibraryTrack,
    };
  }

  if (candidate.source === "local" && typeof candidate.songId === "number" && typeof candidate.title === "string") {
    const rawSong = (candidate.rawSong && typeof candidate.rawSong === "object" ? candidate.rawSong : candidate) as Song;
    if (youtubeVideoId(rawSong.source_url)) {
      return songToPlayerTrack(rawSong);
    }
    return {
      source: "local",
      localKind: "song",
      id: typeof candidate.id === "string" ? candidate.id : `local:${candidate.songId}`,
      songId: candidate.songId,
      title: candidate.title,
      artistName: nullableString(candidate.artistName),
      albumTitle: nullableString(candidate.albumTitle),
      artworkUrl: upgradeArtworkUrl(nullableString(candidate.artworkUrl)),
      durationSeconds: nullableNumber(candidate.durationSeconds),
      rawSong,
    };
  }

  if (candidate.source === "youtube" && typeof candidate.videoId === "string" && typeof candidate.title === "string") {
    return {
      source: "youtube",
      id: typeof candidate.id === "string" ? candidate.id : `youtube:${candidate.videoId}`,
      videoId: candidate.videoId,
      title: candidate.title,
      artistName: nullableString(candidate.artistName),
      albumTitle: nullableString(candidate.albumTitle),
      artworkUrl: cachedArtworkUrl(nullableString(candidate.artworkUrl)),
      durationSeconds: nullableNumber(candidate.durationSeconds),
      rawItem: (candidate.rawItem && typeof candidate.rawItem === "object" ? candidate.rawItem : candidate) as OnlineMusicItem,
    };
  }

  if (typeof candidate.id === "number" && typeof candidate.title === "string") {
    return songToPlayerTrack(candidate as unknown as Song);
  }

  return null;
}

export function normalizeStoredPlayerQueue(value: unknown): PlayerTrack[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeStoredPlayerTrack).filter((track): track is PlayerTrack => Boolean(track));
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

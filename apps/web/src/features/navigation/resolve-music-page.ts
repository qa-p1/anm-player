import { queryClient } from "@/lib/query-client";
import { searchYouTubeMusic } from "@/services/music-api";

const ONE_HOUR = 60 * 60 * 1000;

function normalize(value: string) {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** "A, B & C" or "A feat. B" credits resolve best by their first artist. */
function primaryArtist(name: string) {
  return name.split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bx\b|·)\s*/i)[0]?.trim() || name;
}

/**
 * Finds the real artist page for a track that only carries the artist's name
 * (history entries, some provider rows) so names never dead-end in search.
 */
export async function resolveArtistPage(name: string): Promise<string | null> {
  const artist = primaryArtist(name);
  const response = await queryClient.fetchQuery({
    queryKey: ["resolve", "artist", normalize(artist)],
    queryFn: ({ signal }) => searchYouTubeMusic(artist, "artists", undefined, signal),
    staleTime: ONE_HOUR,
  });
  const artists = response.items.filter((item) => item.kind === "artist");
  const pick = artists.find((item) => normalize(item.title) === normalize(artist)) ?? artists[0];
  const id = pick?.browse_id || pick?.id;
  return id ? `/library/artists/online/${encodeURIComponent(id)}` : null;
}

/** The YouTube Music artist with exactly this name, or null when unsure. */
export async function findOnlineArtistId(name: string): Promise<string | null> {
  const artist = primaryArtist(name);
  const response = await queryClient.fetchQuery({
    queryKey: ["resolve", "artist", normalize(artist)],
    queryFn: ({ signal }) => searchYouTubeMusic(artist, "artists", undefined, signal),
    staleTime: ONE_HOUR,
  });
  const pick = response.items.find((item) => item.kind === "artist" && normalize(item.title) === normalize(artist));
  return pick?.browse_id || pick?.id || null;
}

/** Finds the real album page for an album title (and optional artist name). */
export async function resolveAlbumPage(album: string, artist?: string | null): Promise<string | null> {
  const artistName = artist ? primaryArtist(artist) : "";
  const query = [album, artistName].filter(Boolean).join(" ");
  const response = await queryClient.fetchQuery({
    queryKey: ["resolve", "album", normalize(query)],
    queryFn: ({ signal }) => searchYouTubeMusic(query, "albums", undefined, signal),
    staleTime: ONE_HOUR,
  });
  const albums = response.items.filter((item) => item.kind === "album");
  const wanted = normalize(album);
  const byArtist = (item: (typeof albums)[number]) => !artistName || item.artists.some((credit) => normalize(credit.name) === normalize(artistName)) || normalize(item.subtitle ?? "").includes(normalize(artistName));
  const pick = albums.find((item) => normalize(item.title) === wanted && byArtist(item))
    ?? albums.find((item) => normalize(item.title) === wanted)
    ?? albums.find(byArtist)
    ?? albums[0];
  const id = pick?.browse_id || pick?.id;
  return id ? `/albums/${encodeURIComponent(id)}` : null;
}

import { useQueries, useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { LoaderCircle, Pause, Play, Plus, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { ArtworkImage } from "@/components/cards/artwork-image";
import { TrackDuration } from "@/components/cards/track-duration";
import { TrackMetadata } from "@/components/cards/track-metadata";
import { toast } from "@/components/ui/toast";
import { useAddTracksToPlaylist, useMostPlayedHistory, useRecentlyPlayedHistory } from "@/hooks/use-music-queries";
import { cn } from "@/lib/utils";
import { getYouTubeRelated, listAllSongs } from "@/services/music-api";
import { musicKeys } from "@/services/music-keys";
import { usePlayerStore } from "@/stores/player-store";
import type { HistoryEntry } from "@/types/api";
import type { PlayerTrack } from "@/types/player";
import { onlineItemToPlayerTrack, songToPlayerTrack } from "@/types/player";

const VISIBLE = 6;
const SEEDS_PER_ROUND = 3;

interface Seed {
  videoId: string;
  artist: string | null;
}

/** Stable identity across local and YouTube-backed copies of the same song. */
function trackIdentity(track: PlayerTrack) {
  return track.source === "youtube" ? `yt:${track.videoId}` : track.id;
}

function normalizeArtist(name: string | null | undefined) {
  return name?.trim().toLocaleLowerCase() || null;
}

/** "Get Lucky (Radio Edit - feat. …)" and "Get Lucky" are the same song for suggestions. */
function versionKey(title: string, artist: string | null | undefined) {
  const base = title.toLocaleLowerCase().replace(/\s*[([][^)\]]*[)\]]/g, "").replace(/\s+[-–—]\s+.*$/, "").replace(/\s+/g, " ").trim();
  return `${base || title.toLocaleLowerCase()}|${normalizeArtist(artist) ?? ""}`;
}

function trackVersion(track: PlayerTrack) {
  return versionKey(track.title, track.artistName);
}

function historySeeds(entries: HistoryEntry[]): Seed[] {
  return entries
    .filter((entry) => entry.source === "youtube" && entry.external_id)
    .map((entry) => ({ videoId: entry.external_id!, artist: entry.song?.artist_name || entry.artist_name }));
}

function uniqueSeeds(seeds: Seed[]) {
  const seen = new Set<string>();
  return seeds.filter((seed) => !seen.has(seed.videoId) && Boolean(seen.add(seed.videoId)));
}

/**
 * Suggestions are never random: they come from YouTube Music's "related" radio
 * for songs in the playlist (or, for an empty playlist, the songs you play
 * most), ranked by how many seeds agree and whether the artist already fits.
 */
export function PlaylistSuggestions({ playlistId, tracks }: { playlistId: number; tracks: PlayerTrack[] }) {
  const [round, setRound] = useState(0);
  // Songs already shown are skipped on refresh; their radio feeds the next batch.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [extraSeeds, setExtraSeeds] = useState<Seed[]>([]);
  // Seeds stay put while songs are added from here, so the other suggestions don't reshuffle.
  const [seedBasis, setSeedBasis] = useState<PlayerTrack[] | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  // Hides an added song at once instead of waiting for the playlist to refetch.
  const [added, setAdded] = useState<Set<string>>(new Set());
  const reduceMotion = useReducedMotion();
  const addTracks = useAddTracksToPlaylist();
  const { currentId, isPlaying } = usePlayerStore(useShallow((state) => ({ currentId: state.currentSong?.id ?? null, isPlaying: state.isPlaying })));

  const basis = seedBasis ?? tracks;
  const playlistSeeds = useMemo(() => uniqueSeeds(basis
    .filter((track): track is Extract<PlayerTrack, { source: "youtube" }> => track.source === "youtube")
    .map((track) => ({ videoId: track.videoId, artist: track.artistName }))
    .reverse()), [basis]);
  const needsHistory = playlistSeeds.length === 0;
  const { data: mostPlayed = [] } = useMostPlayedHistory(10, { enabled: needsHistory });
  const { data: recent = [] } = useRecentlyPlayedHistory(20, { enabled: needsHistory });
  const seeds = useMemo(() => (needsHistory ? uniqueSeeds([...historySeeds(mostPlayed), ...historySeeds(recent)]) : playlistSeeds), [mostPlayed, needsHistory, playlistSeeds, recent]);

  // Each refresh moves to the next window of seeds so the list really changes.
  const activeSeeds = useMemo(() => {
    const window = seeds.length <= SEEDS_PER_ROUND ? seeds : (() => {
      const start = (round * SEEDS_PER_ROUND) % seeds.length;
      return [...seeds.slice(start), ...seeds.slice(0, start)].slice(0, SEEDS_PER_ROUND);
    })();
    return uniqueSeeds([...window, ...extraSeeds.slice(-SEEDS_PER_ROUND)]);
  }, [extraSeeds, round, seeds]);

  const relatedQueries = useQueries({
    queries: activeSeeds.map((seed) => ({
      queryKey: ["ytmusic", "related", seed.videoId],
      queryFn: ({ signal }: { signal: AbortSignal }) => getYouTubeRelated(seed.videoId, signal),
      staleTime: 10 * 60 * 1000,
    })),
  });
  const songsQuery = useQuery({ queryKey: musicKeys.songsAll(), queryFn: ({ signal }) => listAllSongs(signal), staleTime: 5 * 60 * 1000, enabled: tracks.length > 0 });

  const suggestions = rankSuggestions();

  // Cheap enough (a few dozen related items) to rank on every render.
  function rankSuggestions() {
    const existing = new Set([...tracks.map(trackIdentity), ...seeds.map((seed) => `yt:${seed.videoId}`)]);
    const existingVersions = new Set([...tracks.map(trackVersion), ...added]);
    const knownArtists = new Set([...basis.map((track) => normalizeArtist(track.artistName)), ...seeds.map((seed) => normalizeArtist(seed.artist))].filter(Boolean));
    const ranked = new Map<string, { track: PlayerTrack; score: number }>();
    const consider = (track: PlayerTrack, score: number) => {
      const key = trackVersion(track);
      if (existing.has(trackIdentity(track)) || existingVersions.has(key) || dismissed.has(key)) return;
      const artistBonus = knownArtists.has(normalizeArtist(track.artistName)) ? 0.75 : 0;
      const current = ranked.get(key);
      if (current) current.score += score;
      else ranked.set(key, { track, score: score + artistBonus });
    };
    relatedQueries.forEach(({ data: response }) => {
      const items = (response?.items ?? []).filter((item) => item.playable && item.kind === "song");
      // Earlier related items are stronger matches; agreement across seeds adds up.
      items.forEach((item, index) => consider(onlineItemToPlayerTrack(item), 1 + (items.length - index) / Math.max(1, items.length)));
    });
    // Library songs only count when the artist already belongs in this playlist.
    (songsQuery.data ?? []).map(songToPlayerTrack).filter((track) => knownArtists.has(normalizeArtist(track.artistName))).forEach((track) => consider(track, 1));
    return [...ranked.values()].sort((a, b) => b.score - a.score).map((entry) => entry.track);
  }

  const visible = suggestions.slice(0, VISIBLE);

  function refresh() {
    const shownKeys = visible.map(trackVersion);
    // Older recommendations from the playlist's own radio stay connected to it.
    const nextSeeds = visible
      .filter((track): track is Extract<PlayerTrack, { source: "youtube" }> => track.source === "youtube")
      .slice(0, SEEDS_PER_ROUND)
      .map((track) => ({ videoId: track.videoId, artist: track.artistName }));
    const remaining = suggestions.length - visible.length;
    setDismissed((current) => (remaining < VISIBLE && current.size > 0 && nextSeeds.length === 0 ? new Set() : new Set([...current, ...shownKeys])));
    if (remaining < VISIBLE * 2 && nextSeeds.length) setExtraSeeds((current) => uniqueSeeds([...current, ...nextSeeds]));
    setRound((value) => value + 1);
    setSeedBasis(null);
  }
  const isLoading = relatedQueries.some((query) => query.isLoading);
  const isFetching = relatedQueries.some((query) => query.isFetching);

  if (seeds.length === 0 && visible.length === 0) return null;
  if (!isLoading && visible.length === 0) return null;

  async function add(track: PlayerTrack) {
    const key = trackIdentity(track);
    if (pending) return;
    setPending(key);
    setSeedBasis((current) => current ?? tracks);
    try {
      await addTracks.mutateAsync({ playlistId, tracks: [track] });
      setAdded((current) => new Set(current).add(trackVersion(track)));
      toast(`Added “${track.title}”`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not add the song", "error");
    } finally {
      setPending(null);
    }
  }

  function preview(track: PlayerTrack) {
    const player = usePlayerStore.getState();
    if (currentId === track.id) player.setIsPlaying(!player.isPlaying);
    else player.playSong(track, visible);
  }

  return (
    <section aria-label="Recommended" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold tracking-tight">{needsHistory ? "Based on what you play" : "Recommended"}</h2>
        {(
          <button type="button" onClick={refresh} disabled={isFetching} className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-xs font-semibold text-muted-foreground transition hover:bg-white/10 hover:text-foreground disabled:opacity-50">
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />Refresh
          </button>
        )}
      </div>
      <div className="rounded-[1.6rem] border border-white/[0.06] bg-card/30 p-2">
        {isLoading && visible.length === 0
          ? Array.from({ length: 4 }).map((_, index) => <div key={index} className="m-1 h-12 animate-pulse rounded-xl bg-white/[0.04]" />)
          : <AnimatePresence initial={false} mode="popLayout">{visible.map((track) => {
            const key = trackIdentity(track);
            const isCurrent = currentId === track.id;
            return (
              <motion.article
                key={key}
                layout={!reduceMotion}
                initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 24, transition: { duration: 0.18 } }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className={cn("group flex min-w-0 items-center gap-3 rounded-xl p-2 transition-colors hover:bg-white/[0.06]", isCurrent && "bg-primary/[0.08]")}
              >
                <button type="button" onClick={() => preview(track)} aria-label={isCurrent && isPlaying ? `Pause ${track.title}` : `Play ${track.title}`} className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <ArtworkImage src={track.artworkUrl} alt="" className="h-full w-full object-cover" />
                  <span className={cn("absolute inset-0 grid place-items-center bg-black/45 text-white transition", isCurrent ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
                    {isCurrent && isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
                  </span>
                </button>
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate text-sm font-semibold", isCurrent && "text-primary")} title={track.title}>{track.title}</p>
                  <TrackMetadata track={track} className="flex text-xs text-muted-foreground" />
                </div>
                <TrackDuration trackId={track.id} seconds={track.durationSeconds} className="hidden shrink-0 text-xs text-muted-foreground sm:block" />
                <button
                  type="button"
                  onClick={() => void add(track)}
                  disabled={pending !== null}
                  aria-label={`Add ${track.title} to playlist`}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-white/15 px-3.5 text-xs font-semibold transition hover:scale-105 hover:border-white/30 hover:bg-white/10 disabled:opacity-50"
                >
                  {pending === key ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  Add
                </button>
              </motion.article>
            );
          })}</AnimatePresence>}
      </div>
    </section>
  );
}

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Clock3, Disc3, Sparkles, TrendingUp } from "lucide-react";
import { useMemo } from "react";
import { useParams } from "react-router";

import { pageTransition } from "@/animations/page-motion";
import { CollectionActions } from "@/components/cards/collection-actions";
import { TrackRow } from "@/components/cards/track-row";
import { CollectionHero } from "@/components/collection/collection-hero";
import { DetailSkeleton, MosaicArtwork, Shelf } from "@/components/collection/collection-parts";
import { MediaTile } from "@/components/collection/media-tile";
import { EmptyState } from "@/components/empty-states/empty-state";
import { BackButton } from "@/components/navigation/back-button";
import { Button } from "@/components/ui/button";
import { playAlbumById } from "@/features/library/collection-playback";
import { useMostPlayedHistory, useRecentlyPlayedHistory } from "@/hooks/use-music-queries";
import { cachedArtworkUrl } from "@/services/api-client";
import { getSmartCollection } from "@/services/music-api";
import { musicKeys } from "@/services/music-keys";
import type { SmartCollection } from "@/types/api";
import type { PlayerTrack } from "@/types/player";
import { historyEntryToPlayerTrack, libraryTrackToPlayerTrack } from "@/types/player";

const META = {
  "recently-played": { title: "Recently played", icon: Clock3, gradient: "bg-[radial-gradient(circle_at_30%_20%,rgb(56_189_248/0.7),transparent_60%),linear-gradient(135deg,rgb(14_116_144/0.8),rgb(30_41_59/0.9))]" },
  "most-played": { title: "Most played", icon: TrendingUp, gradient: "bg-[radial-gradient(circle_at_30%_20%,rgb(251_146_60/0.75),transparent_60%),linear-gradient(135deg,rgb(225_29_72/0.75),rgb(76_5_25/0.9))]" },
  "recently-added": { title: "Recently added", icon: Sparkles, gradient: "bg-[radial-gradient(circle_at_30%_20%,rgb(52_211_153/0.7),transparent_60%),linear-gradient(135deg,rgb(13_148_136/0.8),rgb(19_78_74/0.9))]" },
} as const;

export function SmartCollectionPage() {
  const { collectionId } = useParams<{ collectionId: string }>();
  const recent = useRecentlyPlayedHistory(100, { enabled: collectionId === "recently-played" });
  const most = useMostPlayedHistory(100, { enabled: collectionId === "most-played" });
  const isHistory = collectionId === "recently-played" || collectionId === "most-played";
  const saved = useQuery({ queryKey: musicKeys.smartCollection(collectionId ?? ""), queryFn: ({ signal }) => getSmartCollection(collectionId!, 100, signal), enabled: Boolean(collectionId) && !isHistory });
  const historyQuery = collectionId === "most-played" ? most : recent;
  const activeQuery = isHistory ? historyQuery : saved;
  const meta = META[collectionId as keyof typeof META] ?? { title: saved.data?.title ?? "Collection", icon: Sparkles, gradient: undefined };
  const collection: SmartCollection | undefined = isHistory
    ? { id: collectionId!, title: meta.title, description: "", tracks: [], albums: [] }
    : saved.data;

  const tracks = useMemo<PlayerTrack[]>(() => {
    if (isHistory) {
      // History can list the same song many times; keep its first appearance.
      const seen = new Set<string>();
      return (historyQuery.data ?? []).map(historyEntryToPlayerTrack).filter((track): track is PlayerTrack => {
        if (!track || seen.has(track.id)) return false;
        seen.add(track.id);
        return true;
      });
    }
    return (saved.data?.tracks ?? []).map(libraryTrackToPlayerTrack);
  }, [historyQuery.data, isHistory, saved.data]);

  if (activeQuery.isLoading) return <DetailSkeleton />;
  if (activeQuery.error) return <div role="alert" className="grid min-h-[50vh] place-content-center gap-3 text-center text-muted-foreground"><p>{activeQuery.error.message}</p><Button variant="glass" onClick={() => void activeQuery.refetch()}>Retry</Button></div>;
  if (!collection) return <div className="flex min-h-[50vh] items-center justify-center text-muted-foreground">Collection not found</div>;

  const title = isHistory ? meta.title : collection.title;
  const savedTracks = saved.data?.tracks ?? [];

  return (
    <motion.div {...pageTransition} className="mx-auto max-w-7xl space-y-6 px-3 py-4 sm:px-6 lg:px-8 lg:py-7">
      <BackButton fallback="/library" />
      <CollectionHero kind={title} title={title} artworkUrl={tracks.find((track) => track.artworkUrl)?.artworkUrl ?? null} artwork={<MosaicArtwork urls={tracks.slice(0, 24).map((track) => track.artworkUrl)} icon={meta.icon} gradient={meta.gradient} />}>
        <CollectionActions tracks={tracks} name={title} />
      </CollectionHero>

      {collection.albums.length > 0 && (
        <Shelf title="Albums">
          {collection.albums.map((album) => (
            <div key={album.id} className="w-40 shrink-0 snap-start sm:w-44">
              <MediaTile href={album.canonical_url} title={album.title} subtitle={album.artist_name || "Unknown Artist"} artworkUrl={cachedArtworkUrl(album.artwork_path || album.artwork_url)} fallbackArtworkUrl={cachedArtworkUrl(album.artwork_url)} placeholderIcon={Disc3} onPlay={() => playAlbumById(album.public_id)} />
            </div>
          ))}
        </Shelf>
      )}

      {tracks.length > 0 ? (
        <section aria-label="Tracks" className="rounded-[1.6rem] border border-white/[0.06] bg-card/30 p-2 sm:p-3">
          {tracks.map((track, index) => {
            const raw = isHistory ? null : savedTracks[index];
            return <TrackRow key={track.id} variant="list" number={index + 1} track={track} context={tracks} explicit={raw?.explicit} isDownloaded={raw?.is_downloaded} />;
          })}
        </section>
      ) : collection.albums.length === 0 && (
        <EmptyState icon={meta.icon} title="Nothing here yet" description={isHistory ? "Play some music and it will show up here." : "New additions to your library show up here."} />
      )}
    </motion.div>
  );
}

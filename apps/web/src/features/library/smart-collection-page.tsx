import { motion } from "framer-motion";
import { Play } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";

import { pageTransition } from "@/animations/page-motion";
import { BackButton } from "@/components/navigation/back-button";
import { TrackRow } from "@/components/cards/track-row";
import { ArtworkImage } from "@/components/cards/artwork-image";
import { Button } from "@/components/ui/button";
import { cachedArtworkUrl, isRequestCancelled } from "@/services/api-client";
import { getMostPlayedHistory, getRecentlyPlayedHistory, getSmartCollection } from "@/services/music-api";
import { usePlayerStore } from "@/stores/player-store";
import type { HistoryEntry, LibraryTrack, SmartCollection } from "@/types/api";
import type { PlayerTrack } from "@/types/player";
import { historyEntryToPlayerTrack, libraryTrackToPlayerTrack } from "@/types/player";

export function SmartCollectionPage() {
  const { collectionId } = useParams<{ collectionId: string }>();
  const [collection, setCollection] = useState<SmartCollection | null>(null);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { playAlbum } = usePlayerStore();

  useEffect(() => {
    if (!collectionId) return;
    const controller = new AbortController();
    setIsLoading(true);
    const historyRequest =
      collectionId === "recently-played"
        ? getRecentlyPlayedHistory(100, controller.signal)
        : collectionId === "most-played"
          ? getMostPlayedHistory(100, controller.signal)
          : null;

    const request = historyRequest
      ? historyRequest.then((entries) => {
          setHistoryEntries(entries);
          setCollection({
            id: collectionId,
            title: collectionId === "most-played" ? "Most Played" : "Recently Played",
            description: collectionId === "most-played" ? "Tracks you play most often." : "Tracks you played recently.",
            tracks: [],
            albums: [],
          });
        })
      : getSmartCollection(collectionId, 100, controller.signal).then((response) => {
          setHistoryEntries([]);
          setCollection(response);
        });

    request
      .catch((error) => {
        if (isRequestCancelled(error)) return;
        console.error("Failed to load collection:", error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [collectionId]);

  const tracks = collection?.tracks.map(libraryTrackToPlayerTrack) ?? [];
  const historyTracks = historyEntries.map(historyEntryToPlayerTrack).filter((track): track is PlayerTrack => Boolean(track));
  const playableTracks = historyTracks.length > 0 ? historyTracks : tracks;

  if (isLoading) return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading...</div>;
  if (!collection) return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Collection not found</div>;

  return (
    <motion.div {...pageTransition} className="mx-auto max-w-7xl space-y-8 px-3 py-4 sm:px-6 lg:px-8 lg:py-7">
      <BackButton fallback="/library" />
      <section className="space-y-4">
        <p className="text-sm font-semibold text-primary">More Collection</p>
        <h1 className="text-4xl font-black tracking-normal sm:text-5xl">{collection.title}</h1>
        <p className="max-w-2xl text-muted-foreground">{collection.description}</p>
        <Button onClick={() => playAlbum(playableTracks, 0)} disabled={playableTracks.length === 0}>
          <Play className="h-4 w-4 fill-current" />
          Play
        </Button>
      </section>

      {collection.albums.length > 0 && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
          {collection.albums.map((album) => {
            const artworkUrl = cachedArtworkUrl(album.artwork_path || album.artwork_url);
            return (
              <Link key={album.id} to={album.canonical_url} className="group min-w-0">
                <div className="mb-3 aspect-square overflow-hidden rounded-xl bg-white/10 shadow-glass sm:rounded-2xl">
                  {artworkUrl ? <ArtworkImage src={artworkUrl} fallbackSrc={cachedArtworkUrl(album.artwork_url)} alt={album.title} className="h-full w-full object-cover transition group-hover:scale-105" /> : null}
                </div>
                <h3 className="truncate text-sm font-bold">{album.title}</h3>
                <p className="mt-1 truncate text-xs text-muted-foreground">{album.artist_name || "Unknown Artist"}</p>
              </Link>
            );
          })}
        </section>
      )}

      <section className="space-y-2">
        {historyTracks.length > 0
          ? historyTracks.map((track, index) => <HistoryTrackRow key={track.id} track={track} index={index} context={historyTracks} />)
          : collection.tracks.map((track, index) => <SmartTrackRow key={track.id} track={track} index={index} context={tracks} />)}
      </section>
    </motion.div>
  );
}

function HistoryTrackRow({ track, index, context }: { track: PlayerTrack; index: number; context: PlayerTrack[] }) {
  return <TrackRow track={track} context={context} leading={<span className="hidden w-8 shrink-0 text-center text-sm text-muted-foreground sm:block">{index + 1}</span>} />;
}

function SmartTrackRow({ track, index, context }: { track: LibraryTrack; index: number; context: PlayerTrack[] }) {
  const playerTrack = libraryTrackToPlayerTrack(track);
  return <TrackRow track={playerTrack} context={context} leading={<span className="hidden w-8 shrink-0 text-center text-sm text-muted-foreground sm:block">{index + 1}</span>} isDownloaded={track.is_downloaded} />;
}

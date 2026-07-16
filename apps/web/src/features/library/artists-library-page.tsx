import { motion } from "framer-motion";
import { Mic } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { pageTransition } from "@/animations/page-motion";
import { BackButton } from "@/components/navigation/back-button";
import { ArtworkImage } from "@/components/cards/artwork-image";
import { EmptyState } from "@/components/empty-states/empty-state";
import { cachedArtworkUrl } from "@/services/api-client";
import { listArtists } from "@/services/music-api";
import type { Artist } from "@/types/api";

export function ArtistsLibraryPage() {
  const [artists, setArtists] = useState<Artist[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    
    listArtists(100, 0, controller.signal)
      .then(setArtists)
      .catch((error) => {
        if (error.name !== "AbortError") {
          console.error("Failed to load artists:", error);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, []);

  return (
    <motion.div {...pageTransition} className="mx-auto max-w-7xl space-y-8 px-3 py-4 sm:px-6 lg:px-8 lg:py-7">
      <section>
        <BackButton fallback="/library" />
        <p className="mb-2 text-sm font-semibold text-primary">Artists</p>
        <h1 className="text-4xl font-black tracking-normal sm:text-5xl">
          Your favorite artists
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
          {artists.length} {artists.length === 1 ? "artist" : "artists"} in your library
        </p>
      </section>

      <section>
        {isLoading ? (
          <p className="text-center text-muted-foreground">Loading...</p>
        ) : artists.length === 0 ? (
          <EmptyState
            icon={Mic}
            title="No artists in library"
            description="Download some music to see artists here."
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {artists.map((artist) => {
              const artworkUrl = cachedArtworkUrl(artist.artwork_path || artist.artwork_url);
              return (
              <Link
                key={artist.id}
                to={`/library/artists/${artist.id}`}
                className="group min-w-0"
              >
                <div className="mb-3 aspect-square overflow-hidden rounded-full bg-white/10 shadow-glass">
                  {artworkUrl ? (
                    <ArtworkImage
                      src={artworkUrl}
                      fallbackSrc={cachedArtworkUrl(artist.artwork_url)}
                      alt={artist.name}
                      className="h-full w-full object-cover transition group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-white/10">
                      <Mic className="h-12 w-12 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <h3 className="truncate text-center text-sm font-bold">{artist.name}</h3>
                <p className="mt-1 truncate text-center text-xs text-muted-foreground">
                  {artist.song_count} {artist.song_count === 1 ? "song" : "songs"} · {artist.album_count}{" "}
                  {artist.album_count === 1 ? "album" : "albums"}
                </p>
              </Link>
            )})}
          </div>
        )}
      </section>
    </motion.div>
  );
}

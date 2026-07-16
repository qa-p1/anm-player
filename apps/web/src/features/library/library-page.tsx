import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Clock3, Disc, Heart, ListMusic, Mic, Music, Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { pageTransition } from "@/animations/page-motion";
import { Button } from "@/components/ui/button";
import { ArtworkImage } from "@/components/cards/artwork-image";
import { Input } from "@/components/ui/input";
import { useMostPlayedHistory } from "@/hooks/use-music-queries";
import { cachedArtworkUrl } from "@/services/api-client";
import { listArtists, listLibraryAlbums, listPlaylists, listSongs, searchLibrary } from "@/services/music-api";
import type { LibraryAlbum, LibrarySearchResult } from "@/types/api";

export function LibraryPage() {
  const { data: mostPlayed = [] } = useMostPlayedHistory(1);
  const [stats, setStats] = useState({
    songs: 0,
    albums: 0,
    artists: 0,
    playlists: 0,
  });
  const [albums, setAlbums] = useState<LibraryAlbum[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LibrarySearchResult[]>([]);
  const [personalityIndex, setPersonalityIndex] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    Promise.all([
      listSongs(100, 0, controller.signal),
      listLibraryAlbums(undefined, 100, 0, controller.signal),
      listArtists(100, 0, controller.signal),
      listPlaylists(100, 0, controller.signal),
    ])
      .then(([songs, albums, artists, playlists]) => {
        if (controller.signal.aborted) return;
        setAlbums(albums);
        setStats({
          songs: songs.length,
          albums: albums.length,
          artists: artists.length,
          playlists: playlists.length,
        });
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          console.error("Failed to load library stats:", error);
        }
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const normalized = query.trim();
    const controller = new AbortController();
    if (!normalized) {
      setResults([]);
      return () => controller.abort();
    }
    searchLibrary(normalized, 12, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setResults(response.results);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setResults([]);
      });
    return () => controller.abort();
  }, [query]);

  const statsCards = [
    { label: "Songs", value: stats.songs, helper: "Downloaded tracks" },
    { label: "Albums", value: stats.albums, helper: "Album collections" },
    { label: "Artists", value: stats.artists, helper: "Artist library" },
    { label: "Playlists", value: stats.playlists, helper: "Custom playlists" },
  ];

  const sections = [
    { id: "songs", label: "Songs", icon: Music, path: "/library/songs" },
    { id: "artists", label: "Artists", icon: Mic, path: "/library/artists" },
    { id: "playlists", label: "Playlists", icon: ListMusic, path: "/library/playlists" },
    { id: "favorites", label: "Favorites", icon: Heart, path: "/library/favorites" },
  ];
  const smartCollections = [
    { id: "recently-added", label: "Recently Added" },
    { id: "recently-played", label: "Recently Played" },
    { id: "most-played", label: "Most Played" },
  ];
  const randomAlbum = useMemo(() => albums.length > 0 ? albums[Math.floor(Math.random() * albums.length)] : null, [albums]);
  const topTrack = mostPlayed[0];
  const personalityCards: LibraryPersonalityCard[] = [
    {
      id: "most-played",
      eyebrow: "Your repeat champion",
      title: topTrack?.song?.title || topTrack?.title || "Most played song",
      description: topTrack?.song?.artist_name || topTrack?.artist_name || "Play a few songs and your favorite will appear here.",
      path: "/library/smart/most-played",
      artworkUrl: cachedArtworkUrl(topTrack?.song?.artwork_path || topTrack?.artwork_url),
      icon: Music,
      gradient: "from-rose-500/85 via-fuchsia-600/65 to-violet-900/80",
    },
    {
      id: "album-pick",
      eyebrow: "Random album pick",
      title: randomAlbum?.title || "An album for later",
      description: randomAlbum?.artist_name || "Save an album and the library will pick one for you.",
      path: randomAlbum?.canonical_url || "/library/albums",
      artworkUrl: cachedArtworkUrl(randomAlbum?.artwork_path || randomAlbum?.artwork_url),
      icon: Disc,
      gradient: "from-amber-400/85 via-orange-600/65 to-rose-900/80",
    },
    {
      id: "recently-added",
      eyebrow: "Fresh in your library",
      title: "Recently added",
      description: "The newest downloads and saves, all in one place.",
      path: "/library/smart/recently-added",
      artworkUrl: null,
      icon: Clock3,
      gradient: "from-cyan-400/80 via-teal-600/65 to-slate-900/85",
    },
    {
      id: "favorites",
      eyebrow: "The songs you chose",
      title: "Favorites",
      description: "A quick route back to the music that feels most like you.",
      path: "/library/favorites",
      artworkUrl: null,
      icon: Heart,
      gradient: "from-pink-500/85 via-rose-600/65 to-red-950/85",
    },
    {
      id: "playlists",
      eyebrow: "Made your way",
      title: stats.playlists === 1 ? "1 personal playlist" : `${stats.playlists} personal playlists`,
      description: "Your hand-built queues, moods, and reliable go-to mixes.",
      path: "/library/playlists",
      artworkUrl: null,
      icon: ListMusic,
      gradient: "from-lime-400/75 via-emerald-600/65 to-teal-950/85",
    },
  ];

  useEffect(() => {
    const timer = window.setInterval(() => setPersonalityIndex((current) => (current + 1) % personalityCards.length), 7000);
    return () => window.clearInterval(timer);
  }, [personalityCards.length]);

  return (
    <motion.div {...pageTransition} className="mx-auto max-w-7xl space-y-8 px-3 py-4 sm:px-6 lg:px-8 lg:py-7">
      <section className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <LibraryPersonalityCarousel cards={personalityCards} activeIndex={personalityIndex} onActiveIndexChange={setPersonalityIndex} />

        <div className="grid grid-cols-2 gap-3">
          {statsCards.map((stat) => (
            <div key={stat.label} className="rounded-2xl border border-white/10 bg-card/55 p-4 shadow-glass sm:p-5">
              <p className="text-2xl font-black tracking-normal sm:text-3xl">{stat.value}</p>
              <p className="mt-1 text-sm font-semibold">{stat.label}</p>
              <p className="mt-2 text-xs text-muted-foreground">{stat.helper}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your library"
            className="h-12 pl-12"
          />
        </div>
        {results.length > 0 && (
          <div className="grid gap-2 md:grid-cols-2">
            {results.map((result) => {
              const artworkUrl = cachedArtworkUrl(result.artwork_path || result.artwork_url);
              return (
                <Link key={`${result.item_type}-${result.id}`} to={result.href} className="glass-panel flex items-center gap-3 rounded-2xl p-3 transition hover:bg-white/10">
                  <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-white/10">
                    {artworkUrl ? <ArtworkImage src={artworkUrl} fallbackSrc={cachedArtworkUrl(result.artwork_url)} alt={result.title} className="h-full w-full object-cover" /> : null}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{result.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{result.subtitle || result.item_type}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {albums.length > 0 && (
        <section>
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-primary">Albums</p>
              <h2 className="text-2xl font-bold">Album Collection</h2>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {albums.slice(0, 12).map((album) => {
              const artworkUrl = cachedArtworkUrl(album.artwork_path || album.artwork_url);
              return (
                <Link
                  key={album.id}
                  to={album.canonical_url}
                  className="group min-w-0"
                >
                  <div className="mb-3 aspect-square overflow-hidden rounded-xl bg-white/10 shadow-glass sm:rounded-2xl">
                    {artworkUrl ? (
                      <ArtworkImage
                        src={artworkUrl}
                        fallbackSrc={cachedArtworkUrl(album.artwork_url)}
                        alt={album.title}
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,#f43f5e,#14b8a6_52%,#f59e0b)]">
                        <Disc className="h-12 w-12 text-white/70" />
                      </div>
                    )}
                  </div>
                  <h3 className="truncate text-sm font-semibold">{album.title}</h3>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {album.artist_name || "Unknown Artist"}
                  </p>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-4 text-2xl font-bold">Collections</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <Link
                key={section.id}
                to={section.path}
                className="group rounded-2xl border border-white/10 bg-card/55 p-4 shadow-glass transition hover:bg-white/10 sm:p-5"
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                  <Icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-lg font-bold">{section.label}</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Browse your {section.label.toLowerCase()}
                </p>
              </Link>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-2xl font-bold">More Collections</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {smartCollections.map((collection) => (
            <Link
              key={collection.id}
              to={`/library/smart/${collection.id}`}
              className="rounded-2xl border border-white/10 bg-card/55 p-4 shadow-glass transition hover:bg-white/10"
            >
              <h3 className="text-lg font-bold">{collection.label}</h3>
              <p className="mt-2 text-sm text-muted-foreground">Auto-built from your library</p>
            </Link>
          ))}
        </div>
      </section>
    </motion.div>
  );
}

interface LibraryPersonalityCard {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  path: string;
  artworkUrl: string | null;
  icon: LucideIcon;
  gradient: string;
}

function LibraryPersonalityCarousel({ cards, activeIndex, onActiveIndexChange }: { cards: LibraryPersonalityCard[]; activeIndex: number; onActiveIndexChange: (index: number) => void }) {
  const card = cards[activeIndex % cards.length];
  const Icon = card.icon;

  return (
    <div className="relative min-h-[17rem] overflow-hidden rounded-[1.5rem] border border-white/10 bg-card/55 shadow-glass sm:min-h-[19rem]">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={card.id}
          initial={{ opacity: 0, x: 32, scale: 0.985 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: -32, scale: 0.985 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className={`absolute inset-0 overflow-hidden bg-gradient-to-br ${card.gradient}`}
        >
          {card.artworkUrl && <ArtworkImage src={card.artworkUrl} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-35 blur-xl" />}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-white/10" />
          <div className="relative flex h-full min-h-[17rem] flex-col justify-between p-5 text-white sm:min-h-[19rem] sm:p-7">
            <div className="flex items-center justify-end gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-xl">
                <Icon className="h-5 w-5" />
              </div>
            </div>
            <div className="max-w-lg">
              <p className="mb-1 text-sm font-semibold text-white/70">{card.eyebrow}</p>
              <h1 className="line-clamp-2 text-3xl font-black tracking-normal sm:text-4xl">{card.title}</h1>
              <p className="mt-2 line-clamp-2 text-sm leading-6 text-white/70">{card.description}</p>
              <Button className="mt-4 border-white/15 bg-white/15 text-white hover:bg-white/25" variant="glass" asChild>
                <Link to={card.path}>Open collection</Link>
              </Button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>

      <div className="absolute bottom-4 right-4 z-10 flex items-center gap-1.5">
        <Button size="icon" variant="glass" className="h-8 w-8 border-white/15 bg-black/20 text-white" aria-label="Previous library card" onClick={() => onActiveIndexChange((activeIndex - 1 + cards.length) % cards.length)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex gap-1 px-1" aria-label={`Library card ${activeIndex + 1} of ${cards.length}`}>
          {cards.map((item, index) => (
            <button key={item.id} type="button" className={`h-1.5 rounded-full transition-all ${index === activeIndex ? "w-5 bg-white" : "w-1.5 bg-white/45 hover:bg-white/70"}`} onClick={() => onActiveIndexChange(index)} aria-label={`Show ${item.title}`} />
          ))}
        </div>
        <Button size="icon" variant="glass" className="h-8 w-8 border-white/15 bg-black/20 text-white" aria-label="Next library card" onClick={() => onActiveIndexChange((activeIndex + 1) % cards.length)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

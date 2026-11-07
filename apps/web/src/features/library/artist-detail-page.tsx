import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ChevronDown, Disc3, Heart, Link2, ListPlus, Mic, Play, Shuffle } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { useShallow } from "zustand/react/shallow";

import { pageTransition } from "@/animations/page-motion";
import { ArtworkImage } from "@/components/cards/artwork-image";
import { SongCard } from "@/components/cards/song-card";
import { TrackRow } from "@/components/cards/track-row";
import { BigPlayButton, CollectionHero, HeroIconButton, MetaDots, StickyCollectionBar } from "@/components/collection/collection-hero";
import { useScrolledPast } from "@/hooks/use-scrolled-past";
import { DetailSkeleton, StatusChip } from "@/components/collection/collection-parts";
import { PlaybackSourceContext } from "@/components/collection/playback-source-context";
import { EqualizerBars } from "@/components/collection/equalizer-bars";
import { MediaTile, TileBadge } from "@/components/collection/media-tile";
import { BackButton } from "@/components/navigation/back-button";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { playAlbumById, playingAlbumKey } from "@/features/library/collection-playback";
import { copyLink, useCollectionPlayState } from "@/features/library/use-collection-play-state";
import { useToggleFavorite } from "@/hooks/use-music-queries";
import { cn } from "@/lib/utils";
import { cachedArtworkUrl } from "@/services/api-client";
import { getArtist, getOnlineArtist } from "@/services/music-api";
import { musicKeys } from "@/services/music-keys";
import { usePlayerStore } from "@/stores/player-store";
import type { ArtistDetail, LibraryArtistDetail } from "@/types/api";
import type { PlayerTrack } from "@/types/player";
import { libraryTrackToPlayerTrack, songToPlayerTrack } from "@/types/player";
import { pluralize } from "@/utils/format";

const POPULAR_PREVIEW = 5;
type DiscographySort = "newest" | "oldest" | "title";

interface AlbumView {
  key: string;
  title: string;
  year: number | null;
  href: string;
  publicId: string | null;
  artwork: string | null;
  fallback: string | null;
  count: number;
  offline: boolean;
}

export function ArtistDetailPage() {
  const { artistId } = useParams<{ artistId: string }>();
  const location = useLocation();
  const favoriteMutation = useToggleFavorite();
  const isOnline = location.pathname.includes("/artists/online/");
  const numericId = Number(artistId);
  const localQuery = useQuery({ queryKey: musicKeys.artist(numericId), queryFn: ({ signal }) => getArtist(numericId, signal), enabled: !isOnline && Number.isSafeInteger(numericId) && numericId > 0 });
  const onlineQuery = useQuery({ queryKey: musicKeys.onlineArtist(artistId ?? ""), queryFn: ({ signal }) => getOnlineArtist(artistId!, signal), enabled: isOnline && Boolean(artistId) });
  const localArtist = isOnline ? undefined : localQuery.data;
  const onlineArtist = isOnline ? onlineQuery.data : undefined;
  const activeQuery = isOnline ? onlineQuery : localQuery;
  const isFavorited = localArtist?.is_favorited ?? false;
  const [showAllPopular, setShowAllPopular] = useState(false);
  const [discographySort, setDiscographySort] = useState<DiscographySort>("newest");
  const heroRef = useRef<HTMLElement>(null);
  const scrolledPast = useScrolledPast(heroRef);
  const playingAlbumId = usePlayerStore(useShallow((state) => playingAlbumKey(state.currentSong)));

  const view = useMemo(() => buildView(localArtist, onlineArtist), [localArtist, onlineArtist]);
  const playerTracks = useMemo<PlayerTrack[]>(() => [
    ...(localArtist?.top_songs.map(songToPlayerTrack) ?? []),
    ...(onlineArtist?.top_tracks.map(libraryTrackToPlayerTrack) ?? []),
  ], [localArtist, onlineArtist]);
  const playState = useCollectionPlayState(playerTracks, { kind: "artist", id: artistId ?? "" });
  const albums = useMemo(() => sortAlbums(view?.albums ?? [], discographySort), [view, discographySort]);
  const latest = useMemo(() => sortAlbums(view?.albums ?? [], "newest")[0] ?? null, [view]);

  async function handleToggleFavorite() {
    if (!localArtist || favoriteMutation.isPending) return;
    try {
      const result = await favoriteMutation.mutateAsync({ entity_type: "artist", entity_id: localArtist.id });
      toast(result.is_favorited ? `Following ${localArtist.name}` : `Removed ${localArtist.name} from favorites`, "success");
    } catch (error) { toast(error instanceof Error ? error.message : "Could not update favorite", "error"); }
  }

  if (activeQuery.isLoading) return <DetailSkeleton round />;

  if (!view) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center text-muted-foreground">
        <Mic className="h-12 w-12" />
        <p>{activeQuery.error?.message || "Artist not found"}</p>
        {activeQuery.error && <Button variant="glass" onClick={() => void activeQuery.refetch()}>Retry</Button>}
      </div>
    );
  }

  const artistArtworkUrl = cachedArtworkUrl(view.artwork);
  const popularCount = view.localSongs.length + view.onlineTracks.length;
  const visiblePopular = showAllPopular ? Number.POSITIVE_INFINITY : POPULAR_PREVIEW;
  const years = view.albums.map((album) => album.year).filter((year): year is number => Boolean(year));
  const activeSpan = years.length ? (Math.min(...years) === Math.max(...years) ? String(years[0]) : `${Math.min(...years)}–${Math.max(...years)}`) : null;

  return (
    <PlaybackSourceContext.Provider value={{ kind: "artist", id: artistId ?? "" }}>
    <motion.div {...pageTransition} className="mx-auto max-w-7xl space-y-8 px-3 py-4 sm:px-6 lg:px-8 lg:py-7">
      <BackButton fallback="/library/artists" />
      <CollectionHero
        heroRef={heroRef}
        kind="Artist"
        shape="circle"
        title={view.name}
        artworkUrl={view.artwork}
        artwork={artistArtworkUrl
          ? <ArtworkImage src={artistArtworkUrl} fallbackSrc={cachedArtworkUrl(localArtist?.artwork_url)} alt={view.name} className="h-full w-full object-cover" />
          : <div className="flex h-full w-full items-center justify-center bg-white/10"><Mic className="h-20 w-20 text-muted-foreground" /></div>}
        badges={<>{isOnline && <StatusChip>YouTube Music</StatusChip>}{isFavorited && <StatusChip><Heart className="h-3 w-3 fill-current" />Favorite</StatusChip>}</>}
        meta={<MetaDots items={[
          <span key="songs" className="font-semibold text-foreground">{pluralize(view.songCount, "song")}</span>,
          pluralize(view.albumCount, "album"),
          activeSpan,
        ]} />}
      >
        <BigPlayButton label={playState.isPlaying ? "Pause" : "Play"} isPlaying={playState.isPlaying} onClick={playState.playOrToggle} disabled={playerTracks.length === 0} />
        <HeroIconButton label="Shuffle" onClick={playState.shuffle} disabled={playerTracks.length === 0}><Shuffle className="h-5 w-5" /></HeroIconButton>
        {!isOnline && (
          <HeroIconButton label={isFavorited ? "Remove artist from favorites" : "Add artist to favorites"} active={isFavorited} disabled={favoriteMutation.isPending} onClick={() => void handleToggleFavorite()}>
            <Heart className={cn("h-5 w-5", isFavorited && "fill-current")} />
          </HeroIconButton>
        )}
        <HeroIconButton label="Add top songs to queue" onClick={playState.queueAll} disabled={playerTracks.length === 0}><ListPlus className="h-5 w-5" /></HeroIconButton>
        <HeroIconButton label="Copy artist link" onClick={() => void copyLink(window.location.href, "Artist link")}><Link2 className="h-5 w-5" /></HeroIconButton>
      </CollectionHero>

      {(popularCount > 0 || latest) && (
        <div className={cn("grid gap-6", latest && popularCount > 0 && "lg:grid-cols-[minmax(0,1fr)_20rem]")}>
          {popularCount > 0 && (
            <section className="space-y-3">
              <h2 className="text-2xl font-bold tracking-tight">Popular</h2>
              <div className="rounded-[1.6rem] border border-white/[0.06] bg-card/30 p-2">
                {view.localSongs.slice(0, visiblePopular).map((song, index) => (
                  <SongCard key={song.id} song={song} playerContext={playerTracks} showAlbum variant="list" number={index + 1} />
                ))}
                {view.onlineTracks.slice(0, Math.max(0, visiblePopular - view.localSongs.length)).map((track, index) => (
                  <TrackRow
                    key={track.id}
                    variant="list"
                    number={view.localSongs.length + index + 1}
                    track={libraryTrackToPlayerTrack(track)}
                    context={playerTracks}
                    explicit={track.explicit}
                    subtitle={track.artist_name || "Unknown Artist"}
                    isDownloaded={track.is_downloaded}
                  />
                ))}
                {popularCount > POPULAR_PREVIEW && (
                  <button type="button" aria-expanded={showAllPopular} onClick={() => setShowAllPopular(!showAllPopular)} className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold text-muted-foreground transition hover:bg-white/[0.05] hover:text-foreground">
                    {showAllPopular ? "Show less" : `Show all ${popularCount}`}<ChevronDown className={cn("h-4 w-4 transition", showAllPopular && "rotate-180")} />
                  </button>
                )}
              </div>
            </section>
          )}

          {latest && <LatestRelease album={latest} isActive={Boolean(latest.publicId) && playingAlbumId === latest.publicId} />}
        </div>
      )}

      {albums.length > 0 && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-2xl font-bold tracking-tight">Discography</h2>
            <div role="group" aria-label="Sort discography" className="flex rounded-full border border-white/10 bg-white/[0.04] p-1">
              {([["newest", "Newest"], ["oldest", "Oldest"], ["title", "A–Z"]] as const).map(([value, label]) => (
                <button key={value} type="button" aria-pressed={discographySort === value} onClick={() => setDiscographySort(value)} className={cn("rounded-full px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:text-foreground", discographySort === value && "bg-foreground text-background hover:text-background")}>{label}</button>
              ))}
            </div>
          </div>
          <div className="-mx-2 grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {albums.map((album) => {
              const isActive = Boolean(album.publicId) && playingAlbumId === album.publicId;
              return (
                <MediaTile
                  key={album.key}
                  href={album.href}
                  title={album.title}
                  subtitle={album.year ? String(album.year) : "Unknown year"}
                  meta={pluralize(album.count, "song")}
                  artworkUrl={cachedArtworkUrl(album.artwork)}
                  fallbackArtworkUrl={cachedArtworkUrl(album.fallback)}
                  placeholderIcon={Disc3}
                  isActive={isActive}
                  badge={isActive ? <TileBadge tone="primary"><EqualizerBars className="h-2.5" />Playing</TileBadge> : album.offline ? <TileBadge tone="success">Offline</TileBadge> : null}
                  onPlay={album.publicId ? () => playAlbumById(album.publicId!) : undefined}
                  playLabel={`Play ${album.title}`}
                />
              );
            })}
          </div>
        </section>
      )}

      {popularCount === 0 && albums.length === 0 && (
        <div className="rounded-[1.6rem] border border-dashed border-white/10 p-10 text-center text-sm text-muted-foreground">Nothing by {view.name} is in your library yet.</div>
      )}

      <StickyCollectionBar visible={scrolledPast} round title={view.name} artworkUrl={artistArtworkUrl} onPlay={playState.playOrToggle} playLabel={playState.isPlaying ? `Pause ${view.name}` : `Play ${view.name}`} isPlaying={playState.isPlaying} disabled={playerTracks.length === 0} />
    </motion.div>
    </PlaybackSourceContext.Provider>
  );
}

function LatestRelease({ album, isActive }: { album: AlbumView; isActive: boolean }) {
  const artworkUrl = cachedArtworkUrl(album.artwork);
  return (
    <section className="space-y-3">
      <h2 className="text-2xl font-bold tracking-tight">Latest release</h2>
      <article className="group relative overflow-hidden rounded-[1.6rem] border border-white/[0.06] bg-card/40 p-4">
        {artworkUrl && <ArtworkImage src={artworkUrl} alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-20 blur-2xl" />}
        <div className="relative space-y-4">
          <div className="relative aspect-square overflow-hidden rounded-xl bg-white/10 shadow-glass">
            <ArtworkImage src={artworkUrl} fallbackSrc={cachedArtworkUrl(album.fallback)} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" />
          </div>
          <div className="flex items-end gap-3">
            <Link to={album.href} className="min-w-0 flex-1 outline-none after:absolute after:inset-0 after:rounded-[1.6rem] focus-visible:after:ring-2 focus-visible:after:ring-ring">
              <p className="text-xs font-bold uppercase tracking-wider text-primary">{album.year ?? "Album"}</p>
              <h3 className={cn("truncate text-lg font-black", isActive && "text-primary")} title={album.title}>{album.title}</h3>
              <p className="text-sm text-muted-foreground">{pluralize(album.count, "song")}</p>
            </Link>
            {album.publicId && (
              <button type="button" aria-label={`Play ${album.title}`} title={`Play ${album.title}`} onClick={() => void playAlbumById(album.publicId!)} className="relative z-10 grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-glow transition hover:scale-105 active:scale-95">
                {isActive ? <EqualizerBars /> : <Play className="h-5 w-5 translate-x-[1px] fill-current" />}
              </button>
            )}
          </div>
        </div>
      </article>
    </section>
  );
}

function buildView(localArtist: ArtistDetail | undefined, onlineArtist: LibraryArtistDetail | undefined) {
  if (onlineArtist) {
    return {
      name: onlineArtist.name,
      artwork: onlineArtist.thumbnail_url,
      songCount: onlineArtist.track_count,
      albumCount: onlineArtist.album_count,
      albums: onlineArtist.albums.map((album): AlbumView => ({
        key: album.public_id, title: album.title, year: album.year, href: album.canonical_url, publicId: album.public_id,
        artwork: album.artwork_path || album.artwork_url, fallback: album.artwork_url, count: album.track_count, offline: album.download_state === "downloaded",
      })),
      localSongs: [],
      onlineTracks: onlineArtist.top_tracks,
    };
  }
  if (localArtist) {
    return {
      name: localArtist.name,
      artwork: localArtist.artwork_path || localArtist.artwork_url,
      songCount: localArtist.song_count,
      albumCount: localArtist.album_count,
      albums: localArtist.albums.map((album): AlbumView => ({
        key: String(album.id), title: album.title, year: album.year, href: album.public_id ? `/albums/${album.public_id}` : "/library/albums", publicId: album.public_id,
        artwork: album.artwork_path || album.artwork_url, fallback: album.artwork_url, count: album.song_count, offline: false,
      })),
      localSongs: localArtist.top_songs,
      onlineTracks: [],
    };
  }
  return null;
}

function sortAlbums(albums: AlbumView[], sort: DiscographySort) {
  const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
  return [...albums].sort((a, b) => {
    if (sort === "title") return collator.compare(a.title, b.title);
    // Unknown years sink to the end in both directions.
    const ay = a.year ?? (sort === "newest" ? -Infinity : Infinity);
    const by = b.year ?? (sort === "newest" ? -Infinity : Infinity);
    return (sort === "newest" ? by - ay : ay - by) || collator.compare(a.title, b.title);
  });
}

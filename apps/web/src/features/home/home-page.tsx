import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Download, Music, Play, Search, Sparkles, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

import { pageTransition } from "@/animations/page-motion";
import { OnlineMusicCard } from "@/components/cards/online-music-card";
import { ArtworkImage } from "@/components/cards/artwork-image";
import { TrackRow } from "@/components/cards/track-row";
import { Section } from "@/components/cards/section";
import { EmptyState } from "@/components/empty-states/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDownloads, useRecentlyPlayedHistory } from "@/hooks/use-music-queries";
import { cachedArtworkUrl, isRequestCancelled } from "@/services/api-client";
import { getLibraryAlbumStatuses, getLibraryTrackStatuses, getYouTubeHome, getYouTubeRelated } from "@/services/music-api";
import { usePlayerStore } from "@/stores/player-store";
import type { AlbumStatusItem, HistoryEntry, OnlineHomeSection, OnlineMusicItem } from "@/types/api";
import type { PlayerTrack } from "@/types/player";
import { historyEntryToPlayerTrack, onlineItemToPlayerTrack } from "@/types/player";
import { useQuery } from "@tanstack/react-query";

const emptyHomeSections: OnlineHomeSection[] = [];

export function HomePage() {
  const { data: home, isLoading } = useQuery({
    queryKey: ["ytmusic", "home"],
    queryFn: ({ signal }) => getYouTubeHome(signal),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    refetchOnMount: true,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
  });
  const { data: recentHistory = [] } = useRecentlyPlayedHistory(20);
  const { data: downloadJobs = [] } = useDownloads();
  const { playSong, addToQueue } = usePlayerStore();
  const [heroIndex, setHeroIndex] = useState(0);
  const [downloadedTracks, setDownloadedTracks] = useState<Record<string, boolean>>({});
  const [albumStatuses, setAlbumStatuses] = useState<Record<string, AlbumStatusItem>>({});

  const sections = home?.sections ?? emptyHomeSections;
  const todayPicks = findById(sections, "today-picks");
  const apiQuickPicks = findById(sections, "quick-picks");
  const globalTrending = findById(sections, "global-trending");
  const trendingAlbums = findById(sections, "trending-albums");
  const indiaPulse = findById(sections, "india-pulse");
  const seedVideoId = recentHistory.find((entry) => entry.source === "youtube" && entry.external_id)?.external_id ?? null;
  const { data: related, isLoading: isRelatedLoading } = useQuery({
    queryKey: ["ytmusic", "related", seedVideoId],
    queryFn: ({ signal }) => getYouTubeRelated(seedVideoId!, signal),
    enabled: !apiQuickPicks && Boolean(seedVideoId),
    staleTime: 5 * 60 * 1000,
  });
  const heroItems = useMemo(() => (todayPicks?.items ?? []).filter((item) => item.playable).slice(0, 5), [todayPicks]);
  const hero = heroItems[heroIndex % Math.max(heroItems.length, 1)];
  const todayIds = useMemo(() => new Set(heroItems.map((item) => item.id)), [heroItems]);
  const quickPicks = useMemo(() => {
    if (apiQuickPicks) return apiQuickPicks;
    const relatedItems = (related?.items ?? []).filter((item) => item.playable && !todayIds.has(item.id));
    const globalItems = (globalTrending?.items ?? []).slice(10, 18).filter((item) => item.playable && !todayIds.has(item.id));
    return sectionFromItems("quick-picks", "Quick Picks", relatedItems.length > 0 ? relatedItems : globalItems, "quick_grid");
  }, [apiQuickPicks, related, globalTrending, todayIds]);
  const recentlyPlayed = recentHistory.slice(0, 5);
  const displayedPlayable = useMemo(
    () => uniqueItems([heroItems, quickPicks?.items ?? [], globalTrending?.items ?? [], indiaPulse?.items ?? []].flat()),
    [heroItems, quickPicks, globalTrending, indiaPulse],
  );
  const downloadJobsKey = downloadJobs.map((job) => `${job.id}:${job.status}:${job.progress}`).join(",");

  useEffect(() => {
    const externalIds = displayedPlayable.map((item) => item.id);
    const controller = new AbortController();
    if (externalIds.length === 0) {
      setDownloadedTracks({});
      return () => controller.abort();
    }

    Promise.all(chunk(externalIds, 200).map((ids) => getLibraryTrackStatuses(ids, controller.signal)))
      .then((responses) => {
        if (controller.signal.aborted) return;
        setDownloadedTracks(Object.fromEntries(responses.flatMap((response) => response.statuses).map((status) => [status.external_id, status.is_downloaded])));
      })
      .catch((statusError: unknown) => {
        if (!isRequestCancelled(statusError)) console.error("Could not check Home track download status:", statusError);
      });
    return () => controller.abort();
  }, [displayedPlayable, downloadJobsKey]);

  useEffect(() => {
    const albumIds = Array.from(
      new Set(
        (trendingAlbums?.items ?? [])
          .filter((item) => item.kind === "album")
          .map((item) => item.browse_id || item.id)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const controller = new AbortController();
    if (albumIds.length === 0) {
      setAlbumStatuses({});
      return () => controller.abort();
    }
    getLibraryAlbumStatuses(albumIds, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setAlbumStatuses(Object.fromEntries(response.statuses.map((status) => [status.external_id, status])));
      })
      .catch((statusError: unknown) => {
        if (isRequestCancelled(statusError)) return;
        setAlbumStatuses({});
        console.error("Could not check Home album library status:", statusError);
      });
    return () => controller.abort();
  }, [trendingAlbums]);

  useEffect(() => {
    if (heroItems.length < 2) return;
    const timer = window.setInterval(() => {
      setHeroIndex((current) => (current + 1) % heroItems.length);
    }, 9000);
    return () => window.clearInterval(timer);
  }, [heroItems.length]);

  function playHero() {
    if (!hero?.playable) return;
    playSong(onlineItemToPlayerTrack(hero), heroItems.map(onlineItemToPlayerTrack));
  }

  function queueHero() {
    if (!hero?.playable) return;
    addToQueue(onlineItemToPlayerTrack(hero));
  }

  return (
    <motion.div {...pageTransition} className="mx-auto max-w-7xl space-y-8 px-3 py-4 sm:px-6 lg:px-8 lg:py-7">
      <section className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-primary sm:text-sm">Aura</p>
          <h1 className="truncate text-3xl font-black tracking-normal sm:text-5xl">Listen now</h1>
        </div>
        <Button asChild variant="glass" className="shrink-0">
          <Link to="/search">
            <Search className="h-4 w-4" />
            <span className="hidden sm:inline">Search YouTube Music</span>
            <span className="sm:hidden">Search</span>
          </Link>
        </Button>
      </section>

      {hero && (
        <HeroCarousel
          items={heroItems}
          activeIndex={heroIndex}
          onActiveIndexChange={setHeroIndex}
          onPlay={playHero}
          onQueue={queueHero}
        />
      )}

      {isLoading && !home && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="glass-panel h-40 animate-pulse rounded-2xl sm:h-56" />
          ))}
        </div>
      )}

      {quickPicks && <SongSection section={quickPicks} title="Quick Picks" limit={8} downloadedTracks={downloadedTracks} />}
      {globalTrending && <SongSection section={globalTrending} title="Trending Globally" icon={TrendingUp} ranked downloadedTracks={downloadedTracks} />}
      {trendingAlbums && <AlbumSection section={trendingAlbums} albumStatuses={albumStatuses} />}
      {indiaPulse && <SongSection section={indiaPulse} title="India Pulse" downloadedTracks={downloadedTracks} />}

      {recentlyPlayed.length > 0 && (
        <Section title="Continue Listening" eyebrow="From your playback history" icon={Music}>
          <div className="space-y-2">
            <HistoryRows entries={recentlyPlayed} />
          </div>
        </Section>
      )}

      {!isLoading && !isRelatedLoading && sections.length === 0 && !quickPicks && recentlyPlayed.length === 0 && (
        <EmptyState
          icon={Search}
          title="Start with a search"
          description="YouTube Music discovery could not be loaded. Search still works if the provider is reachable."
        />
      )}
    </motion.div>
  );
}

function HistoryRows({ entries }: { entries: HistoryEntry[] }) {
  const tracks = entries.map(historyEntryToPlayerTrack).filter((track): track is PlayerTrack => Boolean(track));

  return (
    <>
      {tracks.map((track) => (
        <HistoryRow key={track.id} track={track} context={tracks} />
      ))}
    </>
  );
}

function HistoryRow({ track, context }: { track: PlayerTrack; context: PlayerTrack[] }) {
  return <TrackRow track={track} context={context} />;
}

function HeroCarousel({
  items,
  activeIndex,
  onActiveIndexChange,
  onPlay,
  onQueue,
}: {
  items: OnlineMusicItem[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onPlay: () => void;
  onQueue: () => void;
}) {
  const hero = items[activeIndex % items.length];
  const artworkUrl = cachedArtworkUrl(hero.thumbnail, 1080);

  return (
    <section className="relative min-h-[19rem] overflow-hidden rounded-[1.35rem] border border-white/10 bg-card/70 shadow-glass sm:min-h-[23rem] sm:rounded-[1.8rem]">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={hero.id}
          initial={{ opacity: 0, x: 42 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -42 }}
          transition={{ duration: 0.32, ease: "easeOut" }}
          className="absolute inset-0"
        >
          {artworkUrl && <ArtworkImage src={artworkUrl} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-35 blur-2xl" />}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,hsl(var(--background)/0.08),hsl(var(--background)/0.88)),linear-gradient(90deg,hsl(var(--background)/0.92),hsl(var(--background)/0.38))]" />
          <div className="relative grid min-h-[19rem] gap-4 p-4 sm:min-h-[23rem] sm:p-6 md:grid-cols-[1fr_16rem] lg:grid-cols-[1fr_21rem] lg:items-center">
            <div className="flex min-w-0 flex-col justify-end md:justify-center">
              <Badge className="mb-4 w-fit">
                <Sparkles className="mr-1.5 h-3 w-3" />
                Today's Pick
              </Badge>
              <div className="mb-4 flex items-end gap-4 md:hidden">
                {artworkUrl && <ArtworkImage src={artworkUrl} alt={hero.title} className="h-24 w-24 shrink-0 rounded-2xl object-cover shadow-glow" />}
                <div className="min-w-0 flex-1" />
              </div>
              <h2 className="max-w-3xl truncate text-3xl font-black tracking-normal sm:text-5xl lg:text-6xl">{hero.title}</h2>
              <p className="mt-3 line-clamp-2 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">{hero.subtitle ?? "Fresh from YouTube Music."}</p>
              <div className="mt-5 flex flex-wrap gap-2.5">
                <Button onClick={onPlay}>
                  <Play className="h-4 w-4 fill-current" />
                  Play
                </Button>
                <Button variant="glass" onClick={onQueue}>
                  <Download className="h-4 w-4" />
                  Queue
                </Button>
              </div>
            </div>
            {artworkUrl && <ArtworkImage src={artworkUrl} alt={hero.title} className="hidden aspect-square w-full rounded-[1.25rem] object-cover shadow-glow md:block" />}
          </div>
        </motion.div>
      </AnimatePresence>
      {items.length > 1 && (
        <div className="absolute bottom-3 right-3 flex items-center gap-2">
          <Button size="icon" variant="glass" aria-label="Previous pick" onClick={() => onActiveIndexChange((activeIndex - 1 + items.length) % items.length)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="glass" aria-label="Next pick" onClick={() => onActiveIndexChange((activeIndex + 1) % items.length)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </section>
  );
}

function SongSection({ section, title, icon: Icon, ranked = false, limit = 10, downloadedTracks }: { section: OnlineHomeSection; title: string; icon?: typeof TrendingUp; ranked?: boolean; limit?: number; downloadedTracks: Record<string, boolean> }) {
  const playable = section.items.filter((item) => item.playable);
  if (playable.length === 0) return null;
  return (
    <Section title={title} eyebrow={section.subtitle ?? undefined} icon={Icon}>
      <div className="grid gap-2 lg:grid-cols-2">
        {playable.slice(0, limit).map((item, index) => (
          <div key={`${section.id}-${item.id}`} className="flex min-w-0 items-center gap-2">
            {ranked && <span className="hidden w-7 shrink-0 text-right text-sm font-bold text-muted-foreground sm:block">{index + 1}</span>}
            <OnlineMusicCard item={item} context={playable} variant="row" className="flex-1" isDownloaded={downloadedTracks[item.id]} />
          </div>
        ))}
      </div>
    </Section>
  );
}

function AlbumSection({ section, albumStatuses }: { section: OnlineHomeSection; albumStatuses: Record<string, AlbumStatusItem> }) {
  const items = section.items.filter((item) => item.kind === "album" && Boolean(item.browse_id));
  if (items.length === 0) return null;
  return (
    <Section title="Trending Albums" eyebrow={section.subtitle ?? undefined}>
      <div className="no-scrollbar -mx-3 flex gap-3 overflow-x-auto px-3 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible sm:px-0 md:grid-cols-4 xl:grid-cols-6">
        {items.slice(0, 12).map((item) => (
          <OnlineMusicCard
            key={`${section.id}-${item.kind}-${item.id}`}
            item={item}
            context={items}
            variant="tile"
            className="w-36 shrink-0 sm:w-auto"
            albumStatus={albumStatuses[item.browse_id || item.id]}
          />
        ))}
      </div>
    </Section>
  );
}

function findById(sections: OnlineHomeSection[], id: string) {
  return sections.find((section) => section.id === id);
}

function uniqueItems(items: OnlineMusicItem[]): OnlineMusicItem[] {
  const seen = new Set<string>();
  const result: OnlineMusicItem[] = [];
  for (const item of items) {
    if (!item.playable || seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

function sectionFromItems(id: string, title: string, items: OnlineMusicItem[], layout: OnlineHomeSection["layout"]): OnlineHomeSection | undefined {
  if (items.length === 0) return undefined;
  return { id, title, subtitle: null, layout, items, continuation: null };
}

function chunk<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

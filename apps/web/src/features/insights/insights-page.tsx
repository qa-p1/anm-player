import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { musicKeys } from "@/services/music-keys";
import { invalidateHistory } from "@/services/music-invalidation";
import { motion } from "framer-motion";
import { CheckCircle2, ChevronDown, History, LoaderCircle, Play, SkipForward, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { pageTransition } from "@/animations/page-motion";
import { ArtworkImage } from "@/components/cards/artwork-image";
import { TrackMetadata } from "@/components/cards/track-metadata";
import { resolveArtistPage } from "@/features/navigation/resolve-music-page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { cachedArtworkUrl } from "@/services/api-client";
import {
  clearHistory,
  deleteHistoryEntry,
  getListeningInsights,
  listHistory,
} from "@/services/music-api";
import { usePlayerStore } from "@/stores/player-store";
import type { HistoryEntry, ListeningInsights } from "@/types/api";
import { historyEntryToPlayerTrack } from "@/types/player";

const periods = [
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
  { label: "All time", value: 0 },
] as const;

const HISTORY_PAGE = 25;

type HistoryFilter = "all" | "played" | "completed" | "skipped";

export function InsightsPage() {
  const [period, setPeriod] = useState(30);
  const client = useQueryClient();
  const insightsQuery = useQuery({ queryKey: musicKeys.insights(period), queryFn: ({ signal }) => getListeningInsights(period, signal) });
  // Older entries are appended to the same list each time "Load more" is used.
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const historyQuery = useInfiniteQuery({
    queryKey: musicKeys.historyLog(historyFilter),
    queryFn: ({ pageParam, signal }) => listHistory(HISTORY_PAGE, pageParam, signal, historyFilter === "all" ? undefined : historyFilter),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => (lastPage.length < HISTORY_PAGE ? undefined : pages.reduce((total, page) => total + page.length, 0)),
  });
  const insights = insightsQuery.data;
  const history = useMemo(() => {
    const seen = new Set<number>();
    return (historyQuery.data?.pages ?? []).flat().filter((entry) => !seen.has(entry.id) && Boolean(seen.add(entry.id)));
  }, [historyQuery.data]);
  const isLoading = insightsQuery.isLoading || historyQuery.isLoading;
  const error = insightsQuery.error || historyQuery.error;
  const [isClearing, setIsClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const playSong = usePlayerStore((state) => state.playSong);

  // The server filters by event type, so every "Load more" stays on-filter.
  const filteredHistory = history;
  const historyGroups = useMemo(() => groupByDay(filteredHistory), [filteredHistory]);

  async function removeHistoryEntry(entryId: number) {
    try {
      await deleteHistoryEntry(entryId);
      await invalidateHistory(client);
      toast("History entry removed", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not remove history entry", "error");
    }
  }

  async function removeAllHistory() {
    setConfirmClear(false);
    setIsClearing(true);
    try {
      const result = await clearHistory();
      await invalidateHistory(client);
      toast(`Cleared ${result.deleted} history ${result.deleted === 1 ? "entry" : "entries"}`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not clear listening history", "error");
    } finally {
      setIsClearing(false);
    }
  }

  function replay(entry: HistoryEntry) {
    const track = historyEntryToPlayerTrack(entry);
    if (!track) {
      toast("This history entry no longer has a playable source", "error");
      return;
    }
    const context = filteredHistory.map(historyEntryToPlayerTrack).filter((item) => item !== null);
    playSong(track, context);
  }

  return (
    <motion.div {...pageTransition} className="mx-auto max-w-7xl space-y-8 px-3 py-4 sm:px-6 lg:px-8 lg:py-7">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="text-4xl font-black tracking-tight sm:text-6xl">Insights</h1>
        <div role="group" aria-label="Insights period" className="flex w-fit rounded-full border border-white/10 bg-white/[0.04] p-1">
          {periods.map((option) => (
            <button key={option.value} type="button" aria-pressed={period === option.value} onClick={() => setPeriod(option.value)} className={cn("rounded-full px-3.5 py-1.5 text-xs font-semibold text-muted-foreground transition hover:text-foreground", period === option.value && "bg-foreground text-background hover:text-background")}>
              {option.label}
            </button>
          ))}
        </div>
      </header>

      {error && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-red-400">{error.message}<Button size="sm" variant="ghost" onClick={() => { void insightsQuery.refetch(); void historyQuery.refetch(); }}>Retry</Button></div>}
      {isLoading && !insights ? (
        <div role="status" aria-label="Loading insights" className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-32 animate-pulse rounded-[1.4rem] bg-white/[0.05]" />)}</div>
      ) : insights ? (
        <>
          <SummaryGrid insights={insights} />
          <section className="grid gap-4 xl:grid-cols-[1.45fr_0.8fr]">
            <ActivityChart insights={insights} />
            <ListeningClock insights={insights} />
          </section>
          <section className="grid gap-4 lg:grid-cols-2">
            <TopTracks insights={insights} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <RankingCard title="Top artists" items={insights.top_artists.map((item) => ({
                primary: item.name,
                artist: true,
                secondary: `${item.play_count} ${item.play_count === 1 ? "play" : "plays"}`,
                value: compactDuration(item.listening_seconds),
              }))} />
              <RankingCard title="Top albums" items={insights.top_albums.map((item) => ({
                primary: item.title,
                secondary: item.artist_name || "Unknown artist",
                value: `${item.play_count}×`,
              }))} />
            </div>
          </section>
        </>
      ) : (
        <div className="rounded-[1.6rem] border border-dashed border-white/10 p-8 text-center text-muted-foreground">No listening data yet.</div>
      )}

      <section aria-label="History" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-bold tracking-tight">History</h2>
          <div className="flex items-center gap-2">
            <div role="group" aria-label="Filter history" className="no-scrollbar flex overflow-x-auto rounded-full border border-white/10 bg-white/[0.04] p-1">
              {(["all", "played", "completed", "skipped"] as const).map((filter) => (
                <button key={filter} type="button" aria-pressed={historyFilter === filter} onClick={() => setHistoryFilter(filter)} className={cn("shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold capitalize text-muted-foreground transition hover:text-foreground", historyFilter === filter && "bg-foreground text-background hover:text-background")}>{filter}</button>
              ))}
            </div>
            {(history.length > 0 || historyFilter !== "all") && (
              <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-red-400" aria-label="Clear history" title="Clear history" disabled={isClearing} onClick={() => setConfirmClear(true)}>
                {isClearing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </Button>
            )}
          </div>
        </div>

        {historyQuery.isLoading ? (
          <div className="space-y-1">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-14 animate-pulse rounded-xl bg-white/[0.04]" />)}</div>
        ) : historyGroups.length > 0 ? (
          <div className="space-y-5">
            {historyGroups.map((group) => (
              <div key={group.key}>
                <h3 className="sticky top-0 z-10 mb-1 bg-background/80 px-2 py-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground backdrop-blur">{group.label}</h3>
                <div className="rounded-[1.4rem] border border-white/[0.06] bg-card/30 p-1.5">
                  {group.entries.map((entry) => (
                    <HistoryRow key={entry.id} entry={entry} onReplay={() => replay(entry)} onRemove={() => removeHistoryEntry(entry.id)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-[1.6rem] border border-dashed border-white/10 p-8 text-center">
            <History className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-semibold">{historyFilter === "all" ? "Nothing played yet" : `No ${historyFilter} plays`}</p>
          </div>
        )}

        {historyQuery.hasNextPage && (
          <div className="flex justify-center">
            <Button variant="glass" disabled={historyQuery.isFetchingNextPage} onClick={() => void historyQuery.fetchNextPage()}>
              {historyQuery.isFetchingNextPage ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
              {historyQuery.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </section>

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent>
          <DialogHeader><DialogTitle>Clear all listening history?</DialogTitle><DialogDescription>Insights will reset. This cannot be undone.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="ghost" onClick={() => setConfirmClear(false)}>Cancel</Button><Button variant="glass" className="text-red-400" onClick={() => void removeAllHistory()}>Clear history</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

function SummaryGrid({ insights }: { insights: ListeningInsights }) {
  const { summary } = insights;
  const cards = [
    { label: "Listening time", value: compactDuration(summary.listening_seconds), helper: `${summary.active_days} active ${summary.active_days === 1 ? "day" : "days"}` },
    { label: "Plays", value: summary.total_plays.toLocaleString(), helper: `${summary.unique_tracks.toLocaleString()} unique tracks` },
    { label: "Finished", value: `${summary.completion_rate.toFixed(0)}%`, helper: `${summary.completed_plays.toLocaleString()} complete plays` },
    { label: "Streak", value: `${summary.current_streak_days}d`, helper: `${summary.unique_artists.toLocaleString()} artists` },
  ];
  return (
    <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map(({ label, value, helper }, index) => (
        <div key={label} className={cn("rounded-[1.4rem] border border-white/[0.06] p-4 sm:p-5", index === 0 ? "bg-gradient-to-br from-primary/25 to-primary/5" : "bg-card/40")}>
          <p className="text-xs font-semibold text-muted-foreground">{label}</p>
          <p className="mt-2 text-3xl font-black tabular-nums tracking-tight sm:text-4xl">{value}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{helper}</p>
        </div>
      ))}
    </section>
  );
}

function ActivityChart({ insights }: { insights: ListeningInsights }) {
  const visible = insights.daily.slice(-30);
  const maximum = Math.max(1, ...visible.map((day) => Math.max(day.play_count, day.listening_seconds / 180)));
  return (
    <section className="rounded-[1.6rem] border border-white/[0.06] bg-card/40 p-5 pb-8 sm:p-6 sm:pb-9">
      <h2 className="mb-6 text-lg font-bold">Activity</h2>
      <div className="flex h-48 items-end gap-1" aria-label="Daily listening activity chart">
        {visible.map((day, index) => {
          const magnitude = Math.max(day.play_count, day.listening_seconds / 180);
          const height = magnitude === 0 ? 3 : Math.max(8, (magnitude / maximum) * 100);
          return (
            <div key={day.date} className="group relative flex h-full min-w-0 flex-1 items-end">
              <div className="w-full rounded-t-sm bg-gradient-to-t from-primary/55 to-primary transition group-hover:brightness-125" style={{ height: `${height}%` }} />
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-popover px-2 py-1 text-[0.68rem] shadow-xl group-hover:block">
                {new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}: {day.play_count} plays · {compactDuration(day.listening_seconds)}
              </div>
              {index % 7 === 0 && <span className="absolute -bottom-5 left-0 text-[0.6rem] text-muted-foreground">{new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ListeningClock({ insights }: { insights: ListeningInsights }) {
  const maximum = Math.max(1, ...insights.hourly.map((bucket) => bucket.play_count));
  return (
    <section className="rounded-[1.6rem] border border-white/[0.06] bg-card/40 p-5 sm:p-6">
      <h2 className="text-lg font-bold">By hour</h2>
      <div className="mt-6 grid grid-cols-6 gap-2 sm:grid-cols-8 xl:grid-cols-6">
        {insights.hourly.map((bucket) => (
          <div key={bucket.hour} className="text-center">
            <div
              className="aspect-square rounded-lg border border-white/5 bg-primary"
              style={{ opacity: bucket.play_count === 0 ? 0.08 : 0.22 + (bucket.play_count / maximum) * 0.78 }}
              title={`${hourLabel(bucket.hour)} · ${bucket.play_count} plays`}
            />
            <span className="mt-1 block text-[0.58rem] text-muted-foreground">{bucket.hour % 3 === 0 ? hourLabel(bucket.hour) : ""}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function TopTracks({ insights }: { insights: ListeningInsights }) {
  return (
    <section className="rounded-[1.6rem] border border-white/[0.06] bg-card/40 p-5 sm:p-6">
      <h2 className="mb-4 text-lg font-bold">Top tracks</h2>
      {insights.top_tracks.length > 0 ? (
        <ol className="space-y-1">
          {insights.top_tracks.slice(0, 8).map((track, index) => (
            <li key={track.key} className="flex items-center gap-3 rounded-2xl p-2 transition hover:bg-white/5">
              <span className="w-5 text-center text-xs tabular-nums text-muted-foreground">{index + 1}</span>
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/10"><ArtworkImage src={cachedArtworkUrl(track.artwork_url)} alt="" className="h-full w-full object-cover" /></div>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{track.title}</p>{track.artist_name ? <ArtistName name={track.artist_name} className="block max-w-full truncate text-xs text-muted-foreground" /> : <p className="truncate text-xs text-muted-foreground">Unknown artist</p>}</div>
              <div className="text-right"><p className="text-sm font-bold tabular-nums">{track.play_count}×</p><p className="text-[0.65rem] text-muted-foreground">{compactDuration(track.listening_seconds)}</p></div>
            </li>
          ))}
        </ol>
      ) : <p className="py-10 text-center text-sm text-muted-foreground">Your top tracks will appear after a few plays.</p>}
    </section>
  );
}

function RankingCard({ title, items }: { title: string; items: Array<{ primary: string; secondary: string; value: string; artist?: boolean }> }) {
  return (
    <section className="rounded-[1.6rem] border border-white/[0.06] bg-card/40 p-5">
      <h2 className="mb-4 text-lg font-bold">{title}</h2>
      {items.length > 0 ? <ol className="space-y-3">{items.slice(0, 6).map((item, index) => (
        <li key={`${item.primary}-${index}`} className="flex items-center gap-3"><span className="text-xs text-muted-foreground">{index + 1}</span><div className="min-w-0 flex-1">{item.artist ? <ArtistName name={item.primary} className="block max-w-full truncate text-sm font-semibold" /> : <p className="truncate text-sm font-semibold">{item.primary}</p>}<p className="truncate text-xs text-muted-foreground">{item.secondary}</p></div><span className="text-xs font-bold tabular-nums">{item.value}</span></li>
      ))}</ol> : <p className="py-8 text-center text-sm text-muted-foreground">Not enough listening data yet.</p>}
    </section>
  );
}

function HistoryRow({ entry, onReplay, onRemove }: { entry: HistoryEntry; onReplay: () => void; onRemove: () => void }) {
  const title = entry.song?.title || entry.title || "Unknown track";
  const artwork = cachedArtworkUrl(entry.song?.artwork_path || entry.song?.artwork_url || entry.artwork_url);
  const track = historyEntryToPlayerTrack(entry);
  const EventIcon = entry.event_type === "completed" ? CheckCircle2 : entry.event_type === "skipped" ? SkipForward : Play;
  const playedAt = new Date(entry.played_at);
  return (
    <article className="group relative flex items-center gap-3 rounded-xl p-2 transition hover:bg-white/[0.05]">
      {/* Sibling overlay keeps artist/album links clickable without nesting them in a button. */}
      <button type="button" onClick={onReplay} disabled={!track} className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed" aria-label={`Play ${title}`} />
      <div className={cn("pointer-events-none relative z-[1] flex min-w-0 flex-1 items-center gap-3", !track && "opacity-50")}>
        <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-white/10">
          <ArtworkImage src={artwork} alt="" className="h-full w-full object-cover" />
          <span className="absolute inset-0 grid place-items-center bg-black/45 opacity-0 transition group-hover:opacity-100"><Play className="h-4 w-4 fill-white text-white" /></span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{title}</span>
          {track
            ? <TrackMetadata track={track} className="flex text-xs text-muted-foreground" linkClassName="pointer-events-auto" />
            : <span className="block truncate text-xs text-muted-foreground">{entry.song?.artist_name || entry.artist_name || "Unknown artist"}</span>}
        </span>
        <span title={entry.event_type} className={cn("pointer-events-auto hidden shrink-0 sm:block", entry.event_type === "completed" ? "text-emerald-400" : entry.event_type === "skipped" ? "text-amber-400" : "text-muted-foreground")}><EventIcon aria-label={entry.event_type} className="h-3.5 w-3.5" /></span>
        <time dateTime={entry.played_at} className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{Number.isFinite(playedAt.getTime()) ? playedAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : ""}</time>
      </div>
      <Button size="icon" variant="ghost" className="relative z-10 h-8 w-8 shrink-0 text-muted-foreground opacity-100 hover:text-red-400 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100" aria-label={`Remove ${title} from history`} onClick={onRemove}><Trash2 className="h-3.5 w-3.5" /></Button>
    </article>
  );
}

/** Artist name that opens the real artist page (resolved by name). */
function ArtistName({ name, className }: { name: string; className?: string }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  async function open() {
    if (busy) return;
    setBusy(true);
    try {
      const href = await resolveArtistPage(name);
      if (href) navigate(href);
      else toast(`Couldn't find a page for “${name}”`, "error");
    } catch {
      toast(`Couldn't open “${name}” right now`, "error");
    } finally {
      setBusy(false);
    }
  }
  return <button type="button" onClick={() => void open()} aria-busy={busy} className={cn("text-left transition hover:text-primary hover:underline", busy && "animate-pulse", className)}>{name}</button>;
}

function groupByDay(entries: HistoryEntry[]) {
  const today = new Date();
  const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const groups: Array<{ key: string; label: string; entries: HistoryEntry[] }> = [];
  for (const entry of entries) {
    const date = new Date(entry.played_at);
    const valid = Number.isFinite(date.getTime());
    const key = valid ? dayKey(date) : "unknown";
    const label = !valid ? "Earlier" : key === dayKey(today) ? "Today" : key === dayKey(yesterday) ? "Yesterday"
      : date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
    const last = groups[groups.length - 1];
    if (last?.key === key) last.entries.push(entry);
    else groups.push({ key, label, entries: [entry] });
  }
  return groups;
}

function compactDuration(seconds: number) {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function hourLabel(hour: number) {
  if (hour === 0) return "12a";
  if (hour === 12) return "12p";
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

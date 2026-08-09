import { motion } from "framer-motion";
import {
  BarChart3,
  CheckCircle2,
  Clock3,
  Flame,
  History,
  Music2,
  Play,
  SkipForward,
  Trash2,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { pageTransition } from "@/animations/page-motion";
import { ArtworkImage } from "@/components/cards/artwork-image";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { cachedArtworkUrl, isRequestCancelled } from "@/services/api-client";
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

type HistoryFilter = "all" | "played" | "completed" | "skipped";

export function InsightsPage() {
  const [period, setPeriod] = useState(30);
  const [insights, setInsights] = useState<ListeningInsights | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isClearing, setIsClearing] = useState(false);
  const playSong = usePlayerStore((state) => state.playSong);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    Promise.all([
      getListeningInsights(period, controller.signal),
      listHistory(100, 0, controller.signal),
    ])
      .then(([nextInsights, nextHistory]) => {
        if (controller.signal.aborted) return;
        setInsights(nextInsights);
        setHistory(nextHistory);
      })
      .catch((error: unknown) => {
        if (!isRequestCancelled(error)) {
          toast(error instanceof Error ? error.message : "Could not load listening insights", "error");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [period]);

  const filteredHistory = useMemo(
    () => history.filter((entry) => historyFilter === "all" || entry.event_type === historyFilter),
    [history, historyFilter],
  );

  async function removeHistoryEntry(entryId: number) {
    try {
      await deleteHistoryEntry(entryId);
      setHistory((entries) => entries.filter((entry) => entry.id !== entryId));
      setInsights(await getListeningInsights(period));
      toast("History entry removed", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not remove history entry", "error");
    }
  }

  async function removeAllHistory() {
    if (!window.confirm("Clear every listening-history entry? This cannot be undone.")) return;
    setIsClearing(true);
    try {
      const result = await clearHistory();
      setHistory([]);
      setInsights(await getListeningInsights(period));
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
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-sm font-semibold text-primary">Your listening</p>
          <h1 className="text-4xl font-black tracking-normal sm:text-5xl">Insights</h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            See the rhythms, artists, and records shaping your library.
          </p>
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Insights period">
          {periods.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={period === option.value ? "default" : "glass"}
              aria-pressed={period === option.value}
              onClick={() => setPeriod(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </header>

      {isLoading && !insights ? (
        <div className="grid min-h-72 place-items-center text-sm text-muted-foreground">Calculating your listening patterns…</div>
      ) : insights ? (
        <>
          <SummaryGrid insights={insights} />
          <section className="grid gap-5 xl:grid-cols-[1.45fr_0.8fr]">
            <ActivityChart insights={insights} />
            <ListeningClock insights={insights} />
          </section>
          <section className="grid gap-5 lg:grid-cols-2">
            <TopTracks insights={insights} />
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <RankingCard title="Top artists" icon={Users} items={insights.top_artists.map((item) => ({
                primary: item.name,
                secondary: `${item.play_count} ${item.play_count === 1 ? "play" : "plays"}`,
                value: compactDuration(item.listening_seconds),
              }))} />
              <RankingCard title="Top albums" icon={Music2} items={insights.top_albums.map((item) => ({
                primary: item.title,
                secondary: item.artist_name || "Unknown artist",
                value: `${item.play_count}×`,
              }))} />
            </div>
          </section>
        </>
      ) : (
        <div className="glass-panel rounded-3xl p-8 text-center text-muted-foreground">No listening data is available yet.</div>
      )}

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Playback log</p>
            <h2 className="mt-1 text-2xl font-bold">Listening history</h2>
          </div>
          {history.length > 0 && (
            <Button variant="glass" size="sm" className="text-red-400" disabled={isClearing} onClick={removeAllHistory}>
              <Trash2 className="h-4 w-4" />
              {isClearing ? "Clearing…" : "Clear history"}
            </Button>
          )}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {(["all", "played", "completed", "skipped"] as const).map((filter) => (
            <Button
              key={filter}
              size="sm"
              variant={historyFilter === filter ? "default" : "glass"}
              onClick={() => setHistoryFilter(filter)}
            >
              {filter === "all" ? "All events" : filter[0].toUpperCase() + filter.slice(1)}
            </Button>
          ))}
        </div>
        {filteredHistory.length > 0 ? (
          <div className="space-y-2">
            {filteredHistory.map((entry) => (
              <HistoryRow key={entry.id} entry={entry} onReplay={() => replay(entry)} onRemove={() => removeHistoryEntry(entry.id)} />
            ))}
          </div>
        ) : (
          <div className="glass-panel rounded-3xl p-8 text-center">
            <History className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-semibold">No matching history</p>
            <p className="mt-1 text-sm text-muted-foreground">Play some music and it will appear here.</p>
          </div>
        )}
      </section>
    </motion.div>
  );
}

function SummaryGrid({ insights }: { insights: ListeningInsights }) {
  const { summary } = insights;
  const cards = [
    { label: "Listening time", value: compactDuration(summary.listening_seconds), helper: `${summary.active_days} active days`, icon: Clock3 },
    { label: "Tracks played", value: summary.total_plays.toLocaleString(), helper: `${summary.unique_tracks} unique tracks`, icon: Play },
    { label: "Completion", value: `${summary.completion_rate.toFixed(1)}%`, helper: `${summary.completed_plays} finished`, icon: CheckCircle2 },
    { label: "Current streak", value: `${summary.current_streak_days}d`, helper: `${summary.unique_artists} artists heard`, icon: Flame },
  ];
  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map(({ label, value, helper, icon: Icon }) => (
        <div key={label} className="glass-panel rounded-2xl p-4 sm:rounded-3xl sm:p-5">
          <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/12 text-primary"><Icon className="h-5 w-5" /></div>
          <p className="text-2xl font-black tabular-nums sm:text-3xl">{value}</p>
          <p className="mt-1 text-sm font-semibold">{label}</p>
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
    <section className="glass-panel rounded-3xl p-5 sm:p-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Daily pulse</p><h2 className="mt-1 text-xl font-bold">Listening activity</h2></div>
        <BarChart3 className="h-5 w-5 text-muted-foreground" />
      </div>
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
    <section className="glass-panel rounded-3xl p-5 sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Listening clock</p>
      <h2 className="mt-1 text-xl font-bold">When you press play</h2>
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
    <section className="glass-panel rounded-3xl p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-3"><Music2 className="h-5 w-5 text-primary" /><h2 className="text-xl font-bold">Top tracks</h2></div>
      {insights.top_tracks.length > 0 ? (
        <ol className="space-y-1">
          {insights.top_tracks.slice(0, 8).map((track, index) => (
            <li key={track.key} className="flex items-center gap-3 rounded-2xl p-2 transition hover:bg-white/5">
              <span className="w-5 text-center text-xs tabular-nums text-muted-foreground">{index + 1}</span>
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/10"><ArtworkImage src={cachedArtworkUrl(track.artwork_url)} alt="" className="h-full w-full object-cover" /></div>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{track.title}</p><p className="truncate text-xs text-muted-foreground">{track.artist_name || "Unknown artist"}</p></div>
              <div className="text-right"><p className="text-sm font-bold tabular-nums">{track.play_count}×</p><p className="text-[0.65rem] text-muted-foreground">{compactDuration(track.listening_seconds)}</p></div>
            </li>
          ))}
        </ol>
      ) : <p className="py-10 text-center text-sm text-muted-foreground">Your top tracks will appear after a few plays.</p>}
    </section>
  );
}

function RankingCard({ title, icon: Icon, items }: { title: string; icon: typeof Users; items: Array<{ primary: string; secondary: string; value: string }> }) {
  return (
    <section className="glass-panel rounded-3xl p-5">
      <div className="mb-4 flex items-center gap-3"><Icon className="h-5 w-5 text-primary" /><h2 className="text-lg font-bold">{title}</h2></div>
      {items.length > 0 ? <ol className="space-y-3">{items.slice(0, 6).map((item, index) => (
        <li key={`${item.primary}-${index}`} className="flex items-center gap-3"><span className="text-xs text-muted-foreground">{index + 1}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{item.primary}</p><p className="truncate text-xs text-muted-foreground">{item.secondary}</p></div><span className="text-xs font-bold tabular-nums">{item.value}</span></li>
      ))}</ol> : <p className="py-8 text-center text-sm text-muted-foreground">Not enough listening data yet.</p>}
    </section>
  );
}

function HistoryRow({ entry, onReplay, onRemove }: { entry: HistoryEntry; onReplay: () => void; onRemove: () => void }) {
  const title = entry.song?.title || entry.title || "Unknown track";
  const artist = entry.song?.artist_name || entry.artist_name || "Unknown artist";
  const artwork = cachedArtworkUrl(entry.song?.artwork_path || entry.song?.artwork_url || entry.artwork_url);
  const playable = Boolean(historyEntryToPlayerTrack(entry));
  const EventIcon = entry.event_type === "completed" ? CheckCircle2 : entry.event_type === "skipped" ? SkipForward : Play;
  return (
    <article className="glass-panel flex items-center gap-3 rounded-2xl p-3">
      <button type="button" onClick={onReplay} disabled={!playable} className="group relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-white/10 disabled:opacity-50" aria-label={`Play ${title}`}>
        <ArtworkImage src={artwork} alt="" className="h-full w-full object-cover" />
        <span className="absolute inset-0 grid place-items-center bg-black/45 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100"><Play className="h-4 w-4 fill-white text-white" /></span>
      </button>
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{title}</p><p className="truncate text-xs text-muted-foreground">{artist} · {new Date(entry.played_at).toLocaleString()}</p></div>
      <span className={cn("hidden items-center gap-1 rounded-full px-2 py-1 text-[0.65rem] font-semibold sm:flex", entry.event_type === "completed" ? "bg-emerald-500/12 text-emerald-400" : entry.event_type === "skipped" ? "bg-amber-500/12 text-amber-400" : "bg-primary/12 text-primary")}><EventIcon className="h-3 w-3" />{entry.event_type}</span>
      <Button size="icon" variant="ghost" className="h-9 w-9 text-muted-foreground hover:text-red-400" aria-label={`Remove ${title} from history`} onClick={onRemove}><Trash2 className="h-4 w-4" /></Button>
    </article>
  );
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

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Clock3, CornerDownLeft, Disc3, ListMusic, Loader2, Mic2, Music2, Search, Zap, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";

import { ArtworkImage } from "@/components/cards/artwork-image";
import { toast } from "@/components/ui/toast";
import { libraryNavItems, navItems, smartNavItems } from "@/components/navigation/nav-items";
import { playerCommands } from "@/features/commands/player-commands";
import { matchScore } from "@/features/commands/quick-find-ranking";
import { useAllPlaylists, useRecentlyPlayedHistory } from "@/hooks/use-music-queries";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { cn } from "@/lib/utils";
import { cachedArtworkUrl } from "@/services/api-client";
import { searchLibrary, searchSongs, searchYouTubeMusic } from "@/services/music-api";
import { musicKeys } from "@/services/music-keys";
import { usePlayerStore } from "@/stores/player-store";
import { useUiStore } from "@/stores/ui-store";
import { historyEntryToPlayerTrack, libraryTrackToPlayerTrack, onlineItemToPlayerTrack, songToPlayerTrack, type PlayerTrack } from "@/types/player";
import { pluralize } from "@/utils/format";

interface QuickItem {
  id: string;
  title: string;
  subtitle?: string | null;
  icon: LucideIcon;
  artworkUrl?: string | null;
  round?: boolean;
  /** Keyboard shortcut shown on the right. */
  keys?: string;
  score: number;
  /** Set for songs so Shift+Enter can queue them instead of playing. */
  track?: PlayerTrack;
  run: () => void;
}

interface QuickGroup { title: string; items: QuickItem[]; pending?: string }

const PAGE_KEYWORDS: Record<string, string> = {
  "/settings": "preferences options theme storage region",
  "/insights": "stats statistics listening history",
  "/downloads": "offline queue",
  "/library/favorites": "liked hearts",
};
const PAGES = [...navItems, ...libraryNavItems, ...smartNavItems];
const TOP_RESULT_SCORE = 75;

export function CommandPalette() {
  const open = useUiStore((state) => state.isCommandPaletteOpen);
  const setOpen = useUiStore((state) => state.setCommandPaletteOpen);
  const hasTrack = usePlayerStore((state) => Boolean(state.currentSong));
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const term = query.trim();
  const libraryTerm = useDebouncedValue(term, 120);
  const onlineTerm = useDebouncedValue(term, 350);
  const { data: playlists = [] } = useAllPlaylists({ enabled: open });
  const { data: history = [] } = useRecentlyPlayedHistory(20, { enabled: open && !term });
  const library = useQuery({
    queryKey: musicKeys.librarySearch(libraryTerm),
    queryFn: ({ signal }) => searchLibrary(libraryTerm, 24, signal),
    enabled: open && Boolean(libraryTerm),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const localSongs = useQuery({
    queryKey: [...musicKeys.songs(), "quick-find", libraryTerm],
    queryFn: ({ signal }) => searchSongs(libraryTerm, 8, signal),
    enabled: open && Boolean(libraryTerm),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const online = useQuery({
    queryKey: ["ytmusic", "quick-find", onlineTerm],
    queryFn: ({ signal }) => searchYouTubeMusic(onlineTerm, "songs", undefined, signal),
    enabled: open && onlineTerm.length >= 2,
    staleTime: 5 * 60_000,
  });

  const groups = useMemo<QuickGroup[]>(() => {
    const go = (path: string) => () => { useUiStore.getState().setPlayerExpanded(false); navigate(path); };
    const play = (track: PlayerTrack) => () => usePlayerStore.getState().playSong(track);
    const songItem = (id: string, track: PlayerTrack, score: number): QuickItem => ({
      id, title: track.title, subtitle: [track.artistName, track.albumTitle].filter(Boolean).join(" · "), icon: Music2, artworkUrl: track.artworkUrl, score, track, run: play(track),
    });
    const pages = PAGES.map((page): QuickItem => ({ id: `page:${page.path}`, title: page.label, subtitle: "Go to page", icon: page.icon, score: matchScore(term, page.label, PAGE_KEYWORDS[page.path]), run: go(page.path) }));
    const commands = playerCommands.filter((command) => !command.needsTrack || hasTrack).map((command): QuickItem => ({ id: `command:${command.id}`, title: command.label, subtitle: command.group, icon: Zap, keys: command.keys, score: matchScore(term, command.label, command.group), run: command.run }));

    if (!term) {
      const seen = new Set<string>();
      const recent = history.flatMap((entry) => {
        const track = historyEntryToPlayerTrack(entry);
        if (!track || seen.has(track.id)) return [];
        seen.add(track.id);
        return [songItem(`recent:${track.id}`, track, 0)];
      }).slice(0, 5).map((item) => ({ ...item, icon: Clock3 }));
      return [
        { title: "Recently played", items: recent },
        { title: "Go to", items: pages },
        { title: "Player", items: commands },
      ].filter((group) => group.items.length > 0);
    }

    const results = library.data?.results ?? [];
    const seenSongs = new Set<string>();
    const songs = [
      ...results.filter((result) => result.item_type === "track" && result.track).map((result) => songItem(`track:${result.id}`, libraryTrackToPlayerTrack(result.track!), 0)),
      ...(localSongs.data ?? []).map((song) => songItem(`song:${song.id}`, songToPlayerTrack(song), 0)),
    ].filter((item) => {
      const key = `${item.title}\u0000${item.track?.artistName ?? ""}`.toLocaleLowerCase();
      if (seenSongs.has(key)) return false;
      seenSongs.add(key);
      return true;
    }).map((item) => ({ ...item, score: matchScore(term, item.title, item.track?.artistName, item.track?.albumTitle) }));
    const albums = results.filter((result) => result.item_type === "album").map((result): QuickItem => ({
      id: `album:${result.id}`, title: result.title, subtitle: result.subtitle ? `Album · ${result.subtitle}` : "Album", icon: Disc3, artworkUrl: cachedArtworkUrl(result.artwork_path || result.artwork_url), score: matchScore(term, result.title, result.subtitle), run: go(result.href),
    }));
    const artists = results.filter((result) => result.item_type === "artist").map((result): QuickItem => ({
      id: `artist:${result.id}`, title: result.title, subtitle: "Artist", icon: Mic2, round: true, artworkUrl: cachedArtworkUrl(result.artwork_url), score: matchScore(term, result.title), run: go(result.href),
    }));
    const playlistItems = playlists.map((playlist): QuickItem => ({
      id: `playlist:${playlist.id}`, title: playlist.name, subtitle: `Playlist · ${pluralize(playlist.song_count, "song")}`, icon: ListMusic, artworkUrl: cachedArtworkUrl(playlist.artwork_path), score: matchScore(term, playlist.name, playlist.description), run: go(`/library/playlists/${playlist.id}`),
    }));

    const ranked = (items: QuickItem[], limit: number) => items.filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
    const local = {
      Songs: ranked(songs, 6), Albums: ranked(albums, 4), Artists: ranked(artists, 4), Playlists: ranked(playlistItems, 4), Pages: ranked(pages, 3), Commands: ranked(commands, 4),
    };
    const best = Object.values(local).flat().sort((a, b) => b.score - a.score)[0];
    const top = best && best.score >= TOP_RESULT_SCORE ? best : null;
    const onlineItems = online.data?.items.filter((item) => item.playable).slice(0, 4).map((item) => songItem(`online:${item.id}`, onlineItemToPlayerTrack(item), 0)) ?? [];
    const searchAll: QuickItem = { id: "search-all", title: `Search for “${term}”`, subtitle: "See all songs, albums, artists and videos", icon: Search, score: 0, run: go(`/search?q=${encodeURIComponent(term)}`) };
    const waitingOnline = onlineTerm !== term || online.isFetching;

    return [
      ...(top ? [{ title: "Top result", items: [top] }] : []),
      ...Object.entries(local).map(([title, items]) => ({ title, items: items.filter((item) => item !== top) })),
      { title: "YouTube Music", items: [...onlineItems, searchAll], pending: waitingOnline && term.length >= 2 ? "Searching YouTube Music…" : undefined },
    ].filter((group) => group.items.length > 0);
  }, [term, onlineTerm, history, library.data, localSongs.data, online.data, online.isFetching, playlists, hasTrack, navigate]);

  const items = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const selectedIndex = Math.max(0, items.findIndex((item) => item.id === activeId));
  const selected = items[selectedIndex];
  const searchingLibrary = Boolean(term) && (libraryTerm !== term || library.isFetching || localSongs.isFetching);

  useEffect(() => { list.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: "nearest" }); }, [selected?.id]);

  function close() {
    setOpen(false);
    setQuery("");
    setActiveId(null);
  }

  function run(item: QuickItem | undefined, queue = false) {
    if (!item) return;
    close();
    if (queue && item.track) {
      usePlayerStore.getState().addToQueue(item.track);
      toast(`Added “${item.track.title}” to the queue`, "success");
    } else {
      item.run();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || items.length === 0) return;
    const move = (index: number) => { event.preventDefault(); setActiveId(items[(index + items.length) % items.length].id); };
    if (event.key === "ArrowDown") move(selectedIndex + 1);
    else if (event.key === "ArrowUp") move(selectedIndex - 1);
    else if (event.key === "PageDown") move(Math.min(items.length - 1, selectedIndex + 5));
    else if (event.key === "PageUp") move(Math.max(0, selectedIndex - 5));
    else if (event.key === "Enter") { event.preventDefault(); run(selected, event.shiftKey); }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[400] bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-3 z-[400] flex max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] max-w-2xl -translate-x-1/2 flex-col overflow-hidden rounded-[1.4rem] border border-white/10 bg-background/95 shadow-2xl backdrop-blur-2xl duration-150 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-[0.98] data-[state=open]:zoom-in-[0.98] data-[state=closed]:slide-out-to-left-1/2 data-[state=open]:slide-in-from-left-1/2 sm:top-[12vh] sm:max-h-[min(36rem,80dvh)]"
        >
          <DialogPrimitive.Title className="sr-only">Quick find</DialogPrimitive.Title>
          <div className="flex items-center gap-3 border-b border-white/[0.06] px-4">
            {searchingLibrary ? <Loader2 aria-hidden="true" className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" /> : <Search aria-hidden="true" className="h-5 w-5 shrink-0 text-muted-foreground" />}
            <input
              aria-label="Find music or a command"
              aria-controls="quick-find-results"
              placeholder="Search your music, pages and commands"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setActiveId(null); }}
              onKeyDown={onKeyDown}
              autoComplete="off"
              spellCheck={false}
              className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/70"
            />
            <DialogPrimitive.Close aria-label="Close" className="shrink-0 rounded-md border border-white/10 px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground transition hover:text-foreground">Esc</DialogPrimitive.Close>
          </div>

          <div id="quick-find-results" ref={list} aria-label="Quick find results" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
            {groups.map((group) => (
              <div key={group.title} role="group" aria-label={group.title} className="pb-1">
                <p className="px-3 pb-1 pt-2.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">{group.title}</p>
                {group.items.map((item) => (
                  <ResultRow key={item.id} item={item} active={item.id === selected?.id} large={group.title === "Top result"} onHover={() => setActiveId(item.id)} onRun={() => run(item)} />
                ))}
                {group.pending && <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />{group.pending}</p>}
              </div>
            ))}
          </div>

          <div className="hidden items-center gap-4 border-t border-white/[0.06] px-4 py-2.5 text-[11px] text-muted-foreground sm:flex">
            <span><Kbd>↑</Kbd><Kbd>↓</Kbd> browse</span>
            <span><Kbd>↵</Kbd> open or play</span>
            {selected?.track && <span><Kbd>⇧</Kbd><Kbd>↵</Kbd> add to queue</span>}
            <span className="ml-auto"><Kbd>Ctrl</Kbd><Kbd>K</Kbd> toggle</span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function ResultRow({ item, active, large, onHover, onRun }: { item: QuickItem; active: boolean; large: boolean; onHover: () => void; onRun: () => void }) {
  const Icon = item.icon;
  const size = large ? "h-12 w-12" : "h-9 w-9";
  return (
    <button
      type="button"
      aria-label={[item.title, item.subtitle].filter(Boolean).join(" · ")}
      data-active={active}
      onMouseMove={active ? undefined : onHover}
      onClick={onRun}
      className={cn("group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", active ? "bg-white/[0.08]" : "hover:bg-white/[0.04]")}
    >
      <span className={cn("grid shrink-0 place-items-center overflow-hidden bg-white/[0.06] text-muted-foreground", size, item.round ? "rounded-full" : "rounded-lg", active && !item.artworkUrl && "text-primary")}>
        {item.artworkUrl ? <ArtworkImage src={item.artworkUrl} alt="" className="h-full w-full object-cover" /> : <Icon className={large ? "h-5 w-5" : "h-4 w-4"} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate font-semibold", large ? "text-base" : "text-sm")}>{item.title}</span>
        {item.subtitle && <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>}
      </span>
      {item.keys && <span className="hidden shrink-0 text-[11px] font-semibold text-muted-foreground sm:block"><Kbd>{item.keys}</Kbd></span>}
      <CornerDownLeft aria-hidden="true" className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground", active ? "opacity-100" : "opacity-0")} />
    </button>
  );
}

function Kbd({ children }: { children: string }) {
  return <kbd className="mr-1 inline-grid min-w-[1.25rem] place-items-center rounded border border-white/10 bg-white/[0.04] px-1 py-px font-sans text-[10px] font-semibold">{children}</kbd>;
}

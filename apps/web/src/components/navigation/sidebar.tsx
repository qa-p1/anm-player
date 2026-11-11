import { Disc3, Keyboard, Pin, Plus, Search, Settings, X } from "lucide-react";
import { useState } from "react";
import { NavLink } from "react-router";

import { ArtworkImage } from "@/components/cards/artwork-image";
import { GeneratedCover } from "@/components/collection/collection-parts";
import { EqualizerBars } from "@/components/collection/equalizer-bars";
import { DownloadQueueTrigger } from "@/components/download-queue";
import { CloseAppButton } from "@/components/navigation/close-app-button";
import { AppUpdateControls } from "@/features/updates/app-update-controls";
import { libraryNavItems, navItems } from "@/components/navigation/nav-items";
import { CreatePlaylistDialog } from "@/features/playlists/create-playlist-dialog";
import { useAllPlaylists } from "@/hooks/use-music-queries";
import { cn } from "@/lib/utils";
import { cachedArtworkUrl } from "@/services/api-client";
import { useLibraryPreferencesStore } from "@/stores/library-preferences-store";
import { usePlaybackSourceStore } from "@/stores/playback-source-store";
import { usePlayerStore } from "@/stores/player-store";
import { useUiStore } from "@/stores/ui-store";

const mainItems = navItems.filter((item) => item.path !== "/settings");
const linkClass = ({ isActive }: { isActive: boolean }) => cn(
  "relative flex h-9 items-center gap-3 rounded-xl px-3 text-sm font-medium transition",
  isActive ? "bg-white/[0.08] text-foreground before:absolute before:left-0 before:top-2 before:h-5 before:w-[3px] before:rounded-full before:bg-primary" : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground",
);

export function Sidebar() {
  const [createOpen, setCreateOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const { data: playlists = [], isLoading, isError, refetch } = useAllPlaylists();
  const pinned = useLibraryPreferencesStore((state) => state.pinnedPlaylistIds);
  const togglePin = useLibraryPreferencesStore((state) => state.togglePlaylistPin);
  const playingPlaylistId = usePlaybackSourceStore((state) => (state.source?.kind === "playlist" ? state.source.id : null));
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const term = filter.trim().toLocaleLowerCase();
  const visible = playlists.filter((playlist) => playlist.name.toLocaleLowerCase().includes(term))
    .sort((a, b) => Number(pinned.includes(b.id)) - Number(pinned.includes(a.id)) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  const showFilter = filterOpen || Boolean(filter);

  function closeFilter() {
    setFilter("");
    setFilterOpen(false);
  }

  return <>
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-white/[0.06] bg-background/55 px-3 pb-3 pt-4 backdrop-blur-2xl lg:flex">
      <div className="mb-4 flex items-center gap-2 px-2">
        <NavLink to="/" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-glow"><Disc3 className="h-[1.1rem] w-[1.1rem]" /></span>
          <span className="truncate text-base font-black tracking-tight">ANM Player</span>
        </NavLink>
        <button type="button" onClick={() => useUiStore.getState().setCommandPaletteOpen(true)} aria-label="Quick find" title="Quick find (Ctrl K)" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-muted-foreground transition hover:bg-white/[0.06] hover:text-foreground"><Search className="h-4 w-4" /></button>
      </div>

      <nav aria-label="Main navigation" className="space-y-0.5">
        {mainItems.map((item) => <NavLink key={item.path} to={item.path} end={item.path === "/"} className={linkClass}><item.icon className="h-4 w-4" />{item.label}</NavLink>)}
      </nav>

      <nav aria-label="Your library" className="mt-3 grid grid-cols-2 gap-1.5 border-t border-white/[0.06] pt-3">
        {libraryNavItems.map((item) => (
          <NavLink key={item.path} to={item.path} className={({ isActive }) => cn("flex h-9 items-center gap-2 rounded-xl border px-2.5 text-xs font-semibold transition", isActive ? "border-primary/30 bg-primary/10 text-primary" : "border-white/[0.06] bg-white/[0.03] text-muted-foreground hover:bg-white/[0.07] hover:text-foreground")}>
            <item.icon className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <section aria-label="Your playlists" className="mt-3 flex min-h-0 flex-1 flex-col border-t border-white/[0.06] pt-2">
        <div className="mb-1 flex items-center gap-1 pl-3">
          <NavLink to="/library/playlists" end className={({ isActive }) => cn("mr-auto text-xs font-bold uppercase tracking-wider transition", isActive ? "text-primary" : "text-muted-foreground hover:text-foreground")}>Playlists</NavLink>
          {playlists.length > 0 && <button type="button" aria-label={showFilter ? "Close playlist filter" : "Filter playlists"} aria-pressed={showFilter} onClick={() => (showFilter ? closeFilter() : setFilterOpen(true))} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-white/[0.06] hover:text-foreground">{showFilter ? <X className="h-3.5 w-3.5" /> : <Search className="h-3.5 w-3.5" />}</button>}
          <button type="button" title="Create playlist" aria-label="Create playlist" onClick={() => setCreateOpen(true)} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-white/[0.06] hover:text-foreground"><Plus className="h-4 w-4" /></button>
        </div>
        {showFilter && <input aria-label="Filter sidebar playlists" value={filter} onChange={(event) => setFilter(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") closeFilter(); }} placeholder="Find a playlist…" className="mx-1 mb-1 h-8 shrink-0 rounded-lg border border-white/10 bg-transparent px-3 text-xs outline-none focus:border-primary" />}
        <div className="no-scrollbar min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {isLoading && Array.from({ length: 4 }).map((_, index) => <div key={index} className="flex items-center gap-2.5 p-1.5"><span className="h-9 w-9 animate-pulse rounded-lg bg-white/[0.06]" /><span className="h-3 flex-1 animate-pulse rounded bg-white/[0.05]" /></div>)}
          {isError && <button type="button" onClick={() => void refetch()} className="px-3 py-2 text-xs text-primary">Could not load. Retry</button>}
          {!isLoading && !isError && playlists.length === 0 && <button type="button" onClick={() => setCreateOpen(true)} className="w-full px-3 py-2 text-left text-xs text-muted-foreground hover:text-primary">Create your first playlist</button>}
          {visible.map((playlist) => {
            const isPinned = pinned.includes(playlist.id);
            const isSource = playingPlaylistId === String(playlist.id);
            return (
              <div key={playlist.id} className="group relative flex items-center">
                <NavLink to={`/library/playlists/${playlist.id}`} title={playlist.name} className={({ isActive }) => cn("flex min-w-0 flex-1 items-center gap-2.5 rounded-xl p-1.5 pr-9 transition", isActive ? "bg-white/[0.08] text-foreground" : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground")}>
                  <span className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-white/10">{playlist.artwork_path ? <ArtworkImage src={cachedArtworkUrl(playlist.artwork_path)} alt="" className="h-full w-full object-cover" /> : <GeneratedCover name={playlist.name} />}</span>
                  <span className="min-w-0">
                    <span className={cn("block truncate text-[0.8rem] font-semibold", isSource && "text-primary")}>{playlist.name}</span>
                    {isSource
                      ? <span className="flex items-center gap-1.5 text-[0.68rem] font-semibold text-primary"><EqualizerBars playing={isPlaying} className="h-2.5" />{isPlaying ? "Playing" : "Paused"}</span>
                      : <span className="block text-[0.68rem] text-muted-foreground">{playlist.song_count} {playlist.song_count === 1 ? "track" : "tracks"}</span>}
                  </span>
                </NavLink>
                <button type="button" aria-label={`${isPinned ? "Unpin" : "Pin"} ${playlist.name}`} aria-pressed={isPinned} onClick={() => togglePin(playlist.id)} className={cn("absolute right-1 grid h-7 w-7 place-items-center rounded-lg transition hover:bg-white/10", isPinned ? "text-primary" : "text-muted-foreground opacity-0 focus:opacity-100 group-hover:opacity-100")}><Pin className={cn("h-3 w-3", isPinned && "fill-current")} /></button>
              </div>
            );
          })}
          {term && visible.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">No playlists match.</p>}
        </div>
      </section>

      <div className="mt-2 shrink-0 space-y-2 border-t border-white/[0.06] pt-2">
        <DownloadQueueTrigger />
        <div className="flex items-center gap-1 px-1">
          <NavLink to="/settings" aria-label="Settings" title="Settings" className={({ isActive }) => cn("grid h-9 w-9 place-items-center rounded-xl transition", isActive ? "bg-white/[0.08] text-primary" : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground")}><Settings className="h-4 w-4" /></NavLink>
          <button type="button" onClick={() => useUiStore.getState().setShortcutHelpOpen(true)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" className="grid h-9 w-9 place-items-center rounded-xl text-muted-foreground transition hover:bg-white/[0.06] hover:text-foreground"><Keyboard className="h-4 w-4" /></button>
          <span className="flex-1" />
          <AppUpdateControls />
          <CloseAppButton compact />
        </div>
      </div>
    </aside>
    <CreatePlaylistDialog open={createOpen} onOpenChange={setCreateOpen} />
  </>;
}

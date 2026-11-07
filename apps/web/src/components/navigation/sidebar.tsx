import { Disc3, Keyboard, ListMusic, Pin, Plus, Search } from "lucide-react";
import { useState } from "react";
import { NavLink } from "react-router";
import { navItems, libraryNavItems } from "@/components/navigation/nav-items";
import { CloseAppButton } from "@/components/navigation/close-app-button";
import { DownloadQueueTrigger } from "@/components/download-queue";
import { ArtworkImage } from "@/components/cards/artwork-image";
import { CreatePlaylistDialog } from "@/features/playlists/create-playlist-dialog";
import { useAllPlaylists } from "@/hooks/use-music-queries";
import { cn } from "@/lib/utils";
import { cachedArtworkUrl } from "@/services/api-client";
import { useLibraryPreferencesStore } from "@/stores/library-preferences-store";
import { useUiStore } from "@/stores/ui-store";

const linkClass = ({ isActive }: { isActive: boolean }) => cn("flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition", isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-white/8 hover:text-foreground");

export function Sidebar() {
  const [createOpen, setCreateOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const { data: playlists = [], isLoading, isError, refetch } = useAllPlaylists();
  const pinned = useLibraryPreferencesStore((state) => state.pinnedPlaylistIds);
  const togglePin = useLibraryPreferencesStore((state) => state.togglePlaylistPin);
  const visible = [...playlists].filter((playlist) => playlist.name.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()))
    .sort((a, b) => Number(pinned.includes(b.id)) - Number(pinned.includes(a.id)) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

  return <>
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-white/10 bg-background/55 px-4 py-5 backdrop-blur-2xl lg:flex">
      <NavLink to="/" className="mb-5 flex items-center gap-3 px-3">
        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-glow"><Disc3 className="h-5 w-5" /></div>
        <div><p className="text-lg font-bold">ANM Player</p><p className="text-xs text-muted-foreground">Your music, within reach</p></div>
      </NavLink>
      <button type="button" onClick={() => useUiStore.getState().setCommandPaletteOpen(true)} className="mb-3 flex h-10 shrink-0 items-center gap-2 rounded-xl border border-white/10 px-3 text-sm text-muted-foreground hover:bg-white/8"><Search className="h-4 w-4" />Quick find<kbd className="ml-auto text-[0.65rem]">Ctrl K</kbd></button>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        <nav aria-label="Main navigation" className="space-y-1">{navItems.map((item) => <NavLink key={item.path} to={item.path} end={item.path === "/"} className={linkClass}><item.icon className="h-4 w-4" />{item.label}</NavLink>)}</nav>
        <nav aria-label="Your library" className="mt-5 space-y-1 border-t border-white/10 pt-4"><p className="px-3 pb-2 text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground">Your library</p>{libraryNavItems.map((item) => <NavLink key={item.path} to={item.path} className={linkClass}><item.icon className="h-4 w-4" />{item.label}</NavLink>)}</nav>
        <section className="mt-4 border-t border-white/10 pt-3" aria-label="Your playlists">
          <div className="mb-2 flex items-center justify-between px-3"><NavLink to="/library/playlists" className="text-xs font-bold text-muted-foreground hover:text-foreground">Playlists · {playlists.length}</NavLink><button type="button" title="Create playlist" aria-label="Create playlist" onClick={() => setCreateOpen(true)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white/10"><Plus className="h-4 w-4" /></button></div>
          {(playlists.length > 5 || filter) && <input aria-label="Filter sidebar playlists" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Find a playlist…" className="mb-2 h-9 w-full rounded-xl border border-white/10 bg-transparent px-3 text-xs outline-none focus:border-primary" />}
          {isLoading && <p className="px-3 text-xs text-muted-foreground">Loading playlists…</p>}
          {isError && <button type="button" onClick={() => void refetch()} className="px-3 text-xs text-primary">Could not load. Retry</button>}
          {!isLoading && !isError && playlists.length === 0 && <button type="button" onClick={() => setCreateOpen(true)} className="px-3 py-2 text-left text-xs text-muted-foreground hover:text-primary">Create your first playlist</button>}
          {visible.map((playlist) => <div key={playlist.id} className="group flex items-center gap-1">
            <NavLink to={`/library/playlists/${playlist.id}`} title={playlist.name} className={({ isActive }) => cn("flex min-w-0 flex-1 items-center gap-2 rounded-xl p-2 text-xs transition hover:bg-white/8", isActive && "bg-primary/10 text-primary")}>
              <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-lg bg-white/10">{playlist.artwork_path ? <ArtworkImage src={cachedArtworkUrl(playlist.artwork_path)} alt="" className="h-full w-full object-cover" /> : <ListMusic className="h-4 w-4" />}</span>
              <span className="min-w-0"><span className="block truncate font-semibold">{playlist.name}</span><span className="text-[0.62rem] text-muted-foreground">{playlist.song_count} tracks</span></span>
            </NavLink>
            <button type="button" aria-label={`${pinned.includes(playlist.id) ? "Unpin" : "Pin"} ${playlist.name}`} aria-pressed={pinned.includes(playlist.id)} onClick={() => togglePin(playlist.id)} className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-white/10", pinned.includes(playlist.id) ? "text-primary" : "text-muted-foreground opacity-0 focus:opacity-100 group-hover:opacity-100")}><Pin className="h-3 w-3" /></button>
          </div>)}
          {filter && visible.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">No playlists match.</p>}
        </section>
      </div>
      <div className="mt-3 shrink-0 border-t border-white/10 pt-3">
        <button type="button" onClick={() => useUiStore.getState().setShortcutHelpOpen(true)} className="mb-2 flex h-9 w-full items-center gap-3 rounded-xl px-3 text-xs text-muted-foreground hover:bg-white/8"><Keyboard className="h-4 w-4" />Keyboard shortcuts<kbd className="ml-auto">?</kbd></button>
        <DownloadQueueTrigger /><CloseAppButton />
      </div>
    </aside>
    <CreatePlaylistDialog open={createOpen} onOpenChange={setCreateOpen} />
  </>;
}

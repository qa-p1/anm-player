import { Command, ListMusic, Music2, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { navItems, libraryNavItems } from "@/components/navigation/nav-items";
import { playerCommands } from "@/features/commands/player-commands";
import { useAllPlaylists, useAllSongs } from "@/hooks/use-music-queries";
import { useUiStore } from "@/stores/ui-store";
import { usePlayerStore } from "@/stores/player-store";
import { songToPlayerTrack } from "@/types/player";
import { cn } from "@/lib/utils";

export function CommandPalette() {
  const open = useUiStore((state) => state.isCommandPaletteOpen);
  const setOpen = useUiStore((state) => state.setCommandPaletteOpen);
  const currentSong = usePlayerStore((state) => state.currentSong);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { data: playlists = [] } = useAllPlaylists({ enabled: open });
  const { data: songs = [] } = useAllSongs({ enabled: open });
  const term = query.trim().toLocaleLowerCase();
  const matches = (text: string) => term.split(/\s+/).every((word) => text.toLocaleLowerCase().includes(word));
  const go = (path: string) => { useUiStore.getState().setPlayerExpanded(false); navigate(path); };
  const results = [
    ...[...navItems, ...libraryNavItems].filter((item) => matches(item.label)).map((item) => ({ id: item.path, label: item.label, detail: "Go to", icon: item.icon, run: () => go(item.path) })),
    ...playlists.filter((item) => matches(item.name)).map((item) => ({ id: `playlist:${item.id}`, label: item.name, detail: `${item.song_count} tracks · Playlist`, icon: ListMusic, run: () => go(`/library/playlists/${item.id}`) })),
    ...(term ? songs.filter((item) => matches(`${item.title} ${item.artist_name || ""} ${item.album_title || ""}`)).slice(0, 20).map((item) => ({ id: `song:${item.id}`, label: item.title, detail: item.artist_name || "Library song", icon: Music2, run: () => usePlayerStore.getState().playSong(songToPlayerTrack(item)) })) : []),
    ...playerCommands.filter((item) => (!item.needsTrack || currentSong) && matches(item.label)).map((item) => ({ id: item.id, label: item.label, detail: item.keys, icon: Command, run: item.run })),
    ...(term ? [{ id: "online-search", label: `Search YouTube Music for “${query.trim()}”`, detail: "Online search", icon: Search, run: () => go(`/search?q=${encodeURIComponent(query.trim())}`) }] : []),
  ];
  const selected = Math.min(active, Math.max(0, results.length - 1));
  useEffect(() => { list.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: "nearest" }); }, [selected]);

  function run(index: number) {
    const result = results[index];
    if (!result) return;
    setOpen(false);
    setQuery("");
    setActive(0);
    result.run();
  }

  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setQuery(""); setActive(0); } }}>
    <DialogContent className="max-w-xl gap-3">
      <DialogHeader><DialogTitle className="flex items-center gap-2"><Search className="h-5 w-5 text-primary" />Quick find</DialogTitle><DialogDescription>Jump to a playlist, play a library song, or run a player command.</DialogDescription></DialogHeader>
      <Input aria-label="Find music or a command" placeholder="Songs, playlists, pages, commands…" value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} aria-controls="quick-find-results" onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault(); setActive((selected + (event.key === "ArrowDown" ? 1 : -1) + results.length) % Math.max(1, results.length));
      } else if (event.key === "Enter") { event.preventDefault(); run(selected); }
    }} />
      <div id="quick-find-results" ref={list} className="max-h-[50dvh] space-y-1 overflow-y-auto" aria-label="Quick find results">
        {results.map((item, index) => <button key={item.id} type="button" aria-label={`${item.label} · ${item.detail}`} data-active={index === selected} onMouseEnter={() => setActive(index)} onClick={() => run(index)} className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-primary/10", index === selected && "bg-primary/10")}><item.icon className="h-4 w-4 shrink-0 text-primary" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{item.label}</span><span className="block text-xs text-muted-foreground">{item.detail}</span></span></button>)}
        {results.length === 0 && <p className="p-4 text-sm text-muted-foreground">No matches.</p>}
      </div>
      <p className="text-xs text-muted-foreground">↑ ↓ to browse · Enter to run · Esc to close</p>
    </DialogContent>
  </Dialog>;
}

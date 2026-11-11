import { motion } from "framer-motion";
import { Heart, Link2, ListMusic, LoaderCircle, Pin, Play, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";

import { pageTransition } from "@/animations/page-motion";
import { ArtworkImage } from "@/components/cards/artwork-image";
import { CollectionHero, MetaDots } from "@/components/collection/collection-hero";
import { GeneratedCover, MosaicArtwork, TileSkeleton, ViewToggle } from "@/components/collection/collection-parts";
import { EqualizerBars } from "@/components/collection/equalizer-bars";
import { MediaTile, TileBadge } from "@/components/collection/media-tile";
import { EmptyState } from "@/components/empty-states/empty-state";
import { CollectionBrowser } from "@/components/filters/collection-browser";
import { BackButton } from "@/components/navigation/back-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { playPlaylistById } from "@/features/library/collection-playback";
import { useAllPlaylists, useCreatePlaylist } from "@/hooks/use-music-queries";
import { queryClient } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { cachedArtworkUrl } from "@/services/api-client";
import { importPlaylistUrl } from "@/services/music-api";
import { invalidatePlaylists } from "@/services/music-invalidation";
import { musicKeys } from "@/services/music-keys";
import { useLibraryPreferencesStore } from "@/stores/library-preferences-store";
import { usePlaybackSourceStore } from "@/stores/playback-source-store";
import type { Playlist } from "@/types/api";
import { formatListeningTime, formatRelativeDate, pluralize } from "@/utils/format";

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

export function PlaylistsPage() {
  const navigate = useNavigate();
  const { data: playlists = [], isLoading, error, refetch } = useAllPlaylists();
  const createPlaylistMutation = useCreatePlaylist();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const pinned = useLibraryPreferencesStore((state) => state.pinnedPlaylistIds);
  const togglePin = useLibraryPreferencesStore((state) => state.togglePlaylistPin);
  const view = useLibraryPreferencesStore((state) => state.viewModes.playlists ?? "grid");
  const setViewMode = useLibraryPreferencesStore((state) => state.setViewMode);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [newPlaylistDescription, setNewPlaylistDescription] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const playingPlaylistId = usePlaybackSourceStore((state) => (state.source?.kind === "playlist" ? state.source.id : null));
  const term = query.trim().toLocaleLowerCase();

  const visiblePlaylists = useMemo(() => playlists
    .filter((item) => `${item.name} ${item.description || ""}`.toLocaleLowerCase().includes(term))
    .sort((a, b) => Number(pinned.includes(b.id)) - Number(pinned.includes(a.id)) || (
      sort === "name" ? collator.compare(a.name, b.name)
        : sort === "tracks" ? b.song_count - a.song_count
          : sort === "length" ? (b.duration_seconds ?? 0) - (a.duration_seconds ?? 0)
            : sort === "created" ? dateValue(b.created_at) - dateValue(a.created_at)
              : dateValue(b.updated_at) - dateValue(a.updated_at))), [playlists, pinned, sort, term]);

  const totals = useMemo(() => ({
    songs: playlists.reduce((total, playlist) => total + playlist.song_count, 0),
    seconds: playlists.reduce((total, playlist) => total + Math.max(0, playlist.duration_seconds ?? 0), 0),
  }), [playlists]);
  const pinnedCount = playlists.filter((playlist) => pinned.includes(playlist.id)).length;
  const covers = useMemo(() => playlists.map((playlist) => cachedArtworkUrl(playlist.artwork_path)).filter(Boolean).slice(0, 8), [playlists]);

  async function handleCreatePlaylist(event: React.FormEvent) {
    event.preventDefault();
    if (!newPlaylistName.trim() || createPlaylistMutation.isPending) return;
    try {
      const created = await createPlaylistMutation.mutateAsync({ name: newPlaylistName.trim(), description: newPlaylistDescription.trim() || null });
      setNewPlaylistName("");
      setNewPlaylistDescription("");
      setCreateOpen(false);
      toast("Playlist created", "success");
      if (created?.id) navigate(`/library/playlists/${created.id}`);
    } catch (createError) {
      toast(createError instanceof Error ? createError.message : "Could not create playlist", "error");
    }
  }

  async function handleImportPlaylist(event: React.FormEvent) {
    event.preventDefault();
    if (!importUrl.trim() || isImporting) return;
    setIsImporting(true);
    try {
      await importPlaylistUrl(importUrl.trim());
      void invalidatePlaylists(queryClient);
      void queryClient.invalidateQueries({ queryKey: musicKeys.downloadsList() });
      setImportUrl("");
      setImportOpen(false);
      toast("Playlist import started", "success");
    } catch (importError) {
      toast(importError instanceof Error ? importError.message : "Could not import playlist", "error");
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <motion.div {...pageTransition} className="mx-auto max-w-7xl space-y-6 px-3 py-4 sm:px-6 lg:px-8 lg:py-7">
      <BackButton fallback="/library" />
      <CollectionHero
        kind="Playlists"
        title="Playlists"
        artworkUrl={covers.find(Boolean) ?? null}
        artwork={<MosaicArtwork urls={covers} icon={ListMusic} />}
        meta={playlists.length > 0 && <MetaDots items={[
          pluralize(playlists.length, "playlist"),
          pluralize(totals.songs, "song"),
          totals.seconds > 0 ? formatListeningTime(totals.seconds) : null,
          pinnedCount ? `${pinnedCount} pinned` : null,
        ]} />}
      >
        <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" />New playlist</Button>
        <Button variant="glass" onClick={() => setImportOpen(true)}><Link2 className="h-4 w-4" />Import URL</Button>
      </CollectionHero>

      <section aria-label="All playlists" className="space-y-4">
        <CollectionBrowser label="playlists" query={query} onQueryChange={setQuery} sort={sort} onSortChange={setSort} options={[{ value: "recent", label: "Recently updated" }, { value: "created", label: "Recently created" }, { value: "name", label: "Name" }, { value: "tracks", label: "Track count" }, { value: "length", label: "Length" }]}>
          <ViewToggle label="Playlists" value={view} onChange={(mode) => setViewMode("playlists", mode)} />
        </CollectionBrowser>
        {error && <div role="alert" className="flex items-center gap-2 text-sm text-red-400">{error.message}<Button variant="ghost" onClick={() => void refetch()}>Retry</Button></div>}

        {isLoading ? <TileSkeleton /> : playlists.length === 0 ? (
          <EmptyState icon={ListMusic} title="No playlists yet" description="Create your first playlist to organize your music, or import one from YouTube Music.">
            <div className="flex flex-wrap justify-center gap-2"><Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" />New playlist</Button><Button variant="glass" onClick={() => setImportOpen(true)}>Import URL</Button></div>
          </EmptyState>
        ) : view === "grid" ? (
          <div className="-mx-2 grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {!term && <FavoritesTile />}
            {visiblePlaylists.map((playlist) => {
              const isPinned = pinned.includes(playlist.id);
              return (
                <MediaTile
                  key={playlist.id}
                  href={`/library/playlists/${playlist.id}`}
                  title={playlist.name}
                  subtitle={playlist.description || undefined}
                  meta={[pluralize(playlist.song_count, "song"), playlist.duration_seconds ? formatListeningTime(playlist.duration_seconds) : null].filter(Boolean).join(" · ")}
                  artworkUrl={cachedArtworkUrl(playlist.artwork_path)}
                  placeholder={<GeneratedCover name={playlist.name} />}
                  isActive={playingPlaylistId === String(playlist.id)}
                  badge={playingPlaylistId === String(playlist.id) ? <TileBadge tone="primary"><EqualizerBars className="h-2.5" />Playing</TileBadge> : isPinned ? <TileBadge tone="primary"><Pin className="h-2.5 w-2.5" />Pinned</TileBadge> : null}
                  corner={<PinButton playlist={playlist} pinned={isPinned} onToggle={() => togglePin(playlist.id)} />}
                  onPlay={playlist.song_count > 0 ? () => playPlaylistById(playlist.id) : undefined}
                  playLabel={`Play ${playlist.name}`}
                />
              );
            })}
          </div>
        ) : (
          <div className="rounded-[1.6rem] border border-white/[0.06] bg-card/30 p-2">
            {visiblePlaylists.map((playlist) => <PlaylistListRow key={playlist.id} playlist={playlist} pinned={pinned.includes(playlist.id)} onTogglePin={() => togglePin(playlist.id)} />)}
          </div>
        )}
        {!isLoading && playlists.length > 0 && visiblePlaylists.length === 0 && <EmptyState icon={Search} title="No matching playlists" description="Try another name or description." />}
      </section>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <form onSubmit={handleCreatePlaylist} className="space-y-4">
            <DialogHeader><DialogTitle>New playlist</DialogTitle><DialogDescription>Give it a name now; you can add songs from any track menu.</DialogDescription></DialogHeader>
            <Input maxLength={255} value={newPlaylistName} aria-label="Playlist name" onChange={(event) => setNewPlaylistName(event.target.value)} placeholder="Playlist name" disabled={createPlaylistMutation.isPending} />
            <textarea value={newPlaylistDescription} aria-label="Playlist description" onChange={(event) => setNewPlaylistDescription(event.target.value)} placeholder="Description (optional)" maxLength={2000} rows={3} disabled={createPlaylistMutation.isPending} className="w-full resize-y rounded-2xl border border-input bg-card/80 p-4 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary/70 focus:ring-4 focus:ring-primary/15 disabled:opacity-50" />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createPlaylistMutation.isPending || !newPlaylistName.trim()}>{createPlaylistMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{createPlaylistMutation.isPending ? "Creating..." : "Create"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <form onSubmit={handleImportPlaylist} className="space-y-4">
            <DialogHeader><DialogTitle>Import a playlist</DialogTitle><DialogDescription>Paste a YouTube Music playlist link. Tracks are added in the background and show up in the download queue.</DialogDescription></DialogHeader>
            <Input value={importUrl} aria-label="YouTube Music playlist URL" onChange={(event) => setImportUrl(event.target.value)} placeholder="https://music.youtube.com/playlist?list=…" disabled={isImporting} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setImportOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isImporting || !importUrl.trim()}>{isImporting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}{isImporting ? "Importing..." : "Import"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

function FavoritesTile() {
  return (
    <MediaTile
      href="/library/favorites"
      title="Favorites"
      subtitle="Everything you've hearted"
      artworkUrl={null}
      placeholder={<div className="grid h-full w-full place-items-center bg-[radial-gradient(circle_at_30%_25%,hsl(var(--primary)),transparent_65%),linear-gradient(135deg,hsl(var(--primary)/0.85),hsl(var(--accent)/0.75))]"><Heart className="h-1/3 w-1/3 fill-white text-white drop-shadow-xl" /></div>}
    />
  );
}

function PinButton({ playlist, pinned, onToggle }: { playlist: Playlist; pinned: boolean; onToggle: () => void }) {
  return (
    <button type="button" aria-label={`${pinned ? "Unpin" : "Pin"} ${playlist.name}`} aria-pressed={pinned} title={pinned ? "Unpin" : "Pin to top"} onClick={onToggle} className={cn("grid h-8 w-8 place-items-center rounded-full bg-black/55 text-white shadow-lg backdrop-blur-md transition hover:scale-105", pinned ? "text-primary opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover/tile:opacity-100 [@media(hover:none)]:opacity-100")}>
      <Pin className={cn("h-4 w-4", pinned && "fill-current")} />
    </button>
  );
}

function PlaylistListRow({ playlist, pinned, onTogglePin }: { playlist: Playlist; pinned: boolean; onTogglePin: () => void }) {
  const artworkUrl = cachedArtworkUrl(playlist.artwork_path);
  const [isStarting, setIsStarting] = useState(false);
  async function play() {
    setIsStarting(true);
    try { await playPlaylistById(playlist.id); } finally { setIsStarting(false); }
  }
  return (
    <article className="group relative flex min-w-0 items-center gap-3 rounded-xl p-2 transition hover:bg-white/[0.06] focus-within:bg-white/[0.06]">
      <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-white/10">{artworkUrl ? <ArtworkImage src={artworkUrl} alt="" className="h-full w-full object-cover" /> : <GeneratedCover name={playlist.name} />}</span>
      <Link to={`/library/playlists/${playlist.id}`} className="min-w-0 flex-1 outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring">
        <p className="flex items-center gap-1.5 truncate text-sm font-semibold">{pinned && <Pin className="h-3 w-3 shrink-0 fill-current text-primary" />}<span className="truncate">{playlist.name}</span></p>
        <p className="truncate text-xs text-muted-foreground">{playlist.description || pluralize(playlist.song_count, "song")}</p>
      </Link>
      <span className="hidden w-20 shrink-0 text-sm text-muted-foreground sm:block">{pluralize(playlist.song_count, "song")}</span>
      <span className="hidden w-20 shrink-0 text-sm tabular-nums text-muted-foreground md:block">{playlist.duration_seconds ? formatListeningTime(playlist.duration_seconds) : ""}</span>
      <span className="hidden w-28 shrink-0 text-xs text-muted-foreground lg:block">{formatRelativeDate(playlist.updated_at)}</span>
      <button type="button" aria-label={`${pinned ? "Unpin" : "Pin"} ${playlist.name}`} aria-pressed={pinned} onClick={onTogglePin} className={cn("relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full transition hover:bg-white/10", pinned ? "text-primary" : "text-muted-foreground")}><Pin className="h-4 w-4" /></button>
      <button type="button" aria-label={`Play ${playlist.name}`} disabled={playlist.song_count === 0 || isStarting} onClick={() => void play()} className="relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-glow transition hover:scale-105 disabled:opacity-40">
        {isStarting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 translate-x-[1px] fill-current" />}
      </button>
    </article>
  );
}

function dateValue(value: string | null | undefined) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

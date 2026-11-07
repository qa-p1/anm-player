import { useLibraryPreferencesStore } from "@/stores/library-preferences-store";
import { motion } from "framer-motion";
import { ListMusic, Plus, Search, Pin } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { pageTransition } from "@/animations/page-motion";
import { ArtworkImage } from "@/components/cards/artwork-image";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-states/empty-state";
import { BackButton } from "@/components/navigation/back-button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { musicKeys, useAllPlaylists, useCreatePlaylist } from "@/hooks/use-music-queries";
import { queryClient } from "@/lib/query-client";
import { cachedArtworkUrl } from "@/services/api-client";
import { importPlaylistUrl } from "@/services/music-api";
import { formatDuration } from "@/utils/format";

export function PlaylistsPage() {
  const { data: playlists = [], isLoading, error, refetch } = useAllPlaylists();
  const createPlaylistMutation = useCreatePlaylist();
  
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const pinned = useLibraryPreferencesStore((state) => state.pinnedPlaylistIds);
  const togglePin = useLibraryPreferencesStore((state) => state.togglePlaylistPin);
  const visiblePlaylists = playlists.filter((item) => `${item.name} ${item.description || ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a, b) =>
    Number(pinned.includes(b.id)) - Number(pinned.includes(a.id)) || (sort === "name" ? a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) : sort === "tracks" ? b.song_count - a.song_count : new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()));
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [newPlaylistDescription, setNewPlaylistDescription] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [isImporting, setIsImporting] = useState(false);

  async function handleCreatePlaylist(e: React.FormEvent) {
    e.preventDefault();
    if (!newPlaylistName.trim() || createPlaylistMutation.isPending) return;

    try {
      await createPlaylistMutation.mutateAsync({ name: newPlaylistName.trim(), description: newPlaylistDescription.trim() || null });
      setNewPlaylistName("");
      setNewPlaylistDescription("");
      toast("Playlist created", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not create playlist", "error");
    }
  }

  async function handleImportPlaylist(e: React.FormEvent) {
    e.preventDefault();
    if (!importUrl.trim() || isImporting) return;
    setIsImporting(true);
    try {
      await importPlaylistUrl(importUrl.trim());
      void queryClient.invalidateQueries({ queryKey: musicKeys.playlists() });
      void queryClient.invalidateQueries({ queryKey: musicKeys.downloadsList() });
      setImportUrl("");
      toast("Playlist import started", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not import playlist", "error");
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <motion.div {...pageTransition} className="mx-auto max-w-7xl space-y-8 px-3 py-4 sm:px-6 lg:px-8 lg:py-7">
      <section>
        <BackButton fallback="/library" />
        <p className="mb-2 text-sm font-semibold text-primary">Playlists</p>
        <h1 className="text-4xl font-black tracking-normal sm:text-5xl">
          Your playlists
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
          {playlists.length} {playlists.length === 1 ? "playlist" : "playlists"}
        </p>
      </section>

      <section className="rounded-2xl border border-white/10 bg-card/55 p-4 shadow-glass sm:p-5">
        <h2 className="mb-4 text-lg font-bold">Create New Playlist</h2>
        <form onSubmit={handleCreatePlaylist} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="space-y-3">
            <Input maxLength={255} value={newPlaylistName} aria-label="Playlist name" onChange={(e) => setNewPlaylistName(e.target.value)} placeholder="Playlist name" disabled={createPlaylistMutation.isPending} />
            <textarea value={newPlaylistDescription} aria-label="Playlist description" onChange={(event) => setNewPlaylistDescription(event.target.value)} placeholder="Description (optional)" maxLength={2000} rows={2} disabled={createPlaylistMutation.isPending} className="w-full resize-y rounded-2xl border border-input bg-card/80 p-4 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary/70 focus:ring-4 focus:ring-primary/15 disabled:opacity-50" />
          </div>
          <Button type="submit" className="sm:self-start" disabled={createPlaylistMutation.isPending || !newPlaylistName.trim()}>
            <Plus className="h-4 w-4" />
            {createPlaylistMutation.isPending ? "Creating..." : "Create"}
          </Button>
        </form>
      </section>

      <section className="rounded-2xl border border-white/10 bg-card/55 p-4 shadow-glass sm:p-5">
        <h2 className="mb-4 text-lg font-bold">Import Playlist URL</h2>
        <form onSubmit={handleImportPlaylist} className="flex flex-col gap-3 sm:flex-row">
          <Input
            value={importUrl}
            aria-label="YouTube Music playlist URL"
            onChange={(e) => setImportUrl(e.target.value)}
            placeholder="YouTube Music playlist URL"
            className="flex-1"
            disabled={isImporting}
          />
          <Button type="submit" disabled={isImporting || !importUrl.trim()}>
            {isImporting ? "Importing..." : "Import"}
          </Button>
        </form>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Find a playlist" placeholder="Find a playlist…" className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">Sort<select aria-label="Sort playlists" value={sort} onChange={(event) => setSort(event.target.value)} className="h-11 rounded-xl border border-white/10 bg-card px-3 text-foreground"><option value="recent">Recently updated</option><option value="name">Name</option><option value="tracks">Track count</option></select></label>
        </div>
        {error && <div role="alert" className="text-sm text-red-400">{error.message}<Button variant="ghost" onClick={() => void refetch()}>Retry</Button></div>}
        {isLoading ? (
          <p className="text-center text-muted-foreground">Loading...</p>
        ) : playlists.length === 0 ? (
          <EmptyState
            icon={ListMusic}
            title="No playlists yet"
            description="Create your first playlist to organize your music."
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {visiblePlaylists.map((playlist) => {
              const artworkUrl = cachedArtworkUrl(playlist.artwork_path);
              return (
              <article key={playlist.id} className="relative min-w-0">
              <Link
                to={`/library/playlists/${playlist.id}`}
                className="group min-w-0"
              >
                <div className="mb-3 aspect-square overflow-hidden rounded-xl bg-white/10 shadow-glass sm:rounded-2xl">
                  {artworkUrl ? (
                    <ArtworkImage
                      src={artworkUrl}
                      alt={playlist.name}
                      className="h-full w-full object-cover transition group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-white/10">
                      <ListMusic className="h-12 w-12 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <h3 className="truncate text-sm font-bold">{playlist.name}</h3>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {playlist.song_count} {playlist.song_count === 1 ? "song" : "songs"}
                  {playlist.duration_seconds && ` · ${formatDuration(playlist.duration_seconds)}`}
                </p>
              </Link>
              <button type="button" aria-label={`${pinned.includes(playlist.id) ? "Unpin" : "Pin"} ${playlist.name}`} aria-pressed={pinned.includes(playlist.id)} title="Pin to top of playlists" onClick={() => togglePin(playlist.id)} className={`absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-background/85 shadow-lg ${pinned.includes(playlist.id) ? "text-primary" : "text-muted-foreground"}`}><Pin className="h-4 w-4" /></button>
              </article>
            )})}
          </div>
        )}
        {!isLoading && playlists.length > 0 && visiblePlaylists.length === 0 && <EmptyState icon={Search} title="No matching playlists" description="Try another name or description." />}
      </section>
    </motion.div>
  );
}

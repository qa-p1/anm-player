import { motion } from "framer-motion";
import { ListMusic, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { pageTransition } from "@/animations/page-motion";
import { ArtworkImage } from "@/components/cards/artwork-image";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-states/empty-state";
import { BackButton } from "@/components/navigation/back-button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useAllPlaylists, useCreatePlaylist } from "@/hooks/use-music-queries";
import { cachedArtworkUrl } from "@/services/api-client";
import { importPlaylistUrl } from "@/services/music-api";
import { formatDuration } from "@/utils/format";

export function PlaylistsPage() {
  const { data: playlists = [], isLoading } = useAllPlaylists();
  const createPlaylistMutation = useCreatePlaylist();
  
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [isImporting, setIsImporting] = useState(false);

  async function handleCreatePlaylist(e: React.FormEvent) {
    e.preventDefault();
    if (!newPlaylistName.trim()) return;

    try {
      await createPlaylistMutation.mutateAsync({ name: newPlaylistName.trim() });
      setNewPlaylistName("");
      toast("Playlist created", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not create playlist", "error");
    }
  }

  async function handleImportPlaylist(e: React.FormEvent) {
    e.preventDefault();
    if (!importUrl.trim()) return;
    setIsImporting(true);
    try {
      await importPlaylistUrl(importUrl.trim());
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
        <form onSubmit={handleCreatePlaylist} className="flex flex-col gap-3 sm:flex-row">
          <Input
            value={newPlaylistName}
            aria-label="Playlist name"
            onChange={(e) => setNewPlaylistName(e.target.value)}
            placeholder="Playlist name"
            className="flex-1"
            disabled={createPlaylistMutation.isPending}
          />
          <Button type="submit" disabled={createPlaylistMutation.isPending || !newPlaylistName.trim()}>
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

      <section>
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
            {playlists.map((playlist) => {
              const artworkUrl = cachedArtworkUrl(playlist.artwork_path);
              return (
              <Link
                key={playlist.id}
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
            )})}
          </div>
        )}
      </section>
    </motion.div>
  );
}

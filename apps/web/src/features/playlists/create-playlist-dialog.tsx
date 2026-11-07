import { useUiStore } from "@/stores/ui-store";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { musicKeys, useCreatePlaylist, useAddTracksToPlaylist } from "@/hooks/use-music-queries";
import { queryClient } from "@/lib/query-client";
import type { PlayerTrack } from "@/types/player";

export function CreatePlaylistDialog({ open, onOpenChange, tracks = [] }: { open: boolean; onOpenChange: (open: boolean) => void; tracks?: PlayerTrack[] }) {
  const [name, setName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const mutation = useCreatePlaylist();
  const addTracks = useAddTracksToPlaylist();
  const navigate = useNavigate();

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || isSaving) return;
    setIsSaving(true);
    try {
      const playlist = await mutation.mutateAsync({ name: name.trim() });
      try {
        await addTracks.mutateAsync({ playlistId: playlist.id, tracks });
        toast(tracks.length ? "Playlist created with your tracks" : "Playlist created", "success");
      } catch (error) {
        toast(`Playlist created; some tracks could not be added. ${error instanceof Error ? error.message : "Try again from the track menu."}`, "error");
      }
      void queryClient.invalidateQueries({ queryKey: musicKeys.playlists() });
      setName("");
      onOpenChange(false);
      useUiStore.getState().setPlayerExpanded(false);
      navigate(`/library/playlists/${playlist.id}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not create playlist", "error");
    } finally { setIsSaving(false); }
  }

  return <Dialog open={open} onOpenChange={(next) => { if (!isSaving) onOpenChange(next); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>Create playlist</DialogTitle><DialogDescription>{tracks.length ? `Save ${tracks.length} tracks to a new playlist.` : "Give your next collection a name."}</DialogDescription></DialogHeader>
      <form onSubmit={create} className="space-y-4">
        <Input aria-label="Playlist name" placeholder="Playlist name" maxLength={255} value={name} onChange={(event) => setName(event.target.value)} disabled={isSaving} />
        <DialogFooter><Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>Cancel</Button><Button type="submit" disabled={!name.trim() || isSaving}>{isSaving ? "Saving…" : "Create playlist"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

import { Download, ListPlus, Play, Plus, Shuffle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { CreatePlaylistDialog } from "@/features/playlists/create-playlist-dialog";
import { usePlayerStore } from "@/stores/player-store";
import type { PlayerTrack } from "@/types/player";
import { exportTracks, shuffleTracks } from "@/utils/track-collection";
import { formatListeningTime } from "@/utils/format";

export function CollectionActions({ tracks, name, disabled = false }: { tracks: PlayerTrack[]; name: string; disabled?: boolean }) {
  const [createOpen, setCreateOpen] = useState(false);
  const unavailable = disabled || tracks.length === 0;
  return <>
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={unavailable} onClick={() => usePlayerStore.getState().playPlaylist(tracks)}><Play className="h-4 w-4 fill-current" />Play all</Button>
      <Button size="sm" variant="glass" disabled={unavailable} onClick={() => usePlayerStore.getState().playPlaylist(shuffleTracks(tracks))}><Shuffle className="h-4 w-4" />Shuffle</Button>
      <Button size="sm" variant="glass" disabled={unavailable} onClick={() => { usePlayerStore.getState().addTracksToQueue(tracks); toast(`Added ${tracks.length} tracks to queue`, "success"); }}><ListPlus className="h-4 w-4" />Queue all</Button>
      <Button size="sm" variant="glass" disabled={unavailable} onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" />Save as playlist</Button>
      <Button size="sm" variant="glass" disabled={unavailable} onClick={() => exportTracks(tracks, name)}><Download className="h-4 w-4" />Export M3U</Button>
      {tracks.length > 0 && <span className="text-xs text-muted-foreground">{tracks.length} tracks · {formatListeningTime(tracks.reduce((total, track) => total + Math.max(0, track.durationSeconds ?? 0), 0))}</span>}
    </div>
    <CreatePlaylistDialog open={createOpen} onOpenChange={setCreateOpen} tracks={tracks} />
  </>;
}

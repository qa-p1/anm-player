import { FileDown, ListPlus, MoreHorizontal, Plus, Shuffle } from "lucide-react";
import { useState } from "react";

import { BigPlayButton, HeroIconButton } from "@/components/collection/collection-hero";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useCollectionPlayState } from "@/features/library/use-collection-play-state";
import { CreatePlaylistDialog } from "@/features/playlists/create-playlist-dialog";
import type { PlayerTrack } from "@/types/player";
import { formatListeningTime, pluralize } from "@/utils/format";
import { exportTracks } from "@/utils/track-collection";

/** Play / shuffle / queue row shared by every track-list page. */
export function CollectionActions({ tracks, name, disabled = false }: { tracks: PlayerTrack[]; name: string; disabled?: boolean }) {
  const [createOpen, setCreateOpen] = useState(false);
  const playState = useCollectionPlayState(tracks);
  const unavailable = disabled || tracks.length === 0;
  const seconds = tracks.reduce((total, track) => total + Math.max(0, track.durationSeconds ?? 0), 0);

  return <>
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      <BigPlayButton label={playState.isPlaying ? "Pause" : "Play all"} isPlaying={playState.isPlaying} disabled={unavailable} onClick={playState.playOrToggle} />
      <HeroIconButton label="Shuffle" disabled={unavailable} onClick={playState.shuffle}><Shuffle className="h-5 w-5" /></HeroIconButton>
      <HeroIconButton label="Queue all" disabled={unavailable} onClick={playState.queueAll}><ListPlus className="h-5 w-5" /></HeroIconButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={unavailable}>
          <button type="button" aria-label={`More actions for ${name}`} title="More" disabled={unavailable} className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground transition hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"><MoreHorizontal className="h-5 w-5" /></button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem onSelect={() => setCreateOpen(true)}><Plus className="mr-2 h-4 w-4" />Save as playlist</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => exportTracks(tracks, name)}><FileDown className="mr-2 h-4 w-4" />Export as M3U</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {tracks.length > 0 && <span className="ml-1 text-sm text-muted-foreground">{pluralize(tracks.length, "song")}{seconds > 0 ? ` · ${formatListeningTime(seconds)}` : ""}</span>}
    </div>
    <CreatePlaylistDialog open={createOpen} onOpenChange={setCreateOpen} tracks={tracks} />
  </>;
}

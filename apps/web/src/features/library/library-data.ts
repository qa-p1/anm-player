import {
  Album,
  Clock3,
  Download,
  FolderHeart,
  Heart,
  ListMusic,
  Mic2,
  Music2,
  PlaySquare,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { ArtworkItem } from "@/types/music";

export interface LibrarySection {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  status: string;
}

export const librarySections: LibrarySection[] = [
  {
    id: "downloaded",
    title: "Downloaded Music",
    description: "Tracks explicitly downloaded to this server.",
    icon: Download,
    status: "Storage ready",
  },
  {
    id: "artists",
    title: "Artists",
    description: "Artists from saved albums, playlists, and downloaded tracks.",
    icon: Mic2,
    status: "Metadata pending",
  },
  {
    id: "albums",
    title: "Albums",
    description: "Saved online albums and downloaded albums in one library.",
    icon: Album,
    status: "Collections ready",
  },
  {
    id: "songs",
    title: "Songs",
    description: "Playable tracks from your saved and downloaded library.",
    icon: Music2,
    status: "Index pending",
  },
  {
    id: "favorites",
    title: "Favorites",
    description: "Loved music from your library.",
    icon: Heart,
    status: "User state ready",
  },
  {
    id: "playlists",
    title: "Playlists",
    description: "Manual playlists with online and downloaded tracks.",
    icon: ListMusic,
    status: "Builder pending",
  },
  {
    id: "collections",
    title: "Collections",
    description: "Flexible groupings for albums, artists, and moods.",
    icon: FolderHeart,
    status: "Model ready",
  },
  {
    id: "recently-played",
    title: "Recently Played",
    description: "Listening history will appear here when playback arrives.",
    icon: Clock3,
    status: "Player pending",
  },
];

export const libraryHighlights: ArtworkItem[] = [
  { id: "library-1", title: "Ready to Scan", subtitle: "Library service placeholder", tone: "teal" },
  { id: "library-2", title: "Local Favorites", subtitle: "Future collection", tone: "rose" },
  { id: "library-3", title: "Evening Queue", subtitle: "Future playlist", tone: "blue" },
  { id: "library-4", title: "Recently Played", subtitle: "Player history surface", tone: "amber" },
];

export const libraryStats = [
  { label: "Songs", value: "0", helper: "Playable tracks" },
  { label: "Albums", value: "0", helper: "Saved albums" },
  { label: "Artists", value: "0", helper: "Artist index" },
  { label: "Playlists", value: "0", helper: "User playlists" },
];

export const libraryHeroAction = {
  icon: PlaySquare,
  label: "Open songs",
};

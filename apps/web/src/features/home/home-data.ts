import type { ArtworkItem } from "@/types/music";

export const trendingArtists: ArtworkItem[] = [
  { id: "artist-1", title: "Nila Coast", subtitle: "Dream pop", tone: "rose" },
  { id: "artist-2", title: "Velvet Line", subtitle: "Indie electronic", tone: "teal" },
  { id: "artist-3", title: "Sundown Relay", subtitle: "Alt R&B", tone: "amber" },
  { id: "artist-4", title: "Mira Vale", subtitle: "Synth soul", tone: "blue" },
  { id: "artist-5", title: "North Arcade", subtitle: "Ambient pop", tone: "green" },
];

export const recommendedAlbums: ArtworkItem[] = [
  { id: "album-1", title: "Afterimage", subtitle: "Luna Frame", tone: "violet" },
  { id: "album-2", title: "Pool Light", subtitle: "Horizon Room", tone: "blue" },
  { id: "album-3", title: "Late Signal", subtitle: "Echo District", tone: "rose" },
  { id: "album-4", title: "Glass Hours", subtitle: "Arden Fox", tone: "teal" },
  { id: "album-5", title: "Warm Static", subtitle: "Cedar Mint", tone: "amber" },
];

export const recentlyAdded: ArtworkItem[] = [
  { id: "recent-1", title: "Night Mode", subtitle: "Added today", tone: "green" },
  { id: "recent-2", title: "Cassette Sun", subtitle: "Added yesterday", tone: "amber" },
  { id: "recent-3", title: "Soft Circuit", subtitle: "Added this week", tone: "teal" },
];

export const discovery: ArtworkItem[] = [
  { id: "discover-1", title: "City Reverb", subtitle: "Random discovery", tone: "blue" },
  { id: "discover-2", title: "Motion Bloom", subtitle: "Because you like synths", tone: "rose" },
  { id: "discover-3", title: "Quiet Voltage", subtitle: "Hidden gem", tone: "violet" },
];

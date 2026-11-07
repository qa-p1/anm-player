import { BarChart3, Home, Library, Search, Settings, Heart, Music2, Disc3, ListMusic, Clock3, TrendingUp } from "lucide-react";

export const navItems = [
  { label: "Home", path: "/", icon: Home },
  { label: "Search", path: "/search", icon: Search },
  { label: "Library", path: "/library", icon: Library },
  { label: "Insights", path: "/insights", icon: BarChart3 },
  { label: "Settings", path: "/settings", icon: Settings },
] as const;

export const libraryNavItems = [
  { label: "Playlists", path: "/library/playlists", icon: ListMusic },
  { label: "Favorites", path: "/library/favorites", icon: Heart },
  { label: "Songs", path: "/library/songs", icon: Music2 },
  { label: "Albums", path: "/library/albums", icon: Disc3 },
  { label: "Recently played", path: "/library/smart/recently-played", icon: Clock3 },
  { label: "Most played", path: "/library/smart/most-played", icon: TrendingUp },
] as const;

export function isNavigationActive(pathname: string, path: string): boolean {
  return path === "/" ? pathname === path : pathname === path || pathname.startsWith(`${path}/`);
}

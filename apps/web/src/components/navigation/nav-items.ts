import { BarChart3, Home, Library, Search, Settings, Heart, Music2, Disc3, ListMusic, Clock3, TrendingUp, Mic2, Sparkles, Download } from "lucide-react";

export const navItems = [
  { label: "Home", path: "/", icon: Home },
  { label: "Search", path: "/search", icon: Search },
  { label: "Library", path: "/library", icon: Library },
  { label: "Insights", path: "/insights", icon: BarChart3 },
  { label: "Settings", path: "/settings", icon: Settings },
] as const;

/** Collections shown in the sidebar under the main navigation. */
export const libraryNavItems = [
  { label: "Favorites", path: "/library/favorites", icon: Heart },
  { label: "Songs", path: "/library/songs", icon: Music2 },
  { label: "Albums", path: "/library/albums", icon: Disc3 },
  { label: "Artists", path: "/library/artists", icon: Mic2 },
] as const;

/** Extra destinations reachable from quick find and the Library page. */
export const smartNavItems = [
  { label: "Playlists", path: "/library/playlists", icon: ListMusic },
  { label: "Recently added", path: "/library/smart/recently-added", icon: Sparkles },
  { label: "Recently played", path: "/library/smart/recently-played", icon: Clock3 },
  { label: "Most played", path: "/library/smart/most-played", icon: TrendingUp },
  { label: "Downloads", path: "/downloads", icon: Download },
] as const;

export function isNavigationActive(pathname: string, path: string): boolean {
  return path === "/" ? pathname === path : pathname === path || pathname.startsWith(`${path}/`);
}

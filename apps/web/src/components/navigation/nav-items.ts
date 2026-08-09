import { BarChart3, Home, Library, Search, Settings } from "lucide-react";

export const navItems = [
  { label: "Home", path: "/", icon: Home },
  { label: "Search", path: "/search", icon: Search },
  { label: "Library", path: "/library", icon: Library },
  { label: "Insights", path: "/insights", icon: BarChart3 },
  { label: "Settings", path: "/settings", icon: Settings },
] as const;

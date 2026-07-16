import { Home, Library, Search, Settings } from "lucide-react";

export const navItems = [
  { label: "Home", path: "/", icon: Home },
  { label: "Search", path: "/search", icon: Search },
  { label: "Library", path: "/library", icon: Library },
  { label: "Settings", path: "/settings", icon: Settings },
] as const;

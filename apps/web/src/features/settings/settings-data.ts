import {
  Activity,
  AppWindow,
  Download,
  Folder,
  HardDrive,
  Info,
  Plug,
  Tags,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface SettingItem {
  id: string;
  label: string;
  description: string;
  value: string;
  interactive?: "switch" | "button";
}

export interface SettingsGroup {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  items: SettingItem[];
}

export const settingsGroups: SettingsGroup[] = [
  {
    id: "appearance",
    title: "Appearance",
    description: "Theme controls and visual preferences.",
    icon: AppWindow,
    items: [
      { id: "theme", label: "Theme", description: "Dark, light, or system preference.", value: "Dark first", interactive: "button" },
      { id: "motion", label: "Motion", description: "Smooth transitions for navigation and cards.", value: "Enabled", interactive: "switch" },
    ],
  },
  {
    id: "downloads",
    title: "Downloads",
    description: "Future download queue behavior.",
    icon: Download,
    items: [
      { id: "queue", label: "Queue Mode", description: "Download queue service placeholder.", value: "Manual approval" },
      { id: "quality", label: "Preferred Quality", description: "No downloader is connected yet.", value: "Not configured" },
    ],
  },
  {
    id: "music-folder",
    title: "Music Folder",
    description: "Configurable local storage for the library.",
    icon: Folder,
    items: [
      { id: "library-path", label: "Library Path", description: "Provided by environment configuration.", value: "MUSIC_LIBRARY_PATH" },
      { id: "downloads-path", label: "Downloads Path", description: "Mounted separately for Docker deployments.", value: "DOWNLOADS_PATH" },
    ],
  },
  {
    id: "metadata",
    title: "Metadata",
    description: "Artwork and tag enrichment extension points.",
    icon: Tags,
    items: [
      { id: "artwork", label: "Artwork Cache", description: "Thumbnail storage will be configurable.", value: "Pending" },
      { id: "tags", label: "Tag Writing", description: "Metadata service placeholder.", value: "Disabled" },
    ],
  },
  {
    id: "performance",
    title: "Performance",
    description: "Fast local-first defaults for home servers.",
    icon: Activity,
    items: [
      { id: "cache", label: "Cache Directory", description: "Future cache volume extension point.", value: "Configurable" },
      { id: "workers", label: "Background Workers", description: "Queue and worker service placeholders.", value: "Not running" },
    ],
  },
  {
    id: "about",
    title: "About",
    description: "Project identity and runtime information.",
    icon: Info,
    items: [
      { id: "name", label: "Application", description: "Modern self-hosted music foundation.", value: "Aura" },
      { id: "version", label: "Version", description: "Initial architecture release.", value: "0.1.0" },
    ],
  },
  {
    id: "future-integrations",
    title: "Future Integrations",
    description: "Places where optional services can attach later.",
    icon: Plug,
    items: [
      { id: "downloader", label: "Downloader Provider", description: "No yt-dlp or provider logic is implemented.", value: "Not connected" },
      { id: "filesystem", label: "Filesystem Service", description: "Storage mounts will be discovered through settings.", value: "Planned" },
    ],
  },
  {
    id: "storage",
    title: "Storage Volumes",
    description: "Docker-friendly storage boundaries.",
    icon: HardDrive,
    items: [
      { id: "database", label: "Database", description: "SQLite placeholder only.", value: "DATABASE_URL" },
      { id: "logs", label: "Logs", description: "Future operational logs volume.", value: "Configurable" },
    ],
  },
];

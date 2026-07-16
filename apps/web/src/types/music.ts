export type ArtworkTone = "rose" | "teal" | "amber" | "violet" | "blue" | "green";

export interface ArtworkItem {
  id: string;
  title: string;
  subtitle: string;
  tone: ArtworkTone;
}

export interface SearchResultPreview {
  id: string;
  title: string;
  artist: string;
  duration: string;
  views: string;
  tone: ArtworkTone;
}

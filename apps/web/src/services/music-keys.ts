export const musicKeys = {
  all: ["music"] as const,

  favorites: () => [...musicKeys.all, "favorites"] as const,

  songs: () => [...musicKeys.all, "songs"] as const,
  songsAll: () => [...musicKeys.songs(), "all"] as const,
  song: (id: number) => [...musicKeys.songs(), "detail", id] as const,
  songsSearchAll: (query: string) => [...musicKeys.songs(), "search-all", { query }] as const,
  history: () => [...musicKeys.all, "history"] as const,
  insights: (days: number) => [...musicKeys.history(), "insights", days] as const,
  historyLog: (eventType: string = "all") => [...musicKeys.history(), "log", eventType] as const,
  library: () => [...musicKeys.all, "library"] as const,
  counts: () => [...musicKeys.library(), "counts"] as const,
  libraryAlbums: (limit: number | "all") => [...musicKeys.albums(), "library", limit] as const,
  librarySearch: (query: string) => [...musicKeys.library(), "search", query] as const,
  smartCollection: (id: string) => [...musicKeys.library(), "smart", id] as const,
  onlineArtist: (id: string) => [...musicKeys.artists(), "online", id] as const,
  historyRecentlyPlayed: (limit: number) => [...musicKeys.all, "history", "recently-played", { limit }] as const,
  historyMostPlayed: (limit: number) => [...musicKeys.all, "history", "most-played", { limit }] as const,

  artists: () => [...musicKeys.all, "artists"] as const,
  artist: (id: number) => [...musicKeys.artists(), "detail", id] as const,

  albums: () => [...musicKeys.all, "albums"] as const,
  album: (id: number) => [...musicKeys.albums(), "detail", id] as const,
  unifiedAlbum: (id: string) => [...musicKeys.albums(), "unified", id] as const,

  playlists: () => [...musicKeys.all, "playlists"] as const,
  playlistsAll: () => [...musicKeys.playlists(), "all"] as const,
  playlist: (id: number) => [...musicKeys.playlists(), "detail", id] as const,

  downloads: () => [...musicKeys.all, "downloads"] as const,
  downloadsList: () => [...musicKeys.downloads(), "list"] as const,
} as const;

import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes } from "react-router";

import { useAudioPlayer } from "@/hooks/use-audio-player";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { AppLayout } from "@/layouts/app-layout";
import { apiGet } from "@/services/api-client";
import { applyAccent, initializeTheme, useThemeStore, type AccentTheme, type ThemeMode } from "@/stores/theme-store";
import { useAppLifecycleStore } from "@/stores/app-lifecycle-store";

const HomePage = lazy(() => import("@/features/home/home-page").then((module) => ({ default: module.HomePage })));
const SearchPage = lazy(() => import("@/features/search/search-page").then((module) => ({ default: module.SearchPage })));
const AlbumDetailPage = lazy(() => import("@/features/library/album-detail-page").then((module) => ({ default: module.AlbumDetailPage })));
const AlbumsLibraryPage = lazy(() => import("@/features/library/albums-library-page").then((module) => ({ default: module.AlbumsLibraryPage })));
const ArtistDetailPage = lazy(() => import("@/features/library/artist-detail-page").then((module) => ({ default: module.ArtistDetailPage })));
const ArtistsLibraryPage = lazy(() => import("@/features/library/artists-library-page").then((module) => ({ default: module.ArtistsLibraryPage })));
const FavoritesPage = lazy(() => import("@/features/library/favorites-page").then((module) => ({ default: module.FavoritesPage })));
const LibraryPage = lazy(() => import("@/features/library/library-page").then((module) => ({ default: module.LibraryPage })));
const PlaylistDetailPage = lazy(() => import("@/features/library/playlist-detail-page").then((module) => ({ default: module.PlaylistDetailPage })));
const PlaylistsPage = lazy(() => import("@/features/library/playlists-page").then((module) => ({ default: module.PlaylistsPage })));
const SmartCollectionPage = lazy(() => import("@/features/library/smart-collection-page").then((module) => ({ default: module.SmartCollectionPage })));
const SongsLibraryPage = lazy(() => import("@/features/library/songs-library-page").then((module) => ({ default: module.SongsLibraryPage })));
const SettingsPage = lazy(() => import("@/features/settings/settings-page").then((module) => ({ default: module.SettingsPage })));
const InsightsPage = lazy(() => import("@/features/insights/insights-page").then((module) => ({ default: module.InsightsPage })));
const LegacyOnlineAlbumRedirect = lazy(() => import("@/features/library/legacy-album-redirect").then((module) => ({ default: module.LegacyOnlineAlbumRedirect })));
const LegacySavedAlbumRedirect = lazy(() => import("@/features/library/legacy-album-redirect").then((module) => ({ default: module.LegacySavedAlbumRedirect })));
const LegacyLocalAlbumRedirect = lazy(() => import("@/features/library/legacy-album-redirect").then((module) => ({ default: module.LegacyLocalAlbumRedirect })));

export function App() {
  const isClosed = useAppLifecycleStore((state) => state.isClosed);
  if (isClosed) {
    return (
      <main className="grid min-h-screen place-items-center px-6 text-center">
        <div role="status">
          <h1 className="text-3xl font-bold">ANM Player is closing</h1>
          <p className="mt-3 text-muted-foreground">You can close this tab. Run the launcher to open the app again.</p>
        </div>
      </main>
    );
  }
  return <RunningApp />;
}

function RunningApp() {
  const setMode = useThemeStore((state) => state.setMode);
  useEffect(() => {
    initializeTheme();
    apiGet<{ theme_mode: ThemeMode; accent_theme: AccentTheme }>("/settings")
      .then((settings) => {
        setMode(settings.theme_mode);
        applyAccent(settings.accent_theme);
      })
      .catch(() => undefined);
  }, [setMode]);

  // Initialize audio player and keyboard shortcuts
  useAudioPlayer();
  useKeyboardShortcuts();

  return (
    <Suspense fallback={<div className="grid min-h-[50vh] place-items-center text-sm text-muted-foreground">Loading…</div>}>
      <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="albums/:albumId" element={<AlbumDetailPage />} />
        <Route path="library">
          <Route index element={<LibraryPage />} />
          <Route path="songs" element={<SongsLibraryPage />} />
          <Route path="artists" element={<ArtistsLibraryPage />} />
          <Route path="artists/online/:artistId" element={<ArtistDetailPage />} />
          <Route path="artists/:artistId" element={<ArtistDetailPage />} />
          <Route path="albums" element={<AlbumsLibraryPage />} />
          <Route path="albums/online/:externalId" element={<LegacyOnlineAlbumRedirect />} />
          <Route path="albums/saved/:internalId" element={<LegacySavedAlbumRedirect />} />
          <Route path="albums/:internalId" element={<LegacyLocalAlbumRedirect />} />
          <Route path="favorites" element={<FavoritesPage />} />
          <Route path="playlists" element={<PlaylistsPage />} />
          <Route path="playlists/:playlistId" element={<PlaylistDetailPage />} />
          <Route path="smart/:collectionId" element={<SmartCollectionPage />} />
        </Route>
        <Route path="settings" element={<SettingsPage />} />
        <Route path="insights" element={<InsightsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

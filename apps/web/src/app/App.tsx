import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { HomePage } from "@/features/home/home-page";
import { AlbumDetailPage } from "@/features/library/album-detail-page";
import { LegacyLocalAlbumRedirect, LegacyOnlineAlbumRedirect, LegacySavedAlbumRedirect } from "@/features/library/legacy-album-redirect";
import { AlbumsLibraryPage } from "@/features/library/albums-library-page";
import { ArtistDetailPage } from "@/features/library/artist-detail-page";
import { ArtistsLibraryPage } from "@/features/library/artists-library-page";
import { FavoritesPage } from "@/features/library/favorites-page";
import { LibraryPage } from "@/features/library/library-page";
import { PlaylistDetailPage } from "@/features/library/playlist-detail-page";
import { PlaylistsPage } from "@/features/library/playlists-page";
import { SmartCollectionPage } from "@/features/library/smart-collection-page";
import { SongsLibraryPage } from "@/features/library/songs-library-page";
import { SearchPage } from "@/features/search/search-page";
import { SettingsPage } from "@/features/settings/settings-page";
import { useAudioPlayer } from "@/hooks/use-audio-player";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { AppLayout } from "@/layouts/app-layout";
import { apiGet } from "@/services/api-client";
import { applyAccent, initializeTheme, useThemeStore, type AccentTheme, type ThemeMode } from "@/stores/theme-store";

export function App() {
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
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

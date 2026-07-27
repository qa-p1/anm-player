import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router";

import { getLibraryAlbum, resolveLegacyAlbumPublicId } from "@/services/music-api";

export function LegacyOnlineAlbumRedirect() {
  const { externalId = "" } = useParams<{ externalId: string }>();
  return <Navigate to={`/albums/${encodeURIComponent(externalId)}`} replace />;
}

export function LegacySavedAlbumRedirect() {
  const { internalId = "" } = useParams<{ internalId: string }>();
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const albumId = Number(internalId);
    if (!Number.isSafeInteger(albumId) || albumId <= 0) {
      setTarget("/library/albums");
      return () => controller.abort();
    }
    getLibraryAlbum(albumId, controller.signal)
      .then((album) => {
        if (!controller.signal.aborted) setTarget(album.canonical_url);
      })
      .catch(() => {
        if (!controller.signal.aborted) setTarget("/library/albums");
      });
    return () => controller.abort();
  }, [internalId]);
  return target ? <Navigate to={target} replace /> : <div className="grid min-h-screen place-items-center text-muted-foreground">Resolving album...</div>;
}

export function LegacyLocalAlbumRedirect() {
  const { internalId = "" } = useParams<{ internalId: string }>();
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const albumId = Number(internalId);
    if (!Number.isSafeInteger(albumId) || albumId <= 0) {
      setTarget("/library/albums");
      return () => controller.abort();
    }
    resolveLegacyAlbumPublicId(albumId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setTarget(result.canonical_url);
      })
      .catch(() => {
        if (!controller.signal.aborted) setTarget("/library/albums");
      });
    return () => controller.abort();
  }, [internalId]);
  return target ? <Navigate to={target} replace /> : <div className="grid min-h-screen place-items-center text-muted-foreground">Resolving album...</div>;
}

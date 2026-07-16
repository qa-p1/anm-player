import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";

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
    getLibraryAlbum(Number(internalId), controller.signal).then((album) => setTarget(album.canonical_url)).catch(() => setTarget("/library/albums"));
    return () => controller.abort();
  }, [internalId]);
  return target ? <Navigate to={target} replace /> : <div className="grid min-h-screen place-items-center text-muted-foreground">Resolving album...</div>;
}

export function LegacyLocalAlbumRedirect() {
  const { internalId = "" } = useParams<{ internalId: string }>();
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    resolveLegacyAlbumPublicId(Number(internalId), controller.signal).then((result) => setTarget(result.canonical_url)).catch(() => setTarget("/library/albums"));
    return () => controller.abort();
  }, [internalId]);
  return target ? <Navigate to={target} replace /> : <div className="grid min-h-screen place-items-center text-muted-foreground">Resolving album...</div>;
}

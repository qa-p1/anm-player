import { useEffect, useState } from "react";
import { cachedArtworkUrl } from "@/services/api-client";

interface ArtworkPalette {
  base: string;
}

const fallbackPalette: ArtworkPalette = {
  base: "rgb(73, 78, 84)",
};

export function useDominantArtworkPalette(artworkUrl: string | null) {
  const [palette, setPalette] = useState<ArtworkPalette>(fallbackPalette);

  useEffect(() => {
    if (!artworkUrl) {
      setPalette(fallbackPalette);
      return;
    }

    let cancelled = false;
    const cached = artworkPaletteCache.get(artworkUrl);
    if (cached) {
      setPalette(cached);
      return;
    }
    setPalette(fallbackPalette);
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 48;
        canvas.height = 48;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return;
        context.drawImage(image, 0, 0, 48, 48);
        const pixels = context.getImageData(0, 0, 48, 48).data;
        const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();

        for (let index = 0; index < pixels.length; index += 16) {
          if (pixels[index + 3] < 180) continue;
          const r = pixels[index];
          const g = pixels[index + 1];
          const b = pixels[index + 2];
          const luminance = r * 0.299 + g * 0.587 + b * 0.114;
          if (luminance < 14 || luminance > 242) continue;
          const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
          const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
          bucket.count += 1;
          bucket.r += r;
          bucket.g += g;
          bucket.b += b;
          buckets.set(key, bucket);
        }

        const dominant = [...buckets.values()].sort((a, b) => colorScore(b) - colorScore(a))[0];
        if (!dominant || cancelled) return;
        const source = [dominant.r / dominant.count, dominant.g / dominant.count, dominant.b / dominant.count];
        const base = boostDominantColor(source);
        const nextPalette = { base: rgb(base) };
        if (artworkPaletteCache.size >= 128 && !artworkPaletteCache.has(artworkUrl)) {
          const oldestKey = artworkPaletteCache.keys().next().value;
          if (oldestKey) artworkPaletteCache.delete(oldestKey);
        }
        artworkPaletteCache.set(artworkUrl, nextPalette);
        setPalette(nextPalette);
      } catch {
        if (!cancelled) setPalette(fallbackPalette);
      }
    };
    image.onerror = () => {
      if (!cancelled) setPalette(fallbackPalette);
    };
    image.src = colorExtractionUrl(cachedArtworkUrl(artworkUrl, 128) ?? artworkUrl);
    return () => {
      cancelled = true;
    };
  }, [artworkUrl]);

  return palette;
}

const artworkPaletteCache = new Map<string, ArtworkPalette>();

function colorScore(bucket: { count: number; r: number; g: number; b: number }) {
  const r = bucket.r / bucket.count;
  const g = bucket.g / bucket.count;
  const b = bucket.b / bucket.count;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  return bucket.count * (1 + saturation * 0.45);
}

function boostDominantColor(channels: number[]) {
  const average = channels.reduce((sum, channel) => sum + channel, 0) / channels.length;
  return channels.map((channel) => {
    const saturated = average + (channel - average) * 1.18;
    return Math.round(Math.max(28, Math.min(184, saturated * 0.72 + 18)));
  });
}

function colorExtractionUrl(url: string) {
  if (!import.meta.env.DEV) return url;
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.pathname.startsWith("/api/")) {
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    // Use the original artwork URL when it cannot be parsed.
  }
  return url;
}

function rgb(channels: number[]) {
  return `rgb(${channels.join(", ")})`;
}

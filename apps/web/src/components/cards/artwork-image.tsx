import { useEffect, useState, type ImgHTMLAttributes } from "react";

interface ArtworkImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "onError"> {
  src: string | null | undefined;
  fallbackSrc?: string | null;
}

export function ArtworkImage({ src, fallbackSrc, ...props }: ArtworkImageProps) {
  const [activeSrc, setActiveSrc] = useState(src || fallbackSrc || null);

  useEffect(() => {
    setActiveSrc(src || fallbackSrc || null);
  }, [src, fallbackSrc]);

  if (!activeSrc) return null;

  return (
    <img
      {...props}
      src={activeSrc}
      onError={() => {
        if (fallbackSrc && activeSrc !== fallbackSrc) setActiveSrc(fallbackSrc);
        else setActiveSrc(null);
      }}
    />
  );
}

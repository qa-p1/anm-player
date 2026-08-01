import { useState, type ImgHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

interface ArtworkImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "onError"> {
  src: string | null | undefined;
  alt: string;
  fallbackSrc?: string | null;
}

export function ArtworkImage({ src, alt, fallbackSrc, ...props }: ArtworkImageProps) {
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const activeSrc = [src, fallbackSrc]
    .filter((candidate): candidate is string => Boolean(candidate))
    .find((candidate, index, candidates) => candidates.indexOf(candidate) === index && !failedSources.includes(candidate))
    ?? null;

  if (!activeSrc) {
    return (
      <div
        role={alt ? "img" : "presentation"}
        aria-label={alt || undefined}
        className={cn(
          "bg-[linear-gradient(135deg,#f43f5e,#14b8a6_52%,#f59e0b)]",
          props.className,
        )}
      />
    );
  }

  return (
    <img
      {...props}
      src={activeSrc}
      alt={alt}
      onError={() => {
        setFailedSources((current) => {
          if (current.includes(activeSrc)) return current;
          return [...current.slice(-7), activeSrc];
        });
      }}
    />
  );
}

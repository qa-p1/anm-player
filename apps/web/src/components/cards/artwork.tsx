import { motion } from "framer-motion";
import { Heart, MoreHorizontal, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ArtworkItem, ArtworkTone } from "@/types/music";

const toneClasses: Record<ArtworkTone, string> = {
  rose: "from-rose-500 via-orange-400 to-teal-400",
  teal: "from-teal-400 via-emerald-500 to-stone-900",
  amber: "from-amber-300 via-red-500 to-neutral-900",
  violet: "from-fuchsia-500 via-violet-500 to-amber-300",
  blue: "from-sky-400 via-cyan-500 to-rose-500",
  green: "from-lime-300 via-emerald-500 to-zinc-950",
};

interface ArtworkProps {
  item: ArtworkItem;
  shape?: "album" | "artist";
}

export function ArtworkCard({ item, shape = "album" }: ArtworkProps) {
  return (
    <motion.article
      whileHover={{ y: -5, scale: 1.01 }}
      transition={{ type: "spring", stiffness: 320, damping: 26 }}
      className="group min-w-0"
    >
      <div
        className={cn(
          "relative mb-3 aspect-square overflow-hidden bg-gradient-to-br shadow-glass",
          toneClasses[item.tone],
          shape === "artist" ? "rounded-full" : "rounded-[1.35rem]",
        )}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.46),transparent_24%),linear-gradient(135deg,rgba(255,255,255,0.14),transparent)]" />
        <div className="absolute inset-x-4 bottom-4 h-16 rounded-full bg-black/20 blur-2xl" />
        <div className="absolute inset-x-3 bottom-3 flex translate-y-4 items-center justify-between opacity-0 transition group-hover:translate-y-0 group-hover:opacity-100">
          <Button size="icon" variant="glass" aria-label={`Play ${item.title}`}>
            <Play className="h-4 w-4 fill-current" />
          </Button>
          <Button size="icon" variant="glass" aria-label={`More actions for ${item.title}`}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{item.title}</p>
        <p className="truncate text-sm text-muted-foreground">{item.subtitle}</p>
      </div>
    </motion.article>
  );
}

export function WideArtworkCard({ item }: { item: ArtworkItem }) {
  return (
    <motion.article
      whileHover={{ y: -4 }}
      className="glass-panel flex min-w-[17rem] items-center gap-4 rounded-2xl p-3"
    >
      <div className={cn("h-16 w-16 shrink-0 rounded-2xl bg-gradient-to-br", toneClasses[item.tone])} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{item.title}</p>
        <p className="truncate text-xs text-muted-foreground">{item.subtitle}</p>
      </div>
      <Heart className="h-4 w-4 text-muted-foreground" />
    </motion.article>
  );
}

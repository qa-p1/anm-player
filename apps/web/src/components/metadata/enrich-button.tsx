import { Sparkles, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { enrichSong } from "@/services/music-api";
import { useQueryClient } from "@tanstack/react-query";
import { musicKeys } from "@/hooks/use-music-queries";

interface EnrichButtonProps {
  songId: number;
  variant?: "default" | "ghost" | "outline";
  size?: "default" | "sm" | "lg" | "icon";
  showLabel?: boolean;
}

export function EnrichButton({ songId, variant = "ghost", size = "sm", showLabel = true }: EnrichButtonProps) {
  const [isEnriching, setIsEnriching] = useState(false);
  const queryClient = useQueryClient();

  async function handleEnrich(event: React.MouseEvent) {
    event.stopPropagation();
    setIsEnriching(true);
    try {
      await enrichSong(songId);
      // Invalidate song cache to refetch with new metadata
      queryClient.invalidateQueries({ queryKey: musicKeys.song(songId) });
      queryClient.invalidateQueries({ queryKey: musicKeys.songs() });
    } catch (error) {
      console.error("Failed to enrich song:", error);
    } finally {
      setIsEnriching(false);
    }
  }

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleEnrich}
      disabled={isEnriching}
      className="gap-2"
    >
      {isEnriching ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Sparkles className="h-4 w-4" />
      )}
      {showLabel && (isEnriching ? "Enriching..." : "Enrich")}
    </Button>
  );
}

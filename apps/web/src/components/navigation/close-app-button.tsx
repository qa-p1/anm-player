import { Power } from "lucide-react";
import { useState } from "react";

import { toast } from "@/components/ui/toast";
import { queryClient } from "@/lib/query-client";
import { apiPost } from "@/services/api-client";
import { audioService } from "@/services/audio-service";
import { useAppLifecycleStore } from "@/stores/app-lifecycle-store";
import { usePlayerStore } from "@/stores/player-store";

export function CloseAppButton() {
  const [isClosing, setIsClosing] = useState(false);

  async function closeApp() {
    if (isClosing) return;
    setIsClosing(true);
    try {
      await apiPost("/app/shutdown");
      usePlayerStore.getState().setIsPlaying(false);
      audioService.pause();
      useAppLifecycleStore.getState().setClosed();
      await queryClient.cancelQueries();
    } catch (error) {
      setIsClosing(false);
      toast(error instanceof Error ? error.message : "Could not close the app. Try again.", "error");
    }
  }

  return (
    <button type="button" disabled={isClosing} onClick={() => void closeApp()} className="mb-3 flex h-10 w-full items-center gap-3 rounded-xl px-4 text-xs font-medium text-muted-foreground transition hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50">
      <Power className="h-4 w-4" />{isClosing ? "Closing app…" : "Close app"}
    </button>
  );
}

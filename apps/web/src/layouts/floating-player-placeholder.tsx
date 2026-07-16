import { AnimatePresence } from "framer-motion";

import { FullScreenPlayer } from "@/layouts/player/full-screen-player";
import { MiniPlayer } from "@/layouts/player/mini-player";
import { useUiStore } from "@/stores/ui-store";

export function FloatingPlayerPlaceholder() {
  const { isPlayerExpanded, setPlayerExpanded } = useUiStore();

  return (
    <AnimatePresence mode="wait">
      {!isPlayerExpanded && <MiniPlayer onOpen={() => setPlayerExpanded(true)} />}
      {isPlayerExpanded && <FullScreenPlayer onClose={() => setPlayerExpanded(false)} />}
    </AnimatePresence>
  );
}

import { useEffect } from "react";
import { useNavigate } from "react-router";
import { playerCommands } from "@/features/commands/player-commands";
import { usePlayerStore } from "@/stores/player-store";
import { useUiStore } from "@/stores/ui-store";

export function useKeyboardShortcuts() {
  const navigate = useNavigate();
  useEffect(() => {
    function handleKeyPress(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.altKey) return;
      const target = event.target;
      const element = target instanceof Element ? target : null;
      const editable = element?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]');
      const overlay = document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]');
      const modified = event.ctrlKey || event.metaKey;
      if (modified && event.code === "KeyK" && (!overlay || useUiStore.getState().isCommandPaletteOpen)) {
        event.preventDefault();
        const ui = useUiStore.getState();
        ui.setCommandPaletteOpen(!ui.isCommandPaletteOpen);
        return;
      }
      if (editable || overlay) return;
      if (event.key === "?" && !modified) {
        event.preventDefault();
        useUiStore.getState().setShortcutHelpOpen(true);
        return;
      }
      if (event.shiftKey || event.repeat) return;
      if (!modified && event.code === "Slash") {
        event.preventDefault();
        const search = document.getElementById("music-search");
        if (search instanceof HTMLInputElement) search.focus();
        else navigate("/search");
        return;
      }
      // Native buttons, links, sliders and drag handles own their keyboard events.
      if (element?.closest('button, a, [role="button"], [role="slider"], [role="tab"]')) return;
      const command = playerCommands.find((entry) => entry.code === event.code && Boolean(entry.modified) === modified);
      if (!command || (command.needsTrack && !usePlayerStore.getState().currentSong)) return;
      event.preventDefault();
      command.run();
    }
    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [navigate]);
}

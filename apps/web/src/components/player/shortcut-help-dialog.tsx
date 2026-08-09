import { Keyboard, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUiStore } from "@/stores/ui-store";

const shortcutGroups = [
  {
    title: "Transport",
    shortcuts: [
      ["Space", "Play or pause"],
      ["⌘/Ctrl", "+", "← / →", "Previous or next track"],
      ["← / →", "Seek backward or forward"],
      ["↑ / ↓", "Volume up or down"],
      ["M", "Mute or unmute"],
    ],
  },
  {
    title: "Playback modes",
    shortcuts: [
      ["S", "Toggle shuffle"],
      ["R", "Cycle repeat mode"],
      ["A", "Toggle autoplay radio"],
      ["[ / ]", "Decrease or increase speed"],
      ["0", "Reset speed to 1×"],
      ["T", "Start or cancel a 30-minute timer"],
    ],
  },
  {
    title: "Player views",
    shortcuts: [
      ["Q", "Open the queue"],
      ["L", "Open lyrics"],
      ["E", "Open playback studio"],
      ["B", "Bookmark the current position"],
      ["Esc", "Return or close player"],
      ["?", "Open this shortcut guide"],
    ],
  },
] as const;

export function ShortcutHelpDialog() {
  const open = useUiStore((state) => state.isShortcutHelpOpen);
  const setOpen = useUiStore((state) => state.setShortcutHelpOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Keyboard className="h-5 w-5 text-primary" />Keyboard shortcuts</DialogTitle><DialogDescription>Control ANM Player without leaving the keyboard. Shortcuts pause while you type in a field.</DialogDescription></DialogHeader>
        <div className="grid gap-5 sm:grid-cols-3">
          {shortcutGroups.map((group) => (
            <section key={group.title}><h3 className="mb-3 text-sm font-bold">{group.title}</h3><dl className="space-y-3">{group.shortcuts.map((shortcut, index) => {
              const description = shortcut[shortcut.length - 1];
              const keys = shortcut.slice(0, -1);
              return <div key={`${group.title}-${index}`}><dt className="flex flex-wrap items-center gap-1">{keys.map((key) => <kbd key={key} className="min-w-7 rounded-md border border-white/10 bg-muted px-1.5 py-1 text-center text-[0.65rem] font-bold shadow-sm">{key}</kbd>)}</dt><dd className="mt-1 text-xs leading-5 text-muted-foreground">{description}</dd></div>;
            })}</dl></section>
          ))}
        </div>
        <Button variant="glass" className="mt-1 sm:hidden" onClick={() => setOpen(false)}><X className="h-4 w-4" />Close</Button>
      </DialogContent>
    </Dialog>
  );
}

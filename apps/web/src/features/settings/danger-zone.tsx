import { useQuery } from "@tanstack/react-query";
import { Bomb, Check, PackageX, Trash2, X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { SettingRow, SettingsGroup } from "@/features/settings/settings-controls";
import { forgetBrowserData } from "@/lib/forget-browser-data";
import { apiGet, apiPost } from "@/services/api-client";

type DangerAction = "reset" | "uninstall" | "remove";

const LIBRARY = "Your library: songs, albums, playlists, favorites, listening history and settings";
const MUSIC = "Downloaded music, artwork and lyrics";

const ACTIONS: Record<DangerAction, { label: string; description: string; button: string; title: string; phrase: string; removes: string[]; keeps: string[] }> = {
  reset: {
    label: "Erase all data and start fresh",
    description: "Wipe your library and downloads. The app stays installed and opens like new.",
    button: "Erase data",
    title: "Erase everything and start fresh?",
    phrase: "RESET ANM PLAYER",
    removes: [LIBRARY, MUSIC, "Caches"],
    keeps: ["The app itself"],
  },
  uninstall: {
    label: "Uninstall, keep my data",
    description: "Remove the app and its shortcuts. Reinstall later and everything is still there.",
    button: "Uninstall",
    title: "Uninstall ANM Player?",
    phrase: "UNINSTALL ANM PLAYER",
    removes: ["The app, its launcher and desktop shortcut"],
    keeps: [LIBRARY, MUSIC],
  },
  remove: {
    label: "Uninstall and delete everything",
    description: "Remove the app, its shortcuts and all of your data from this computer.",
    button: "Delete all",
    title: "Delete ANM Player and all of its data?",
    phrase: "DELETE ANM PLAYER",
    removes: ["The app, its launcher and desktop shortcut", LIBRARY, MUSIC, "Caches"],
    keeps: [],
  },
};

const dangerButton = "border-red-500/50 text-red-300 hover:bg-red-500/15 hover:text-red-200";

export function DangerZone({ dataRoot }: { dataRoot: string | undefined }) {
  const { data: uninstall } = useQuery({ queryKey: ["app", "uninstall"], queryFn: ({ signal }) => apiGet<{ supported: boolean }>("/app/uninstall", { signal }), staleTime: Infinity });
  const [action, setAction] = useState<DangerAction | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState<DangerAction | null>(null);
  const canUninstall = uninstall?.supported ?? false;
  const current = action ? ACTIONS[action] : null;

  function open(next: DangerAction) {
    setAction(next);
    setConfirmation("");
  }

  async function run() {
    if (!action || !current || confirmation !== current.phrase) return;
    setBusy(true);
    try {
      if (action === "reset") {
        await apiPost("/settings/storage/reset", { confirmation });
        setAction(null);
        window.dispatchEvent(new CustomEvent("aura-storage-migration-started", { detail: { operation_kind: "reset" } }));
      } else {
        await apiPost("/app/uninstall", { keep_data: action === "uninstall", confirmation });
        if (action === "remove") forgetBrowserData();
        setAction(null);
        setRemoved(action);
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : "That didn't work. Try again.", "error");
    } finally {
      setBusy(false);
    }
  }

  const unavailable = canUninstall ? undefined : "Only available in the installed desktop app.";

  return (
    <>
      <SettingsGroup id="danger" title="Danger zone" icon={<Bomb />} tone="danger">
        <SettingRow label={ACTIONS.reset.label} description={ACTIONS.reset.description} control={<Button variant="outline" size="sm" className={dangerButton} onClick={() => open("reset")}><Bomb className="h-4 w-4" />{ACTIONS.reset.button}</Button>} />
        <SettingRow label={ACTIONS.uninstall.label} description={unavailable ?? ACTIONS.uninstall.description} control={<Button variant="outline" size="sm" className={dangerButton} disabled={!canUninstall} onClick={() => open("uninstall")}><PackageX className="h-4 w-4" />{ACTIONS.uninstall.button}</Button>} />
        <SettingRow label={ACTIONS.remove.label} description={unavailable ?? ACTIONS.remove.description} control={<Button variant="outline" size="sm" className={dangerButton} disabled={!canUninstall} onClick={() => open("remove")}><Trash2 className="h-4 w-4" />{ACTIONS.remove.button}</Button>} />
      </SettingsGroup>

      <Dialog open={current !== null} onOpenChange={(next) => { if (!next && !busy) setAction(null); }}>
        {current && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{current.title}</DialogTitle>
              <DialogDescription>This can't be undone.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <ul aria-label="Removed" className="space-y-1.5 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
                {current.removes.map((item) => <li key={item} className="flex gap-2"><X className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />{item}</li>)}
              </ul>
              {current.keeps.length > 0 && (
                <ul aria-label="Kept" className="space-y-1.5 rounded-xl border border-white/10 bg-white/[0.04] p-4">
                  {current.keeps.map((item) => <li key={item} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />{item}</li>)}
                </ul>
              )}
              {dataRoot && action !== "reset" && <p className="break-all text-xs text-muted-foreground">Data folder: <span className="font-mono">{dataRoot}</span></p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="danger-confirmation">Type <strong>{current.phrase}</strong> to continue</Label>
              <Input id="danger-confirmation" autoComplete="off" spellCheck={false} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={current.phrase} />
            </div>
            <DialogFooter>
              <Button variant="ghost" disabled={busy} onClick={() => setAction(null)}>Cancel</Button>
              <Button variant="outline" className={dangerButton} disabled={confirmation !== current.phrase || busy} onClick={() => void run()}>{busy ? "Starting…" : current.button}</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      {removed && createPortal(
        <div role="alertdialog" aria-labelledby="uninstalled-title" className="fixed inset-0 z-[500] grid place-items-center bg-background p-6 text-center">
          <div className="max-w-md space-y-3">
            <PackageX className="mx-auto h-10 w-10 text-muted-foreground" />
            <h2 id="uninstalled-title" className="text-2xl font-black tracking-tight">ANM Player is being removed</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              {removed === "uninstall" ? <>Your music and library stay in <span className="break-all font-mono">{dataRoot}</span>. Install ANM Player again to pick up where you left off.</> : "The app and all of its data are being deleted."}
            </p>
            <p className="text-sm text-muted-foreground">You can close this tab.</p>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

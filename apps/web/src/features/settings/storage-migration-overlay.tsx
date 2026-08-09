import { AlertTriangle, Check, CheckCircle2, Database, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { apiGet } from "@/services/api-client";
import { audioService } from "@/services/audio-service";

export interface MigrationStatus {
  active: boolean;
  operation_kind?: "migration" | "reset";
  phase: string;
  message: string;
  files_processed: number;
  files_total: number;
  bytes_processed: number;
  bytes_total: number;
  percent: number;
  error: string | null;
  cleanup_warning: string | null;
}

export function StorageMigrationOverlay() {
  const [migration, setMigration] = useState<MigrationStatus | null>(null);
  const [operationKind, setOperationKind] = useState<"migration" | "reset">("migration");
  const [view, setView] = useState<"idle" | "moving" | "verified" | "failed">("idle");
  const wasActive = useRef(false);
  const terminalView = useRef(false);
  const refreshTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let pollingTimer: number | null = null;

    function schedulePoll() {
      if (cancelled || terminalView.current || pollingTimer !== null) return;
      pollingTimer = window.setTimeout(() => {
        pollingTimer = null;
        void poll();
      }, 1000);
    }

    function showMigrationImmediately(event: Event) {
      const detail = (event as CustomEvent<{ operation_kind?: "migration" | "reset" }>).detail;
      const nextKind = detail?.operation_kind ?? "migration";
      audioService.pause();
      setOperationKind(nextKind);
      terminalView.current = false;
      wasActive.current = true;
      setView("moving");
      setMigration((current) => current?.active ? current : {
        active: true,
        operation_kind: nextKind,
        phase: "prepared",
        message: nextKind === "reset"
          ? "Preparing a clean data location and waiting for open files to close…"
          : "Preparing the data move and waiting for open files to close…",
        files_processed: 0,
        files_total: 0,
        bytes_processed: 0,
        bytes_total: 0,
        percent: 0,
        error: null,
        cleanup_warning: null,
      });
      void poll();
    }

    function showDetectedMigration(event: Event) {
      const next = (event as CustomEvent<MigrationStatus>).detail;
      if (!next) return;
      terminalView.current = false;
      setMigration(next);
      if (next.operation_kind) setOperationKind(next.operation_kind);
      if (next.active) {
        audioService.pause();
        wasActive.current = true;
        setView("moving");
        schedulePoll();
      } else if (next.error) {
        terminalView.current = true;
        setView("failed");
      }
    }

    async function poll() {
      if (terminalView.current) return;
      try {
        const next = await apiGet<MigrationStatus>("/settings/storage/migrations/current");
        if (!cancelled) {
          setMigration(next);
          if (next.operation_kind) setOperationKind(next.operation_kind);
          if (next.active) {
            audioService.pause();
            setView("moving");
          } else if (wasActive.current) {
            window.dispatchEvent(new Event("aura-storage-ready"));
            if (next.error) {
              terminalView.current = true;
              setView("failed");
            } else {
              terminalView.current = true;
              setView("verified");
              if (next.operation_kind === "reset") {
                audioService.destroy();
                for (const key of [
                  "aura-player-storage",
                  "anm-playback-preferences",
                  "anm-lyrics-preferences",
                  "anm-search-history",
                  "aura-theme",
                  "aura-accent",
                ]) {
                  window.localStorage.removeItem(key);
                }
              }
              refreshTimer.current = window.setTimeout(() => window.location.reload(), 2500);
            }
          } else if (next.error) {
            terminalView.current = true;
            setView("failed");
          }
          wasActive.current = next.active;
          if (next.active) schedulePoll();
        }
      } catch {
        // The API may be restarting while rebinding SQLite; keep the last overlay.
        if (wasActive.current) schedulePoll();
      }
    }
    window.addEventListener("aura-storage-migration-started", showMigrationImmediately);
    window.addEventListener("aura-storage-migration-detected", showDetectedMigration);
    return () => {
      cancelled = true;
      if (pollingTimer !== null) window.clearTimeout(pollingTimer);
      window.removeEventListener("aura-storage-migration-started", showMigrationImmediately);
      window.removeEventListener("aura-storage-migration-detected", showDetectedMigration);
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    };
  }, []);

  if (view === "idle" || !migration) return null;
  const isReset = operationKind === "reset";

  return (
    <div className="fixed inset-0 z-[200] grid place-items-center bg-background/95 px-5 backdrop-blur-xl" role="alert" aria-live="assertive">
      {view === "moving" && <div className="glass-panel w-full max-w-xl rounded-3xl p-7 shadow-2xl">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl bg-primary/15 p-3">
            <Database className="h-7 w-7 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-black">{isReset ? "Starting ANM Player fresh…" : "Moving data to new location…"}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{migration.message}</p>
          </div>
          <LoaderCircle className="h-5 w-5 animate-spin text-primary" />
        </div>
        <div className="mt-6 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${migration.percent}%` }} />
        </div>
        <div className="mt-3 flex justify-between text-xs text-muted-foreground">
          <span className="capitalize">{migration.phase.replaceAll("_", " ")}</span>
          <span>{isReset ? `${migration.percent}%` : `${migration.percent}% · ${migration.files_processed.toLocaleString()} / ${migration.files_total.toLocaleString()} files`}</span>
        </div>
        <p className="mt-5 text-xs text-muted-foreground">Playback is paused and ANM Player controls are temporarily locked to keep the database and media files consistent.</p>
      </div>}

      {view === "verified" && <div className="glass-panel w-full max-w-xl rounded-3xl p-7 text-center shadow-2xl">
        <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-400" />
        <h2 className="mt-4 text-2xl font-black">{isReset ? "ANM Player is ready for a fresh start" : "Data move complete and verified"}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{isReset ? "The clean database and storage layout are ready at the new location." : "ANM Player is now using the new data location."}</p>
        <div className="mx-auto mt-6 max-w-sm space-y-3 text-left text-sm">
          <VerificationLine label={isReset ? "Fresh SQLite database created" : "SQLite database integrity passed"} />
          <VerificationLine label={isReset ? "No prior library records carried over" : "Managed files and track paths verified"} />
          <VerificationLine label="New storage directories are writable" />
        </div>
        {migration.cleanup_warning && <p className="mt-5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-left text-sm text-amber-200">{migration.cleanup_warning}</p>}
        <div className="mt-7 flex items-center justify-center gap-2 text-sm font-semibold text-primary"><RefreshCw className="h-4 w-4 animate-spin" />Refreshing ANM Player…</div>
      </div>}

      {view === "failed" && <div className="glass-panel w-full max-w-xl rounded-3xl p-7 text-center shadow-2xl">
        <AlertTriangle className="mx-auto h-14 w-14 text-amber-400" />
        <h2 className="mt-4 text-2xl font-black">{isReset ? "Fresh start could not be completed" : "Data move could not be completed"}</h2>
        <p className="mt-3 text-sm text-muted-foreground">{migration.error || "ANM Player kept the last verified data location active."}</p>
        <Button className="mt-6" onClick={() => window.location.reload()}><RefreshCw className="h-4 w-4" />Reload ANM Player</Button>
      </div>}
    </div>
  );
}

function VerificationLine({ label }: { label: string }) {
  return <div className="flex items-center gap-3"><span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-500/15"><Check className="h-4 w-4 text-emerald-400" /></span><span>{label}</span></div>;
}

import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Check, Download, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { busyUpdateStates, requestAppUpdate, useAppUpdates, useAppUpdateUi } from "@/features/updates/use-app-updates";
import { cn } from "@/lib/utils";

const stageProgress: Record<string, number> = { downloading: 15, installing: 40, building: 75, restarting: 95, completed: 100 };

export function AppUpdateControls() {
  const { data, isError } = useAppUpdates();
  const { requesting, installing, error } = useAppUpdateUi();
  const [showCurrent, setShowCurrent] = useState(false);
  useEffect(() => {
    setShowCurrent(data?.state === "current");
    if (data?.state !== "current") return;
    const timer = window.setTimeout(() => setShowCurrent(false), 6500);
    return () => window.clearTimeout(timer);
  }, [data?.state, data?.updated_at]);
  const busy = Boolean(requesting) || busyUpdateStates.has(data?.state ?? "");
  const available = data?.state === "available";
  const failed = Boolean(error) || data?.state === "error" || isError;
  const message = error || (isError && installing ? "Reconnecting while ANM Player restarts…" : data?.message);
  const label = busy ? message || "Checking for updates…" : failed ? message || "Update failed. Click to retry." : available ? "Install app update and restart" : data?.supported === false ? "Docker updates use Docker Compose" : showCurrent ? "Up to date. Check again" : "Check for app updates";
  const Icon = busy ? RefreshCw : failed ? AlertCircle : available ? Download : showCurrent ? Check : RefreshCw;
  const progress = stageProgress[data?.state ?? ""] ?? 5;

  return <div className="relative shrink-0">
    <button type="button" aria-label={label} title={available && data?.summary ? `${label}: ${data.summary}` : label} disabled={busy || data?.supported === false} onClick={() => void requestAppUpdate(available)} className={cn("grid h-9 w-9 place-items-center rounded-xl text-muted-foreground transition hover:bg-white/[0.06] hover:text-foreground disabled:cursor-default", available && "bg-primary/10 text-primary hover:text-primary", failed && "text-red-400", data?.supported === false && "opacity-35")}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={busy ? "busy" : failed ? "error" : available ? "download" : showCurrent ? "current" : "refresh"} initial={{ opacity: 0, scale: 0.75 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.75 }} transition={{ duration: 0.15 }} className="flex">
          <Icon className={cn("h-4 w-4", busy && "animate-spin motion-reduce:animate-none")} />
        </motion.span>
      </AnimatePresence>
    </button>
    <AnimatePresence>
      {(installing || (busy && data?.state !== "checking" && requesting !== "check")) && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="progressbar" aria-label="App update progress" aria-valuetext={message || "Preparing update"} className="absolute inset-x-1 bottom-0 h-0.5 overflow-hidden rounded-full bg-primary/15">
        <motion.div className="h-full rounded-full bg-primary" initial={{ width: "5%" }} animate={{ width: `${progress}%` }} transition={{ duration: 0.45, ease: "easeOut" }} />
      </motion.div>}
    </AnimatePresence>
    <span className="sr-only" role="status" aria-live="polite">{message}</span>
  </div>;
}

/** Observe completion once for the app; all visible controls share the same query. */
export function AppUpdateMonitor() {
  const { data } = useAppUpdates();
  const installing = useAppUpdateUi((state) => state.installing);
  useEffect(() => {
    if (!installing) return;
    if (data?.state === "completed" && data.installed_commit === data.current_commit) {
      useAppUpdateUi.setState({ installing: false });
      window.location.reload();
    } else if (data?.state === "error") {
      useAppUpdateUi.setState({ installing: false });
    }
  }, [data, installing]);
  return null;
}

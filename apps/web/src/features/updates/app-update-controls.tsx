import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Check, Download, RefreshCw } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";

import { busyUpdateStates, requestAppUpdate, useAppUpdates, useAppUpdateUi } from "@/features/updates/use-app-updates";
import { cn } from "@/lib/utils";

const stageProgress: Record<string, number> = { downloading: 15, installing: 40, building: 75, restarting: 90, cleaning: 97, completed: 100 };

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

  const [hovered, setHovered] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const notes = data?.notes ?? [];
  const showNotes = available && hovered && !busy;
  // A short grace period lets the pointer cross from the button onto the card.
  const open = () => { if (closeTimer.current !== null) window.clearTimeout(closeTimer.current); closeTimer.current = null; setHovered(true); };
  const close = () => { if (closeTimer.current !== null) window.clearTimeout(closeTimer.current); closeTimer.current = window.setTimeout(() => setHovered(false), 200); };
  useEffect(() => () => { if (closeTimer.current !== null) window.clearTimeout(closeTimer.current); }, []);

  return <div ref={anchor} className="relative shrink-0" onPointerEnter={open} onPointerLeave={close} onFocus={open} onBlur={close}>
    <button type="button" aria-label={label} aria-describedby={showNotes ? "app-update-notes" : undefined} title={available ? undefined : label} disabled={busy || data?.supported === false} onClick={() => void requestAppUpdate(available)} className={cn("grid h-9 w-9 place-items-center rounded-xl text-muted-foreground transition hover:bg-white/[0.06] hover:text-foreground disabled:cursor-default", available && "bg-primary/10 text-primary hover:text-primary", failed && "text-red-400", data?.supported === false && "opacity-35")}>
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
    {showNotes && <UpdateNotes anchor={anchor} notes={notes} more={data?.more ?? 0} changes={data?.changes ?? 0} summary={data?.summary} onPointerEnter={open} onPointerLeave={close} />}
  </div>;
}

/** What's new in the waiting update, shown while the update button is hovered or focused. */
function UpdateNotes({ anchor, notes, more, changes, summary, onPointerEnter, onPointerLeave }: { anchor: RefObject<HTMLElement | null>; notes: Array<{ title: string | null; text: string }>; more: number; changes: number; summary?: string; onPointerEnter: () => void; onPointerLeave: () => void }) {
  const card = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  useLayoutEffect(() => {
    if (!anchor.current || !card.current) return;
    const button = anchor.current.getBoundingClientRect();
    const { width, height } = card.current.getBoundingClientRect();
    const left = Math.min(Math.max(8, button.left - 8), window.innerWidth - width - 8);
    const top = button.top - height - 8 >= 8 ? button.top - height - 8 : button.bottom + 8;
    setStyle({ left, top });
  }, [anchor, notes]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <motion.div ref={card} id="app-update-notes" role="tooltip" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.12 }} style={style} onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave} className="fixed z-[450] w-[min(22rem,calc(100vw-1rem))] rounded-2xl border border-white/10 bg-card/95 p-4 text-sm shadow-2xl backdrop-blur-xl">
      <p className="font-bold">Update ready. Click to install and restart.</p>
      {notes.length > 0 ? (
        <ul className="mt-3 max-h-[50vh] list-disc space-y-2 overflow-y-auto overscroll-contain pl-4 pr-1 text-[13px] leading-5 text-muted-foreground">
          {notes.map((note, index) => <li key={index}>{note.title && <strong className="text-foreground">{note.title}. </strong>}{note.text}</li>)}
        </ul>
      ) : summary ? <p className="mt-2 text-[13px] text-muted-foreground">{summary}</p> : null}
      {more > 0 && <p className="mt-3 text-[13px] font-semibold">Plus {more} more {more === 1 ? "improvement" : "improvements"}.</p>}
      {changes > 1 && <p className="mt-2 text-xs text-muted-foreground">{changes} changes since your version</p>}
    </motion.div>,
    document.body,
  );
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

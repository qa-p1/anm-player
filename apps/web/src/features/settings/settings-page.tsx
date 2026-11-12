import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AlertCircle, Bomb, Check, Download, Folder, FolderPlus, Globe2, HardDrive, Info, LoaderCircle, Music2, Palette, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { pageTransition } from "@/animations/page-motion";
import { CloseAppButton } from "@/components/navigation/close-app-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { Segmented, SelectControl, SettingRow, SettingsGroup, Stepper, Switch } from "@/features/settings/settings-controls";
import { AppUpdateControls } from "@/features/updates/app-update-controls";
import { useSaveSetting, useSettings, type WritableSettings } from "@/hooks/use-settings";
import { queryClient } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { apiGet, apiPost } from "@/services/api-client";
import { getChartRegions, getDatabaseBackupUrl } from "@/services/music-api";
import { invalidateLibrary } from "@/services/music-invalidation";
import { accentValues, applyAccent, useThemeStore, type AccentTheme, type ThemeMode } from "@/stores/theme-store";
import type { AudioFormat, DirectoryEntry, DirectoryListing, StorageSummary, StreamQuality } from "@/types/settings";
import { detectRegion } from "@/utils/region";

type BrowserPurpose = "migration" | "reset";
type SaveState = "idle" | "saving" | "saved" | "error";

const SECTIONS = [
  { id: "playback", label: "Playback", icon: <Music2 /> },
  { id: "home", label: "Home & region", icon: <Globe2 /> },
  { id: "downloads", label: "Downloads", icon: <Download /> },
  { id: "storage", label: "Storage", icon: <HardDrive /> },
  { id: "appearance", label: "Appearance", icon: <Palette /> },
  { id: "about", label: "About", icon: <Info /> },
  { id: "danger", label: "Danger zone", icon: <Bomb /> },
] as const;

const storageKey = ["settings", "storage"] as const;

export function SettingsPage() {
  const { data: settings, error: settingsError, refetch: refetchSettings } = useSettings();
  const saveSetting = useSaveSetting();
  const { data: storage, refetch: refetchStorage } = useQuery({ queryKey: storageKey, queryFn: ({ signal }) => apiGet<StorageSummary>("/settings/storage", { signal }) });
  const { data: regions = [] } = useQuery({ queryKey: ["ytmusic", "regions"], queryFn: ({ signal }) => getChartRegions(signal), staleTime: Infinity });
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [activeSection, setActiveSection] = useState<string>(SECTIONS[0].id);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [browserBusy, setBrowserBusy] = useState(false);
  const [newFolder, setNewFolder] = useState("");
  const [selected, setSelected] = useState<DirectoryEntry | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [resetting, setResetting] = useState(false);
  const [browserPurpose, setBrowserPurpose] = useState<BrowserPurpose>("migration");
  const [syncingLibrary, setSyncingLibrary] = useState(false);
  const [clearing, setClearing] = useState<string | null>(null);
  const setMode = useThemeStore((state) => state.setMode);

  useEffect(() => {
    const handleStorageReady = () => void refetchStorage();
    window.addEventListener("aura-storage-ready", handleStorageReady);
    return () => window.removeEventListener("aura-storage-ready", handleStorageReady);
  }, [refetchStorage]);

  useEffect(() => {
    if (saveState !== "saved") return;
    const timer = window.setTimeout(() => setSaveState("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [saveState]);

  // Highlight the section currently on screen in the section list.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setActiveSection(visible.target.id);
    }, { rootMargin: "-10% 0px -70% 0px" });
    for (const section of SECTIONS) {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [settings]);

  function save(changes: WritableSettings) {
    setSaveState("saving");
    saveSetting.mutate(changes, {
      onSuccess: () => setSaveState("saved"),
      onError: (error) => {
        setSaveState("error");
        toast(error instanceof Error ? error.message : "Could not save that setting", "error");
      },
    });
  }

  async function browse(parentId?: string | null) {
    setBrowserBusy(true);
    try {
      const suffix = parentId ? `?parent_id=${encodeURIComponent(parentId)}` : "";
      setListing(await apiGet<DirectoryListing>(`/settings/storage/directories${suffix}`));
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not browse folders", "error");
    } finally {
      setBrowserBusy(false);
    }
  }

  async function openBrowser(purpose: BrowserPurpose = "migration") {
    setBrowserPurpose(purpose);
    setBrowserOpen(true);
    setSelected(null);
    setResetConfirmation("");
    await browse();
  }

  async function createFolder() {
    if (!listing?.current?.directory_id || !newFolder.trim()) return;
    setBrowserBusy(true);
    try {
      const created = await apiPost<DirectoryEntry, { parent_id: string; name: string }>("/settings/storage/directories", {
        parent_id: listing.current.directory_id,
        name: newFolder.trim(),
      });
      setNewFolder("");
      await browse(created.directory_id);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not create folder", "error");
      setBrowserBusy(false);
    }
  }

  function chooseCurrent() {
    if (!listing?.current?.empty) return;
    setSelected(listing.current);
    setBrowserOpen(false);
    if (browserPurpose === "reset") setResetConfirmOpen(true);
    else setConfirmOpen(true);
  }

  async function migrate() {
    if (!selected?.directory_id) return;
    try {
      await apiPost<{ operation_id: string }, { directory_id: string }>("/settings/storage/migrations", { directory_id: selected.directory_id });
      setConfirmOpen(false);
      window.dispatchEvent(new Event("aura-storage-migration-started"));
      toast("Moving your data", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not start the move", "error");
    }
  }

  async function resetAnmPlayer() {
    if (!selected?.directory_id || resetConfirmation !== "RESET ANM PLAYER") return;
    setResetting(true);
    try {
      await apiPost<{ operation_id: string }, { directory_id: string; confirmation: string }>("/settings/storage/reset", {
        directory_id: selected.directory_id,
        confirmation: resetConfirmation,
      });
      setResetConfirmOpen(false);
      window.dispatchEvent(new CustomEvent("aura-storage-migration-started", { detail: { operation_kind: "reset" } }));
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not start fresh", "error");
      setResetting(false);
    }
  }

  async function clearCache(category: "artwork" | "streams" | "lyrics" | "all") {
    setClearing(category);
    try {
      const result = await apiPost<{ files_removed: number; bytes_removed: number }, { category: typeof category }>("/settings/cache/clear", { category });
      toast(`Freed ${formatBytes(result.bytes_removed)}`, "success");
      await refetchStorage();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not clear the cache", "error");
    } finally {
      setClearing(null);
    }
  }

  async function syncLibrary() {
    setSyncingLibrary(true);
    try {
      const result = await apiPost<{ added: number; updated: number; removed: number; reconciled: number; errors: number }, undefined>("/library/sync");
      await invalidateLibrary(queryClient);
      const changed = result.added + result.updated + result.removed + result.reconciled;
      toast(
        result.errors
          ? `Library synced with ${result.errors} file error${result.errors === 1 ? "" : "s"}`
          : changed ? `Library synced: ${changed} change${changed === 1 ? "" : "s"}` : "Library is already in sync",
        result.errors ? "error" : "success",
      );
      await refetchStorage();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not sync the library", "error");
    } finally {
      setSyncingLibrary(false);
    }
  }

  const detected = useMemo(() => detectRegion(), []);
  const regionOptions = useMemo(() => {
    const names = new Map(regions.map((region) => [region.code, region.name]));
    const automatic = detected && names.has(detected) ? names.get(detected) : "United States";
    return [{ value: "auto", label: `Automatic (${automatic})` }, ...regions.map((region) => ({ value: region.code, label: region.name }))];
  }, [detected, regions]);

  const categories = storage?.categories;
  const cacheTotal = categories ? categories.artwork + categories.lyrics + categories.streams : 0;
  const usageParts = categories ? [
    { label: "Music", value: categories.music + categories.downloads, color: "bg-primary" },
    { label: "Caches", value: cacheTotal, color: "bg-accent" },
    { label: "Library", value: categories.database + categories.config + categories.thumbnails + categories.logs + categories.other, color: "bg-amber-400" },
  ] : [];
  // The bar shows what the used space is made of; free space is stated beside it.
  const capacity = Math.max(usageParts.reduce((total, part) => total + part.value, 0), 1);

  if (settingsError && !settings) {
    return (
      <div className="grid min-h-[50vh] place-content-center gap-3 text-center text-muted-foreground">
        <p role="alert">{settingsError.message}</p>
        <Button variant="glass" onClick={() => void refetchSettings()}>Retry</Button>
      </div>
    );
  }

  return (
    <motion.div {...pageTransition} className="mx-auto max-w-6xl space-y-6 px-3 py-4 sm:px-6 lg:px-8 lg:py-7">
      <header className="flex items-end justify-between gap-4">
        <h1 className="text-4xl font-black tracking-tight sm:text-6xl">Settings</h1>
        <SaveIndicator state={saveState} />
      </header>

      {storage?.migration.cleanup_warning && <Notice tone="warning">{storage.migration.cleanup_warning}</Notice>}
      {storage?.migration.error && <Notice tone="error">{storage.migration.error}</Notice>}

      <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
        <nav aria-label="Settings sections" className="no-scrollbar -mx-3 flex gap-1.5 overflow-x-auto px-3 lg:sticky lg:top-6 lg:mx-0 lg:flex-col lg:self-start lg:overflow-visible lg:px-0">
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(section.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              aria-current={activeSection === section.id ? "true" : undefined}
              className={cn(
                "flex h-9 shrink-0 items-center gap-2.5 rounded-xl px-3 text-sm font-medium transition [&>svg]:h-4 [&>svg]:w-4",
                activeSection === section.id ? "bg-white/[0.08] text-foreground" : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground",
                section.id === "danger" && "text-red-400/80 hover:text-red-300",
              )}
            >
              {section.icon}{section.label}
            </a>
          ))}
        </nav>

        <div className="min-w-0 space-y-8">
          <SettingsGroup id="playback" title="Playback" icon={<Music2 />}>
            <SettingRow label="Streaming quality" description="Higher quality uses more data while streaming." control={
              <Segmented label="Streaming quality" value={settings?.stream_quality ?? "high"} onChange={(value: StreamQuality) => save({ stream_quality: value })} options={[{ value: "low", label: "Low" }, { value: "auto", label: "Auto" }, { value: "high", label: "High" }]} />
            } />
            <SettingRow label="Keep streamed songs for" description="Recently streamed songs replay instantly without downloading again." control={
              <SelectControl label="Keep streamed songs for" value={String(settings?.stream_cache_retention_days ?? 30)} onChange={(value) => save({ stream_cache_retention_days: Number(value) })} options={[7, 14, 30, 60, 90, 180, 365].map((days) => ({ value: String(days), label: days === 365 ? "1 year" : `${days} days` }))} />
            } />
          </SettingsGroup>

          <SettingsGroup id="home" title="Home & region" icon={<Globe2 />}>
            <SettingRow label="Region" description="Picks the country for Home's regional chart and trending albums. Automatic uses your computer's time zone." control={
              <SelectControl label="Region" value={settings?.home_region ?? "auto"} onChange={(value) => save({ home_region: value })} options={regionOptions} />
            } />
          </SettingsGroup>

          <SettingsGroup id="downloads" title="Downloads" icon={<Download />}>
            <SettingRow label="Audio format" control={
              <Segmented label="Audio format" value={settings?.download_audio_format ?? "mp3"} onChange={(value: AudioFormat) => save({ download_audio_format: value })} options={(["mp3", "m4a", "opus", "flac", "ogg"] as const).map((format) => ({ value: format, label: format.toUpperCase() }))} />
            } />
            <SettingRow label="Songs at once" description="How many songs download at the same time." control={
              <Stepper label="Songs at once" value={settings?.max_concurrent_downloads ?? 8} min={1} max={8} onChange={(value) => save({ max_concurrent_downloads: value })} />
            } />
            <SettingRow label="Songs at once per album" control={
              <Stepper label="Songs at once per album" value={settings?.album_download_max_parallel ?? 5} min={1} max={8} onChange={(value) => save({ album_download_max_parallel: value })} />
            } />
            <SettingRow label="Save artwork" description="Keep cover art with downloaded songs." control={<Switch label="Save artwork" checked={settings?.download_artwork ?? true} onChange={(value) => save({ download_artwork: value })} />} />
            <SettingRow label="Fetch lyrics" description="Get lyrics automatically after a song downloads." control={<Switch label="Fetch lyrics" checked={settings?.auto_fetch_lyrics ?? true} onChange={(value) => save({ auto_fetch_lyrics: value })} />} />
            <SettingRow label="Improve song details" description="Look up richer titles, albums and years after downloading." control={<Switch label="Improve song details" checked={settings?.auto_enrich_downloads ?? true} onChange={(value) => save({ auto_enrich_downloads: value })} />} />
            <SettingRow label="Replace existing files" description="Download again over a song that's already saved." control={<Switch label="Replace existing files" checked={settings?.download_overwrite_existing ?? false} onChange={(value) => save({ download_overwrite_existing: value })} />} />
          </SettingsGroup>

          <SettingsGroup id="storage" title="Storage" icon={<HardDrive />}>
            <div className="space-y-3 px-4 py-4 sm:px-5">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-semibold">{storage ? `${formatBytes(storage.used_bytes)} used` : "Calculating…"}</p>
                {storage && <p className="text-xs text-muted-foreground">{formatBytes(storage.free_bytes)} free</p>}
              </div>
              <div className="flex h-2.5 overflow-hidden rounded-full bg-white/10" role="img" aria-label="Storage use by type">
                {usageParts.map((part) => <div key={part.label} className={part.color} style={{ width: `${(part.value / capacity) * 100}%` }} />)}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {usageParts.map((part) => <span key={part.label} className="inline-flex items-center gap-1.5"><span className={cn("h-2 w-2 rounded-full", part.color)} />{part.label} {formatBytes(part.value)}</span>)}
              </div>
              <p className="break-all font-mono text-xs text-muted-foreground">{storage?.data_root ?? ""}</p>
            </div>
            <SettingRow label="Library folder" description="Move your music and library to another folder or drive." control={<Button variant="glass" size="sm" onClick={() => void openBrowser("migration")}><Folder className="h-4 w-4" />Change</Button>} />
            <SettingRow label="Backup" description="Save a copy of your playlists, favorites and history. Music files aren't included." control={<Button asChild variant="glass" size="sm"><a href={getDatabaseBackupUrl()} download><Download className="h-4 w-4" />Download</a></Button>} />
            <SettingRow label="Scan for new music on start" description="Pick up songs added to the music folder outside the app." control={<Switch label="Scan for new music on start" checked={settings?.startup_scan_enabled ?? true} onChange={(value) => save({ startup_scan_enabled: value })} />} />
            <SettingRow label="Sync library now" control={<Button variant="glass" size="sm" disabled={syncingLibrary} onClick={() => void syncLibrary()}><RefreshCw className={cn("h-4 w-4", syncingLibrary && "animate-spin")} />{syncingLibrary ? "Syncing…" : "Sync"}</Button>} />
            {(["artwork", "streams", "lyrics"] as const).map((category) => (
              <SettingRow
                key={category}
                label={{ artwork: "Artwork cache", streams: "Streamed songs", lyrics: "Lyrics cache" }[category]}
                description={formatBytes(categories?.[category] ?? 0)}
                control={<Button variant="ghost" size="sm" disabled={clearing !== null || !categories?.[category]} onClick={() => void clearCache(category)}>{clearing === category ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Clear</Button>}
              />
            ))}
            <SettingRow label="Artwork cache limit" control={
              <SelectControl label="Artwork cache limit" value={String(settings?.artwork_cache_limit_mb ?? 512)} onChange={(value) => save({ artwork_cache_limit_mb: Number(value) })} options={[128, 256, 512, 1024, 2048].map((size) => ({ value: String(size), label: size >= 1024 ? `${size / 1024} GB` : `${size} MB` }))} />
            } />
          </SettingsGroup>

          <SettingsGroup id="appearance" title="Appearance" icon={<Palette />}>
            <SettingRow label="Theme" control={
              <Segmented label="Theme" value={settings?.theme_mode ?? "dark"} onChange={(value: ThemeMode) => { setMode(value); save({ theme_mode: value }); }} options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }, { value: "system", label: "System" }]} />
            } />
            <SettingRow label="Accent colour" control={
              <div role="radiogroup" aria-label="Accent colour" className="flex gap-2.5">
                {(Object.keys(accentValues) as AccentTheme[]).map((accent) => (
                  <button key={accent} type="button" role="radio" aria-checked={settings?.accent_theme === accent} aria-label={accent[0].toUpperCase() + accent.slice(1)} title={accent[0].toUpperCase() + accent.slice(1)} onClick={() => { applyAccent(accent); save({ accent_theme: accent }); }} className={cn("grid h-8 w-8 place-items-center rounded-full ring-offset-2 ring-offset-background transition hover:scale-110", settings?.accent_theme === accent && "ring-2 ring-foreground")} style={{ backgroundColor: `hsl(${accentValues[accent]})` }}>
                    {settings?.accent_theme === accent && <Check className="h-4 w-4 text-white" />}
                  </button>
                ))}
              </div>
            } />
          </SettingsGroup>

          <SettingsGroup id="about" title="About" icon={<Info />}>
            <SettingRow label="ANM Player" description={`Version ${settings?.version ?? "…"} · ${(settings?.song_count ?? 0).toLocaleString()} songs in your library`} control={<div className="flex items-center gap-1"><AppUpdateControls /><CloseAppButton compact /></div>} />
          </SettingsGroup>

          <SettingsGroup id="danger" title="Danger zone" icon={<Bomb />} tone="danger">
            <SettingRow
              label="Erase everything and start fresh"
              description="Deletes the library database, downloaded music, artwork, lyrics, caches, playlists, favorites, history and settings. You'll pick a new empty folder first."
              control={<Button variant="outline" size="sm" className="border-red-500/50 text-red-300 hover:bg-red-500/15 hover:text-red-200" onClick={() => void openBrowser("reset")}><Bomb className="h-4 w-4" />Erase</Button>}
            />
          </SettingsGroup>
        </div>
      </div>

      <Dialog open={browserOpen} onOpenChange={setBrowserOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Choose an empty folder</DialogTitle>
            <DialogDescription>{browserPurpose === "reset" ? "This becomes a brand-new library folder. It must be empty and separate from the current one." : "Your music and library move into the exact empty folder you pick."}</DialogDescription>
          </DialogHeader>
          <div className="rounded-xl bg-muted/50 p-3 font-mono text-xs">{listing?.current?.display_path ?? "Drives"}</div>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {listing?.parent?.directory_id && <FolderRow entry={{ ...listing.parent, name: ".." }} onOpen={() => void browse(listing.parent?.directory_id)} />}
            {listing?.directories.map((entry) => <FolderRow key={entry.display_path} entry={entry} onOpen={() => void browse(entry.directory_id)} />)}
            {!browserBusy && listing?.directories.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No folders here.</p>}
          </div>
          {listing?.current && <div className="flex gap-2"><Input value={newFolder} onChange={(event) => setNewFolder(event.target.value)} placeholder="New folder name" aria-label="New folder name" /><Button variant="glass" disabled={!newFolder.trim() || browserBusy} onClick={() => void createFolder()}><FolderPlus className="h-4 w-4" />Create</Button></div>}
          <DialogFooter><Button variant="ghost" onClick={() => setBrowserOpen(false)}>Cancel</Button><Button disabled={!listing?.current?.empty || browserBusy} onClick={chooseCurrent}>{browserPurpose === "reset" ? "Use for fresh start" : "Use this folder"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Move your library?</DialogTitle><DialogDescription>Playback and downloads pause until the move is checked.</DialogDescription></DialogHeader>
          <div className="space-y-3 rounded-xl bg-muted/40 p-4 text-sm"><p><strong>From:</strong> <span className="break-all">{storage?.data_root}</span></p><p><strong>To:</strong> <span className="break-all">{selected?.display_path}</span></p><p><strong>Size:</strong> {formatBytes(storage?.used_bytes ?? 0)}</p><p><strong>How:</strong> {selected?.same_device ? "Moved in place on the same drive" : "Copied, verified, then switched"}</p></div>
          <DialogFooter><Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button><Button onClick={() => void migrate()}>Move</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resetConfirmOpen} onOpenChange={(open) => { if (!resetting) setResetConfirmOpen(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Erase all ANM Player data?</DialogTitle>
            <DialogDescription>This can't be undone. The new empty folder is checked before anything is deleted.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm">
              <p><strong>Delete:</strong> <span className="break-all">{storage?.data_root}</span></p>
              <p><strong>New folder:</strong> <span className="break-all">{selected?.display_path}</span></p>
              <p><strong>Size:</strong> {formatBytes(storage?.used_bytes ?? 0)}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reset-anm-player-confirmation">Type <strong>RESET ANM PLAYER</strong> to continue</Label>
              <Input id="reset-anm-player-confirmation" autoComplete="off" value={resetConfirmation} onChange={(event) => setResetConfirmation(event.target.value)} placeholder="RESET ANM PLAYER" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" disabled={resetting} onClick={() => setResetConfirmOpen(false)}>Cancel</Button>
            <Button variant="outline" className="border-red-500/50 text-red-300 hover:bg-red-500/15 hover:text-red-200" disabled={resetConfirmation !== "RESET ANM PLAYER" || resetting} onClick={() => void resetAnmPlayer()}>
              <Bomb className="h-4 w-4" />{resetting ? "Starting…" : "Erase everything"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return <span aria-live="polite" className="sr-only" />;
  return (
    <span role="status" aria-live="polite" className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold", state === "error" ? "border-red-400/30 text-red-400" : "border-white/10 text-muted-foreground")}>
      {state === "saving" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : state === "saved" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <AlertCircle className="h-3.5 w-3.5" />}
      {state === "saving" ? "Saving" : state === "saved" ? "Saved" : "Not saved"}
    </span>
  );
}

function FolderRow({ entry, onOpen }: { entry: DirectoryEntry; onOpen: () => void }) {
  return <button type="button" disabled={entry.disabled || !entry.directory_id} onClick={onOpen} className="flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-muted disabled:opacity-40"><Folder className="h-4 w-4 text-primary" /><span className="min-w-0 flex-1 truncate">{entry.name}</span>{entry.empty && <span className="text-xs text-emerald-400">Empty</span>}</button>;
}

function Notice({ tone, children }: { tone: "warning" | "error"; children: ReactNode }) {
  return <div role="alert" className={cn("rounded-2xl border p-4 text-sm", tone === "error" ? "border-red-500/40 bg-red-500/10 text-red-300" : "border-amber-500/40 bg-amber-500/10 text-amber-200")}>{children}</div>;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[index]}`;
}

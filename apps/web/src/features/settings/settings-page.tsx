import { motion } from "framer-motion";
import { Bomb, Database, Download, Folder, FolderPlus, HardDrive, Info, Palette, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import { pageTransition } from "@/animations/page-motion";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { apiGet, apiPatch, apiPost } from "@/services/api-client";
import { applyAccent, accentValues, useThemeStore, type AccentTheme, type ThemeMode } from "@/stores/theme-store";

type AudioFormat = "mp3" | "m4a" | "flac" | "opus" | "ogg";
type StreamQuality = "low" | "auto" | "high";
type BrowserPurpose = "migration" | "reset";

interface SettingsSummary {
  startup_scan_enabled: boolean;
  download_audio_format: AudioFormat;
  download_overwrite_existing: boolean;
  max_concurrent_downloads: number;
  album_download_max_parallel: number;
  auto_enrich_downloads: boolean;
  download_artwork: boolean;
  auto_fetch_lyrics: boolean;
  stream_quality: StreamQuality;
  stream_cache_retention_days: number;
  artwork_cache_limit_mb: number;
  theme_mode: ThemeMode;
  accent_theme: AccentTheme;
  version: string;
  environment: string;
  database_backend: "SQLite";
  song_count: number;
}

interface MigrationState {
  active: boolean;
  phase: string;
  error?: string | null;
  cleanup_warning?: string | null;
}

interface StorageSummary {
  data_root: string;
  used_bytes: number;
  free_bytes: number;
  total_bytes: number;
  categories: Record<"database" | "music" | "downloads" | "artwork" | "lyrics" | "streams" | "config" | "thumbnails" | "logs" | "other", number>;
  migration: MigrationState;
}

interface DirectoryEntry {
  directory_id: string | null;
  name: string;
  display_path: string;
  disabled: boolean;
  empty: boolean;
  same_device: boolean | null;
  reason: string | null;
}

interface DirectoryListing {
  current: DirectoryEntry | null;
  parent: DirectoryEntry | null;
  directories: DirectoryEntry[];
}

export function SettingsPage() {
  const [settings, setSettings] = useState<SettingsSummary | null>(null);
  const [storage, setStorage] = useState<StorageSummary | null>(null);
  const [saving, setSaving] = useState(false);
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
  const { setMode } = useThemeStore();

  async function refresh() {
    const [nextSettings, nextStorage] = await Promise.all([
      apiGet<SettingsSummary>("/settings"),
      apiGet<StorageSummary>("/settings/storage"),
    ]);
    setSettings(nextSettings);
    setStorage(nextStorage);
  }

  useEffect(() => {
    void refresh().catch(() => toast("Could not load settings", "error"));
    const handleStorageReady = () => void refresh().catch(() => undefined);
    window.addEventListener("aura-storage-ready", handleStorageReady);
    return () => window.removeEventListener("aura-storage-ready", handleStorageReady);
  }, []);

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      const writableSettings = {
        startup_scan_enabled: settings.startup_scan_enabled,
        download_audio_format: settings.download_audio_format,
        download_overwrite_existing: settings.download_overwrite_existing,
        max_concurrent_downloads: settings.max_concurrent_downloads,
        album_download_max_parallel: settings.album_download_max_parallel,
        auto_enrich_downloads: settings.auto_enrich_downloads,
        download_artwork: settings.download_artwork,
        auto_fetch_lyrics: settings.auto_fetch_lyrics,
        stream_quality: settings.stream_quality,
        stream_cache_retention_days: settings.stream_cache_retention_days,
        artwork_cache_limit_mb: settings.artwork_cache_limit_mb,
        theme_mode: settings.theme_mode,
        accent_theme: settings.accent_theme,
      };
      const updated = await apiPatch<SettingsSummary, typeof writableSettings>("/settings", writableSettings);
      setSettings(updated);
      setMode(updated.theme_mode);
      applyAccent(updated.accent_theme);
      toast("Settings saved", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save settings", "error");
    } finally {
      setSaving(false);
    }
  }

  function update<K extends keyof SettingsSummary>(key: K, value: SettingsSummary[K]) {
    setSettings((current) => current ? { ...current, [key]: value } : current);
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
      toast("Storage migration started", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not start migration", "error");
    }
  }

  async function resetAnmPlayer() {
    if (!selected?.directory_id || resetConfirmation !== "RESET ANM PLAYER") return;
    setResetting(true);
    try {
      await apiPost<
        { operation_id: string },
        { directory_id: string; confirmation: string }
      >("/settings/storage/reset", {
        directory_id: selected.directory_id,
        confirmation: resetConfirmation,
      });
      setResetConfirmOpen(false);
      window.dispatchEvent(new CustomEvent("aura-storage-migration-started", {
        detail: { operation_kind: "reset" },
      }));
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not start fresh", "error");
      setResetting(false);
    }
  }

  async function clearCache(category: "artwork" | "streams" | "lyrics" | "all") {
    try {
      const result = await apiPost<{ files_removed: number; bytes_removed: number }, { category: typeof category }>("/settings/cache/clear", { category });
      toast(`Removed ${result.files_removed.toLocaleString()} cached files`, "success");
      await refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not clear cache", "error");
    }
  }

  async function syncLibrary() {
    setSyncingLibrary(true);
    try {
      const result = await apiPost<{
        added: number;
        updated: number;
        removed: number;
        reconciled: number;
        errors: number;
      }, undefined>("/library/sync");
      const changed = result.added + result.updated + result.removed + result.reconciled;
      toast(
        result.errors
          ? `Library synced with ${result.errors} file error${result.errors === 1 ? "" : "s"}`
          : changed
            ? `Library synced: ${changed} change${changed === 1 ? "" : "s"}`
            : "Library is already in sync",
        result.errors ? "error" : "success",
      );
      await refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not sync the library", "error");
    } finally {
      setSyncingLibrary(false);
    }
  }

  const cacheTotal = useMemo(() => storage ? storage.categories.artwork + storage.categories.lyrics + storage.categories.streams : 0, [storage]);

  return (
    <motion.div {...pageTransition} className="mx-auto max-w-5xl space-y-8 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
      <section><p className="mb-2 text-sm font-semibold text-primary">Settings</p><h1 className="text-4xl font-black tracking-normal sm:text-5xl">ANM Player, your way</h1></section>

      {storage?.migration.cleanup_warning && <Notice tone="warning">{storage.migration.cleanup_warning}</Notice>}
      {storage?.migration.error && <Notice tone="error">{storage.migration.error}</Notice>}

      <SettingsSection icon={<HardDrive />} title="Storage">
        <div className="rounded-2xl bg-muted/40 p-4">
          <p className="text-sm font-medium">The directory where your data should be stored</p>
          <p className="mt-2 break-all font-mono text-sm">{storage?.data_root ?? "Loading…"}</p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: storage ? `${Math.min(100, storage.used_bytes * 100 / Math.max(storage.used_bytes + storage.free_bytes, 1))}%` : "0%" }} /></div>
          <p className="mt-2 text-sm text-muted-foreground">{storage ? `${formatBytes(storage.used_bytes)} used · ${formatBytes(storage.free_bytes)} free` : "Calculating usage…"}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Usage label="Music" value={storage?.categories.music} />
          <Usage label="Database" value={storage?.categories.database} />
          <Usage label="Downloads" value={storage?.categories.downloads} />
        </div>
        <Button onClick={() => void openBrowser("migration")}><Folder className="h-4 w-4" />Change Data Location</Button>
      </SettingsSection>

      <SettingsSection icon={<RefreshCw />} title="Library">
        <Toggle label="Scan library on startup" description="Scan the managed music folder in the background whenever ANM Player starts." checked={settings?.startup_scan_enabled ?? true} onChange={(value) => update("startup_scan_enabled", value)} />
        <Button variant="glass" disabled={syncingLibrary} onClick={() => void syncLibrary()}>
          <RefreshCw className={`h-4 w-4 ${syncingLibrary ? "animate-spin" : ""}`} />
          {syncingLibrary ? "Syncing library…" : "Sync library now"}
        </Button>
      </SettingsSection>

      <SettingsSection icon={<Download />} title="Downloads and metadata">
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberSetting label="Album download parallelism" value={settings?.album_download_max_parallel ?? 5} min={1} max={8} onChange={(value) => update("album_download_max_parallel", value)} />
          <NumberSetting label="Maximum concurrent downloads" value={settings?.max_concurrent_downloads ?? 8} min={1} max={8} onChange={(value) => update("max_concurrent_downloads", value)} />
          <SelectSetting label="Downloaded audio format" value={settings?.download_audio_format ?? "mp3"} onChange={(value) => update("download_audio_format", value as AudioFormat)} options={["mp3", "m4a", "flac", "opus", "ogg"]} />
        </div>
        <Toggle label="Overwrite existing downloads" description="Use the selected format and replace a matching destination file." checked={settings?.download_overwrite_existing ?? false} onChange={(value) => update("download_overwrite_existing", value)} />
        <Toggle label="Auto-enrich downloads" description="Fetch and apply richer metadata after a download completes." checked={settings?.auto_enrich_downloads ?? true} onChange={(value) => update("auto_enrich_downloads", value)} />
        <Toggle label="Download artwork" description="Cache provider artwork locally while retaining its remote source URL." checked={settings?.download_artwork ?? true} onChange={(value) => update("download_artwork", value)} />
        <Toggle label="Automatically fetch lyrics after download" description="Manual lyrics fetching remains available when this is off." checked={settings?.auto_fetch_lyrics ?? true} onChange={(value) => update("auto_fetch_lyrics", value)} />
      </SettingsSection>

      <SettingsSection icon={<Database />} title="Playback and cache">
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectSetting label="Streaming quality" value={settings?.stream_quality ?? "high"} onChange={(value) => update("stream_quality", value as StreamQuality)} options={["low", "auto", "high"]} />
          <NumberSetting label="Stream-cache retention (days)" value={settings?.stream_cache_retention_days ?? 30} min={1} max={365} onChange={(value) => update("stream_cache_retention_days", value)} />
          <NumberSetting label="Artwork cache limit (MiB)" value={settings?.artwork_cache_limit_mb ?? 512} min={64} max={2048} onChange={(value) => update("artwork_cache_limit_mb", value)} />
        </div>
        <p className="text-sm text-muted-foreground">Cache usage: {formatBytes(cacheTotal)} · artwork {formatBytes(storage?.categories.artwork ?? 0)}, lyrics {formatBytes(storage?.categories.lyrics ?? 0)}, streams {formatBytes(storage?.categories.streams ?? 0)}</p>
        <div className="flex flex-wrap gap-2">
          {(["artwork", "lyrics", "streams", "all"] as const).map((category) => <Button key={category} variant="glass" onClick={() => void clearCache(category)}><Trash2 className="h-4 w-4" />Clear {category}</Button>)}
        </div>
      </SettingsSection>

      <SettingsSection icon={<Palette />} title="Appearance">
        <SelectSetting label="Theme" value={settings?.theme_mode ?? "dark"} onChange={(value) => { update("theme_mode", value as ThemeMode); setMode(value as ThemeMode); }} options={["dark", "light", "system"]} />
        <fieldset><legend className="text-sm font-medium">Accent</legend><div className="mt-2 flex gap-3">{(Object.keys(accentValues) as AccentTheme[]).map((accent) => <button type="button" key={accent} aria-label={`Use ${accent} accent`} onClick={() => { update("accent_theme", accent); applyAccent(accent); }} className={`h-10 w-10 rounded-full border-2 transition ${settings?.accent_theme === accent ? "scale-110 border-foreground" : "border-transparent"}`} style={{ backgroundColor: `hsl(${accentValues[accent]})` }} />)}</div></fieldset>
      </SettingsSection>

      <Button size="lg" disabled={!settings || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save settings"}</Button>

      <SettingsSection icon={<Info />} title="About">
        <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          <p><strong className="text-foreground">Version:</strong> {settings?.version ?? "…"}</p>
          <p><strong className="text-foreground">Database:</strong> {settings?.database_backend ?? "SQLite"}</p>
          <p><strong className="text-foreground">Songs:</strong> {settings?.song_count.toLocaleString() ?? "…"}</p>
          <p><strong className="text-foreground">Environment:</strong> {settings?.environment ?? "…"}</p>
        </div>
      </SettingsSection>

      <section className="space-y-5 rounded-3xl border border-red-500/35 bg-red-500/[0.07] p-6">
        <div className="flex items-center gap-3 text-red-400"><Bomb className="h-6 w-6" /><h2 className="text-xl font-bold">Danger zone</h2></div>
        <div>
          <p className="font-semibold">Start ANM Player completely fresh</p>
          <p className="mt-1 text-sm text-muted-foreground">Deletes the current ANM Player database, downloaded music, artwork, lyrics, caches, playlists, favorites, history, and settings. You will choose a new empty data folder before anything is removed.</p>
        </div>
        <Button
          variant="outline"
          className="border-red-500/50 text-red-300 hover:bg-red-500/15 hover:text-red-200"
          onClick={() => void openBrowser("reset")}
        >
          <Bomb className="h-4 w-4" />Erase all ANM Player data and start fresh
        </Button>
      </section>

      <Dialog open={browserOpen} onOpenChange={setBrowserOpen}>
        <DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Choose an empty server folder</DialogTitle><DialogDescription>{browserPurpose === "reset" ? "This will become a completely new ANM Player data root. It must be empty and cannot overlap the current location." : "ANM Player can see directories mounted on the API host. Only the exact empty folder you choose becomes the data root."}</DialogDescription></DialogHeader>
          <div className="rounded-xl bg-muted/50 p-3 font-mono text-xs">{listing?.current?.display_path ?? "Filesystem roots"}</div>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {listing?.parent?.directory_id && <FolderRow entry={{ ...listing.parent, name: ".." }} onOpen={() => void browse(listing.parent?.directory_id)} />}
            {listing?.directories.map((entry) => <FolderRow key={entry.display_path} entry={entry} onOpen={() => void browse(entry.directory_id)} />)}
            {!browserBusy && listing?.directories.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">This folder has no child directories.</p>}
          </div>
          {listing?.current && <div className="flex gap-2"><Input value={newFolder} onChange={(event) => setNewFolder(event.target.value)} placeholder="New folder name" /><Button variant="glass" disabled={!newFolder.trim() || browserBusy} onClick={() => void createFolder()}><FolderPlus className="h-4 w-4" />Create</Button></div>}
          <DialogFooter><Button variant="ghost" onClick={() => setBrowserOpen(false)}>Cancel</Button><Button disabled={!listing?.current?.empty || browserBusy} onClick={chooseCurrent}>{browserPurpose === "reset" ? "Use for fresh start" : "Select this empty folder"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent><DialogHeader><DialogTitle>Move ANM Player data?</DialogTitle><DialogDescription>This operation pauses playback and downloads until the managed root is verified.</DialogDescription></DialogHeader>
          <div className="space-y-3 rounded-xl bg-muted/40 p-4 text-sm"><p><strong>Source:</strong> <span className="break-all">{storage?.data_root}</span></p><p><strong>Target:</strong> <span className="break-all">{selected?.display_path}</span></p><p><strong>Data:</strong> {formatBytes(storage?.used_bytes ?? 0)}</p><p><strong>Method:</strong> {selected?.same_device ? "Same-drive atomic move" : "Copy, hash, verify, then switch"}</p></div>
          <DialogFooter><Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button><Button onClick={() => void migrate()}>Move and verify</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resetConfirmOpen} onOpenChange={(open) => { if (!resetting) setResetConfirmOpen(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Erase all ANM Player data?</DialogTitle>
            <DialogDescription>This cannot be undone. ANM Player will verify the new empty location before deleting all ANM Player-managed data from the current location.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm">
              <p><strong>Delete:</strong> <span className="break-all">{storage?.data_root}</span></p>
              <p><strong>Fresh location:</strong> <span className="break-all">{selected?.display_path}</span></p>
              <p><strong>Managed data:</strong> {formatBytes(storage?.used_bytes ?? 0)}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reset-anm-player-confirmation">Type <strong>RESET ANM PLAYER</strong> to continue</Label>
              <Input
                id="reset-anm-player-confirmation"
                autoComplete="off"
                value={resetConfirmation}
                onChange={(event) => setResetConfirmation(event.target.value)}
                placeholder="RESET ANM PLAYER"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" disabled={resetting} onClick={() => setResetConfirmOpen(false)}>Cancel</Button>
            <Button
              variant="outline"
              className="border-red-500/50 text-red-300 hover:bg-red-500/15 hover:text-red-200"
              disabled={resetConfirmation !== "RESET ANM PLAYER" || resetting}
              onClick={() => void resetAnmPlayer()}
            >
              <Bomb className="h-4 w-4" />{resetting ? "Starting…" : "Erase everything"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

function SettingsSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return <section className="glass-panel space-y-5 rounded-3xl p-6"><div className="flex items-center gap-3 text-primary">{icon}<h2 className="text-xl font-bold text-foreground">{title}</h2></div>{children}</section>;
}

function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const id = useId();
  return <div className="flex items-center justify-between gap-4 rounded-2xl bg-muted/30 p-4"><span><Label htmlFor={id} className="font-semibold">{label}</Label><span className="mt-1 block text-sm text-muted-foreground">{description}</span></span><input id={id} className="h-5 w-5 accent-[hsl(var(--primary))]" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></div>;
}

function NumberSetting({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  const id = useId();
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><Input id={id} type="number" value={value} min={min} max={max} onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value))))} /></div>;
}

function SelectSetting({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  const id = useId();
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><select id={id} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{option[0].toUpperCase() + option.slice(1)}</option>)}</select></div>;
}

function Usage({ label, value = 0 }: { label: string; value?: number }) { return <div className="rounded-2xl bg-muted/30 p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{formatBytes(value)}</p></div>; }

function FolderRow({ entry, onOpen }: { entry: DirectoryEntry; onOpen: () => void }) { return <button disabled={entry.disabled || !entry.directory_id} onClick={onOpen} className="flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-muted disabled:opacity-40"><Folder className="h-4 w-4 text-primary" /><span className="min-w-0 flex-1 truncate">{entry.name}</span>{entry.empty && <span className="text-xs text-emerald-400">Empty</span>}</button>; }

function Notice({ tone, children }: { tone: "warning" | "error"; children: React.ReactNode }) { return <div className={`rounded-2xl border p-4 text-sm ${tone === "error" ? "border-red-500/40 bg-red-500/10 text-red-300" : "border-amber-500/40 bg-amber-500/10 text-amber-200"}`}>{children}</div>; }

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let size = value / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[index]}`;
}

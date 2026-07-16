import { motion } from "framer-motion";
import { Database, Download, Folder, FolderPlus, HardDrive, Info, Palette, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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

  async function save(next: Partial<SettingsSummary> = {}) {
    if (!settings) return;
    setSaving(true);
    try {
      const updated = await apiPatch<SettingsSummary, Partial<SettingsSummary>>("/settings", { ...settings, ...next });
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

  async function openBrowser() {
    setBrowserOpen(true);
    setSelected(null);
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
    setConfirmOpen(true);
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

  async function clearCache(category: "artwork" | "streams" | "lyrics" | "all") {
    try {
      const result = await apiPost<{ files_removed: number; bytes_removed: number }, { category: typeof category }>("/settings/cache/clear", { category });
      toast(`Removed ${result.files_removed.toLocaleString()} cached files`, "success");
      await refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not clear cache", "error");
    }
  }

  const cacheTotal = useMemo(() => storage ? storage.categories.artwork + storage.categories.lyrics + storage.categories.streams : 0, [storage]);

  return (
    <motion.div {...pageTransition} className="mx-auto max-w-5xl space-y-8 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
      <section><p className="mb-2 text-sm font-semibold text-primary">Settings</p><h1 className="text-4xl font-black tracking-normal sm:text-5xl">Aura, your way</h1></section>

      {storage?.migration.cleanup_warning && <Notice tone="warning">{storage.migration.cleanup_warning}</Notice>}
      {storage?.migration.error && <Notice tone="error">{storage.migration.error}</Notice>}

      <SettingsSection icon={<HardDrive />} title="Storage">
        <div className="rounded-2xl bg-muted/40 p-4">
          <Label>The directory where your data should be stored</Label>
          <p className="mt-2 break-all font-mono text-sm">{storage?.data_root ?? "Loading…"}</p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: storage ? `${Math.min(100, storage.used_bytes * 100 / Math.max(storage.used_bytes + storage.free_bytes, 1))}%` : "0%" }} /></div>
          <p className="mt-2 text-sm text-muted-foreground">{storage ? `${formatBytes(storage.used_bytes)} used · ${formatBytes(storage.free_bytes)} free` : "Calculating usage…"}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Usage label="Music" value={storage?.categories.music} />
          <Usage label="Database" value={storage?.categories.database} />
          <Usage label="Downloads" value={storage?.categories.downloads} />
        </div>
        <Button onClick={() => void openBrowser()}><Folder className="h-4 w-4" />Change Data Location</Button>
      </SettingsSection>

      <SettingsSection icon={<RefreshCw />} title="Library">
        <Toggle label="Scan library on startup" description="Scan the managed music folder in the background whenever Aura starts." checked={settings?.startup_scan_enabled ?? true} onChange={(value) => update("startup_scan_enabled", value)} />
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
        <div><Label>Accent</Label><div className="mt-2 flex gap-3">{(Object.keys(accentValues) as AccentTheme[]).map((accent) => <button key={accent} aria-label={`Use ${accent} accent`} onClick={() => { update("accent_theme", accent); applyAccent(accent); }} className={`h-10 w-10 rounded-full border-2 transition ${settings?.accent_theme === accent ? "scale-110 border-foreground" : "border-transparent"}`} style={{ backgroundColor: `hsl(${accentValues[accent]})` }} />)}</div></div>
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

      <Dialog open={browserOpen} onOpenChange={setBrowserOpen}>
        <DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Choose an empty server folder</DialogTitle><DialogDescription>Aura can see directories mounted on the API host. Only the exact empty folder you choose becomes the data root.</DialogDescription></DialogHeader>
          <div className="rounded-xl bg-muted/50 p-3 font-mono text-xs">{listing?.current?.display_path ?? "Filesystem roots"}</div>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {listing?.parent?.directory_id && <FolderRow entry={{ ...listing.parent, name: ".." }} onOpen={() => void browse(listing.parent?.directory_id)} />}
            {listing?.directories.map((entry) => <FolderRow key={entry.display_path} entry={entry} onOpen={() => void browse(entry.directory_id)} />)}
            {!browserBusy && listing?.directories.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">This folder has no child directories.</p>}
          </div>
          {listing?.current && <div className="flex gap-2"><Input value={newFolder} onChange={(event) => setNewFolder(event.target.value)} placeholder="New folder name" /><Button variant="glass" disabled={!newFolder.trim() || browserBusy} onClick={() => void createFolder()}><FolderPlus className="h-4 w-4" />Create</Button></div>}
          <DialogFooter><Button variant="ghost" onClick={() => setBrowserOpen(false)}>Cancel</Button><Button disabled={!listing?.current?.empty || browserBusy} onClick={chooseCurrent}>Select this empty folder</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent><DialogHeader><DialogTitle>Move Aura data?</DialogTitle><DialogDescription>This operation pauses playback and downloads until the managed root is verified.</DialogDescription></DialogHeader>
          <div className="space-y-3 rounded-xl bg-muted/40 p-4 text-sm"><p><strong>Source:</strong> <span className="break-all">{storage?.data_root}</span></p><p><strong>Target:</strong> <span className="break-all">{selected?.display_path}</span></p><p><strong>Data:</strong> {formatBytes(storage?.used_bytes ?? 0)}</p><p><strong>Method:</strong> {selected?.same_device ? "Same-drive atomic move" : "Copy, hash, verify, then switch"}</p></div>
          <DialogFooter><Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button><Button onClick={() => void migrate()}>Move and verify</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

function SettingsSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return <section className="glass-panel space-y-5 rounded-3xl p-6"><div className="flex items-center gap-3 text-primary">{icon}<h2 className="text-xl font-bold text-foreground">{title}</h2></div>{children}</section>;
}

function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl bg-muted/30 p-4"><span><span className="font-semibold">{label}</span><span className="mt-1 block text-sm text-muted-foreground">{description}</span></span><input className="h-5 w-5 accent-[hsl(var(--primary))]" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
}

function NumberSetting({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <div className="space-y-2"><Label>{label}</Label><Input type="number" value={value} min={min} max={max} onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value))))} /></div>;
}

function SelectSetting({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <div className="space-y-2"><Label>{label}</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{option[0].toUpperCase() + option.slice(1)}</option>)}</select></div>;
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

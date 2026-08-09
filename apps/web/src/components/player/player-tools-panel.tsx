import {
  AudioLines,
  Bookmark,
  Check,
  ChevronDown,
  Clock3,
  Gauge,
  Headphones,
  ListRestart,
  Radio,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  TimerOff,
  Trash2,
  Volume2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { audioService } from "@/services/audio-service";
import {
  EQ_FREQUENCIES,
  EQ_PRESETS,
  usePlaybackPreferencesStore,
  type EqualizerPresetName,
} from "@/stores/playback-preferences-store";
import { formatTime } from "@/utils/format";

type ToolTab = "playback" | "sound" | "timer" | "markers";

interface PlayerToolsPanelProps {
  trackId: string;
  currentTime: number;
  duration: number;
  onClose: () => void;
}

const tabs: Array<{ id: ToolTab; label: string; icon: typeof Gauge }> = [
  { id: "playback", label: "Playback", icon: Gauge },
  { id: "sound", label: "Sound", icon: SlidersHorizontal },
  { id: "timer", label: "Timer", icon: Clock3 },
  { id: "markers", label: "Markers", icon: Bookmark },
];

export function PlayerToolsPanel({ trackId, currentTime, duration, onClose }: PlayerToolsPanelProps) {
  const [tab, setTab] = useState<ToolTab>("playback");

  return (
    <section className="relative mx-auto flex h-full w-full max-w-3xl flex-col px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-8">
      <header className="mb-3 grid shrink-0 grid-cols-[2.75rem_1fr_2.75rem] items-center">
        <button type="button" aria-label="Return to player" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white">
          <ChevronDown className="h-6 w-6" />
        </button>
        <div className="text-center"><h2 className="text-base font-bold">Playback studio</h2><p className="text-[0.68rem] text-white/50">Tune this device</p></div>
        <span />
      </header>

      <div className="no-scrollbar mb-4 flex shrink-0 gap-2 overflow-x-auto rounded-2xl bg-black/15 p-1.5">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn("flex min-w-max flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-white/55 transition", tab === id && "bg-white text-black shadow-lg")}
          >
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto pb-3">
        {tab === "playback" && <PlaybackTools />}
        {tab === "sound" && <SoundTools />}
        {tab === "timer" && <TimerTools />}
        {tab === "markers" && <MarkerTools trackId={trackId} currentTime={currentTime} duration={duration} />}
      </div>
    </section>
  );
}

function PlaybackTools() {
  const preferences = usePlaybackPreferencesStore();
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [outputsLoading, setOutputsLoading] = useState(false);

  async function discoverOutputs() {
    setOutputsLoading(true);
    try {
      const devices = await audioService.listOutputDevices();
      setOutputs(devices);
      if (devices.length === 0) toast("This browser does not expose audio-output selection", "error");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not list audio outputs", "error");
    } finally {
      setOutputsLoading(false);
    }
  }

  async function chooseOutput(deviceId: string) {
    try {
      await audioService.setOutputDevice(deviceId);
      preferences.setOutputDeviceId(deviceId);
      toast("Audio output changed", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not change audio output", "error");
    }
  }

  return (
    <div className="space-y-4">
      <ToolCard title="Playback speed" description="Change tempo without changing pitch." icon={Gauge}>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => (
            <ChoiceButton key={rate} active={preferences.playbackRate === rate} onClick={() => preferences.setPlaybackRate(rate)}>{rate}×</ChoiceButton>
          ))}
        </div>
        <ToggleRow label="Preserve pitch" description="Keep voices and instruments natural at other speeds." checked={preferences.preservesPitch} onChange={preferences.setPreservesPitch} />
      </ToolCard>

      <ToolCard title="Seek distance" description="Used by arrow keys and media controls." icon={ListRestart}>
        <div className="grid grid-cols-4 gap-2">
          {[5, 10, 15, 30].map((seconds) => (
            <ChoiceButton key={seconds} active={preferences.seekStepSeconds === seconds} onClick={() => preferences.setSeekStepSeconds(seconds)}>{seconds}s</ChoiceButton>
          ))}
        </div>
      </ToolCard>

      <ToolCard title="Continuous listening" description="Keep music moving and recover gracefully." icon={Radio}>
        <ToggleRow label="Autoplay radio" description="When the queue ends, add a related track automatically." checked={preferences.autoplayEnabled} onChange={preferences.setAutoplayEnabled} />
        <ToggleRow label="Skip unplayable tracks" description="Retry once, then continue to the next track." checked={preferences.skipOnPlaybackError} onChange={preferences.setSkipOnPlaybackError} />
      </ToolCard>

      <ToolCard title="Audio output" description="Route playback to another supported speaker or headset." icon={Headphones}>
        <Button variant="glass" onClick={discoverOutputs} disabled={outputsLoading}>{outputsLoading ? "Finding devices…" : outputs.length ? "Refresh devices" : "Find output devices"}</Button>
        {outputs.length > 0 && (
          <div className="mt-3 space-y-2">
            {outputs.map((device, index) => (
              <button key={device.deviceId} type="button" onClick={() => chooseOutput(device.deviceId)} className="flex w-full items-center gap-3 rounded-xl bg-white/8 p-3 text-left transition hover:bg-white/15">
                <Volume2 className="h-4 w-4 text-white/60" /><span className="min-w-0 flex-1 truncate text-sm font-medium">{device.label || `Audio output ${index + 1}`}</span>
                {(preferences.outputDeviceId === device.deviceId || (!preferences.outputDeviceId && device.deviceId === "default")) && <Check className="h-4 w-4" />}
              </button>
            ))}
          </div>
        )}
      </ToolCard>
    </div>
  );
}

function SoundTools() {
  const preferences = usePlaybackPreferencesStore();
  const presetOptions = Object.keys(EQ_PRESETS) as Array<Exclude<EqualizerPresetName, "custom">>;
  return (
    <div className="space-y-4">
      <ToolCard title="10-band equalizer" description="Shape frequencies from sub-bass through air." icon={AudioLines}>
        <ToggleRow label="Equalizer" description={preferences.equalizerEnabled ? `${presetLabel(preferences.equalizerPreset)} profile active` : "Flat, unprocessed response"} checked={preferences.equalizerEnabled} onChange={preferences.setEqualizerEnabled} />
        <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
          {presetOptions.map((preset) => (
            <ChoiceButton key={preset} active={preferences.equalizerPreset === preset} onClick={() => { preferences.applyEqualizerPreset(preset); preferences.setEqualizerEnabled(preset !== "flat"); }}>{presetLabel(preset)}</ChoiceButton>
          ))}
        </div>
        <div className="mt-5 grid grid-cols-10 gap-1 rounded-2xl bg-black/15 px-2 py-4 sm:gap-2 sm:px-4">
          {EQ_FREQUENCIES.map((frequency, index) => (
            <label key={frequency} className="flex min-w-0 flex-col items-center gap-2 text-[0.58rem] text-white/55">
              <span className="tabular-nums text-white/80">{preferences.equalizerGains[index] > 0 ? "+" : ""}{preferences.equalizerGains[index].toFixed(0)}</span>
              <input
                type="range"
                min={-12}
                max={12}
                step={1}
                value={preferences.equalizerGains[index]}
                onChange={(event) => { preferences.setEqualizerBand(index, Number(event.target.value)); preferences.setEqualizerEnabled(true); }}
                className="h-28 w-5 cursor-pointer accent-white"
                style={{ writingMode: "vertical-lr", direction: "rtl" }}
                aria-label={`${frequencyLabel(frequency)} equalizer gain`}
              />
              <span className="truncate">{frequencyLabel(frequency)}</span>
            </label>
          ))}
        </div>
        <RangeRow label="Preamp" value={preferences.preampDb} min={-12} max={12} step={0.5} display={`${preferences.preampDb > 0 ? "+" : ""}${preferences.preampDb.toFixed(1)} dB`} onChange={preferences.setPreampDb} />
      </ToolCard>

      <ToolCard title="Channel & dynamics" description="Correct room placement and smooth loudness jumps." icon={Sparkles}>
        <RangeRow label="Stereo balance" value={preferences.stereoBalance} min={-1} max={1} step={0.05} display={balanceLabel(preferences.stereoBalance)} onChange={preferences.setStereoBalance} />
        <ToggleRow label="Mono audio" description="Blend both channels into every speaker." checked={preferences.monoEnabled} onChange={preferences.setMonoEnabled} />
        <ToggleRow label="Loudness normalization" description="Compress sudden level differences between tracks." checked={preferences.normalizationEnabled} onChange={preferences.setNormalizationEnabled} />
        <Button variant="glass" size="sm" onClick={preferences.resetAudioProcessing}><RotateCcw className="h-4 w-4" />Reset sound</Button>
      </ToolCard>
    </div>
  );
}

function TimerTools() {
  const preferences = usePlaybackPreferencesStore();
  const [customMinutes, setCustomMinutes] = useState("20");
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!preferences.sleepTimerEndsAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [preferences.sleepTimerEndsAt]);

  const remaining = preferences.sleepTimerEndsAt ? Math.max(0, preferences.sleepTimerEndsAt - (now ?? preferences.sleepTimerEndsAt)) : null;
  const timerLabel = preferences.sleepTimerEndOfTrack
    ? "Stops when this track ends"
    : remaining !== null
      ? `Stops in ${formatCountdown(remaining)}`
      : "No sleep timer running";

  return (
    <div className="space-y-4">
      <ToolCard title="Sleep timer" description={timerLabel} icon={Clock3}>
        <div className="grid grid-cols-4 gap-2">
          {[15, 30, 45, 60].map((minutes) => <ChoiceButton key={minutes} active={false} onClick={() => preferences.startSleepTimer(minutes)}>{minutes}m</ChoiceButton>)}
        </div>
        <div className="mt-3 flex gap-2">
          <Input type="number" min={1} max={1440} value={customMinutes} onChange={(event) => setCustomMinutes(event.target.value)} aria-label="Custom sleep timer minutes" className="h-10 bg-white/10 text-white" />
          <Button variant="glass" onClick={() => preferences.startSleepTimer(Number(customMinutes))}>Start custom</Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="glass" onClick={() => preferences.startEndOfTrackSleepTimer()}>End of track</Button>
          {(preferences.sleepTimerEndsAt || preferences.sleepTimerEndOfTrack) && <Button variant="glass" className="text-red-300" onClick={preferences.clearSleepTimer}><TimerOff className="h-4 w-4" />Cancel timer</Button>}
        </div>
        <RangeRow label="Fade before sleep" value={preferences.sleepFadeSeconds} min={0} max={30} step={1} display={preferences.sleepFadeSeconds ? `${preferences.sleepFadeSeconds}s` : "Off"} onChange={preferences.setSleepFadeSeconds} />
      </ToolCard>
      <ToolCard title="End of track" description="Finish the current song without continuing the queue." icon={TimerOff}>
        <ToggleRow label="Stop after current" description="Turns itself off after stopping playback." checked={preferences.stopAfterCurrent} onChange={preferences.setStopAfterCurrent} />
      </ToolCard>
    </div>
  );
}

function MarkerTools({ trackId, currentTime, duration }: { trackId: string; currentTime: number; duration: number }) {
  const preferences = usePlaybackPreferencesStore();
  const [label, setLabel] = useState("");
  const markers = useMemo(() => preferences.bookmarks.filter((bookmark) => bookmark.trackId === trackId).sort((left, right) => left.positionSeconds - right.positionSeconds), [preferences.bookmarks, trackId]);
  const loop = preferences.abRepeat.trackId === trackId ? preferences.abRepeat : null;

  function addMarker() {
    const marker = preferences.addBookmark(trackId, currentTime, label);
    setLabel("");
    toast(`Saved ${marker.label} at ${formatTime(marker.positionSeconds)}`, "success");
  }

  return (
    <div className="space-y-4">
      <ToolCard title="A–B repeat" description="Loop a precise section for practice or close listening." icon={ListRestart}>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="glass" onClick={() => preferences.setAbRepeatStart(trackId, currentTime)}>Set A · {loop?.startSeconds !== null && loop?.startSeconds !== undefined ? formatTime(loop.startSeconds) : "—"}</Button>
          <Button variant="glass" disabled={loop?.startSeconds === null || loop?.startSeconds === undefined || currentTime <= loop.startSeconds} onClick={() => preferences.setAbRepeatEnd(trackId, currentTime)}>Set B · {loop?.endSeconds !== null && loop?.endSeconds !== undefined ? formatTime(loop.endSeconds) : "—"}</Button>
        </div>
        {loop?.startSeconds !== null && loop?.endSeconds !== null && loop?.startSeconds !== undefined && loop?.endSeconds !== undefined && (
          <div className="mt-3 flex gap-2">
            <Button variant={loop.enabled ? "default" : "glass"} onClick={() => preferences.setAbRepeatEnabled(!loop.enabled)}>{loop.enabled ? "Loop active" : "Enable loop"}</Button>
            <Button variant="glass" onClick={preferences.clearAbRepeat}><Trash2 className="h-4 w-4" />Clear A–B</Button>
          </div>
        )}
      </ToolCard>

      <ToolCard title="Track bookmarks" description={`Save moments in this ${formatTime(duration)} track and jump back instantly.`} icon={Bookmark}>
        <div className="flex gap-2">
          <Input value={label} onChange={(event) => setLabel(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addMarker(); }} placeholder="Marker label (optional)" className="h-10 bg-white/10 text-white" />
          <Button onClick={addMarker}>Save {formatTime(currentTime)}</Button>
        </div>
        {markers.length > 0 && (
          <div className="mt-4 space-y-2">
            {markers.map((marker) => (
              <div key={marker.id} className="flex items-center gap-3 rounded-xl bg-white/8 p-2">
                <button type="button" onClick={() => audioService.seek(marker.positionSeconds)} className="min-w-0 flex-1 text-left"><p className="truncate text-sm font-semibold">{marker.label}</p><p className="text-xs tabular-nums text-white/50">{formatTime(marker.positionSeconds)}</p></button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-white/55 hover:text-red-300" aria-label={`Delete ${marker.label}`} onClick={() => preferences.removeBookmark(marker.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button variant="glass" size="sm" className="text-red-300" onClick={() => preferences.clearTrackBookmarks(trackId)}>Clear track bookmarks</Button>
          </div>
        )}
      </ToolCard>
    </div>
  );
}

function ToolCard({ title, description, icon: Icon, children }: { title: string; description: string; icon: typeof Gauge; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-white/12 bg-white/9 p-4 backdrop-blur-xl sm:p-5">
      <div className="mb-4 flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10"><Icon className="h-5 w-5" /></span><div><h3 className="font-bold">{title}</h3><p className="mt-0.5 text-xs leading-5 text-white/50">{description}</p></div></div>
      {children}
    </section>
  );
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="mt-3 flex w-full items-center gap-3 rounded-xl bg-white/6 p-3 text-left transition hover:bg-white/10">
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{label}</span><span className="mt-0.5 block text-xs leading-5 text-white/45">{description}</span></span>
      <span className={cn("relative h-6 w-11 shrink-0 rounded-full transition", checked ? "bg-white" : "bg-white/20")}><span className={cn("absolute top-1 h-4 w-4 rounded-full transition", checked ? "left-6 bg-black" : "left-1 bg-white/65")} /></span>
    </button>
  );
}

function ChoiceButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={cn("min-w-max rounded-xl bg-white/8 px-3 py-2 text-xs font-semibold text-white/65 transition hover:bg-white/15 hover:text-white", active && "bg-white text-black hover:bg-white/90 hover:text-black")}>{children}</button>;
}

function RangeRow({ label, value, min, max, step, display, onChange }: { label: string; value: number; min: number; max: number; step: number; display: string; onChange: (value: number) => void }) {
  const progress = ((value - min) / (max - min)) * 100;
  return (
    <div className="mt-4 block rounded-xl bg-white/6 p-3"><span className="mb-2 flex items-center justify-between text-xs font-semibold"><span>{label}</span><span className="tabular-nums text-white/55">{display}</span></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} className="apple-player-range w-full" style={{ "--range-progress": `${progress}%` } as React.CSSProperties} aria-label={label} /></div>
  );
}

function presetLabel(preset: EqualizerPresetName) {
  return preset.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

function frequencyLabel(frequency: number) {
  return frequency >= 1_000 ? `${frequency / 1_000}k` : String(frequency);
}

function balanceLabel(balance: number) {
  if (Math.abs(balance) < 0.05) return "Center";
  return `${Math.round(Math.abs(balance) * 100)}% ${balance < 0 ? "left" : "right"}`;
}

function formatCountdown(milliseconds: number) {
  const seconds = Math.ceil(milliseconds / 1_000);
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

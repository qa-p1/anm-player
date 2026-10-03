import {
  getLibraryTrackStreamUrl,
  getSongStreamUrl,
  getYouTubeStreamUrl,
} from "@/services/music-api";
import type { EqualizerGains } from "@/stores/playback-preferences-store";
import { EQ_FREQUENCIES } from "@/stores/playback-preferences-store";
import type { PlayerTrack } from "@/types/player";

type AudioEventCallback = () => void;

type ExtendedAudioElement = HTMLAudioElement & {
  setSinkId?: (deviceId: string) => Promise<void>;
  sinkId?: string;
  webkitPreservesPitch?: boolean;
};

type AudioContextWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

interface AudioProcessingSettings {
  equalizerEnabled: boolean;
  equalizerGains: EqualizerGains;
  preampDb: number;
  stereoBalance: number;
  monoEnabled: boolean;
  normalizationEnabled: boolean;
}

interface AudioCapabilities {
  webAudio: boolean;
  equalizer: boolean;
  stereoBalance: boolean;
  outputSelection: boolean;
  preservesPitch: boolean;
}

interface MediaSessionHandlers {
  play?: (details: MediaSessionActionDetails) => void;
  pause?: (details: MediaSessionActionDetails) => void;
  stop?: (details: MediaSessionActionDetails) => void;
  seekbackward?: (details: MediaSessionActionDetails) => void;
  seekforward?: (details: MediaSessionActionDetails) => void;
  seekto?: (details: MediaSessionActionDetails) => void;
  previoustrack?: (details: MediaSessionActionDetails) => void;
  nexttrack?: (details: MediaSessionActionDetails) => void;
}

const defaultProcessingSettings: AudioProcessingSettings = {
  equalizerEnabled: false,
  equalizerGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  preampDb: 0,
  stereoBalance: 0,
  monoEnabled: false,
  normalizationEnabled: false,
};

class AudioService {
  private readonly audio: ExtendedAudioElement;
  private readonly mediaSession: MediaSession | null;
  private cancelPendingPositionRestore: (() => void) | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private preampNode: GainNode | null = null;
  private equalizerNodes: BiquadFilterNode[] = [];
  private compressorNode: DynamicsCompressorNode | null = null;
  private monoNode: GainNode | null = null;
  private pannerNode: StereoPannerNode | null = null;
  private outputGainNode: GainNode | null = null;
  private processingSettings: AudioProcessingSettings = defaultProcessingSettings;
  private fadeGeneration = 0;
  private fallbackFadeVolume: number | null = null;

  constructor(audioElement?: HTMLAudioElement) {
    this.audio = (audioElement ?? new Audio()) as ExtendedAudioElement;
    this.audio.preload = "auto";
    this.mediaSession = typeof navigator !== "undefined" && "mediaSession" in navigator
      ? navigator.mediaSession
      : null;
  }

  async loadSong(song: PlayerTrack, options: { forceReload?: boolean } = {}): Promise<void> {
    if (song.source === "youtube" && !song.videoId) {
      throw new Error("Cannot play a YouTube track without a video id.");
    }
    const source = this.resolvePlaybackSource(song);
    const absoluteUrl = new URL(source.url, window.location.href).toString();

    if (this.audio.src !== absoluteUrl) {
      console.info(`ANM Player playback source: ${source.kind}`);
      this.cancelPendingPositionRestore?.();
      this.audio.src = source.url;
      this.audio.load();
    } else if (options.forceReload) {
      this.cancelPendingPositionRestore?.();
      this.audio.load();
    }

    this.updateMediaSessionMetadata(song);
  }

  private resolvePlaybackSource(song: PlayerTrack): { url: string; kind: "downloaded" | "backend-resolved" } {
    if (song.source === "local") {
      return {
        url: song.localKind === "library_track"
          ? getLibraryTrackStreamUrl(song.libraryTrackId)
          : getSongStreamUrl(song.songId),
        kind: "downloaded",
      };
    }
    return { url: getYouTubeStreamUrl(song.videoId), kind: "backend-resolved" };
  }

  private updateMediaSessionMetadata(song: PlayerTrack): void {
    if (!this.mediaSession || typeof window === "undefined" || !("MediaMetadata" in window)) return;
    try {
      this.mediaSession.metadata = new MediaMetadata({
        title: song.title,
        artist: song.artistName || "Unknown Artist",
        album: song.albumTitle || "Unknown Album",
        artwork: song.artworkUrl ? [{ src: song.artworkUrl }] : [],
      });
    } catch {
      try {
        this.mediaSession.metadata = null;
      } catch {
        // Partial Media Session implementations can reject metadata entirely.
      }
    }
  }

  async play(): Promise<void> {
    this.resetFade();
    const resumeContext = this.audioContext?.state === "suspended"
      ? this.audioContext.resume().catch(() => undefined)
      : Promise.resolve();
    // Start the media request immediately, even while Web Audio is resuming.
    await Promise.all([this.audio.play(), resumeContext]);
  }

  pause(): void {
    this.audio.pause();
  }

  stop(): void {
    this.audio.pause();
    this.seek(0);
    this.updateMediaSessionPlaybackState(false);
  }

  reload(): void {
    this.cancelPendingPositionRestore?.();
    this.audio.load();
  }

  seek(time: number): void {
    if (!Number.isFinite(time) || time < 0) return;
    const duration = this.audio.duration;
    const target = Number.isFinite(duration) && duration > 0 ? Math.min(time, duration) : time;
    try {
      this.audio.currentTime = target;
    } catch {
      this.restorePosition(target);
    }
  }

  setVolume(volume: number): void {
    this.audio.volume = clamp(volume, 0, 1);
  }

  getVolume(): number {
    return this.audio.volume;
  }

  setMuted(muted: boolean): void {
    this.audio.muted = muted;
  }

  isMuted(): boolean {
    return this.audio.muted;
  }

  setPlaybackRate(rate: number, preservesPitch = true): void {
    const nextRate = clamp(rate, 0.25, 4);
    this.audio.playbackRate = nextRate;
    this.audio.defaultPlaybackRate = nextRate;
    if ("preservesPitch" in this.audio) this.audio.preservesPitch = preservesPitch;
    if ("webkitPreservesPitch" in this.audio) this.audio.webkitPreservesPitch = preservesPitch;
    this.updateMediaSessionPosition();
  }

  getPlaybackRate(): number {
    return this.audio.playbackRate;
  }

  getCurrentTime(): number {
    return this.audio.currentTime;
  }

  getDuration(): number {
    return this.audio.duration || 0;
  }

  getBufferedUntil(): number {
    const ranges = this.audio.buffered;
    const currentTime = this.audio.currentTime;
    let bufferedUntil = 0;
    for (let index = 0; index < ranges.length; index += 1) {
      if (currentTime >= ranges.start(index) && currentTime <= ranges.end(index)) {
        return ranges.end(index);
      }
      bufferedUntil = Math.max(bufferedUntil, ranges.end(index));
    }
    return bufferedUntil;
  }

  isPaused(): boolean {
    return this.audio.paused;
  }

  hasPlaybackData(): boolean {
    return this.audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA;
  }

  isEnded(): boolean {
    return this.audio.ended;
  }

  restorePosition(time: number): void {
    if (!Number.isFinite(time) || time < 0) return;
    this.cancelPendingPositionRestore?.();
    if (time === 0) {
      if (this.audio.currentTime === 0) return;
      try {
        this.audio.currentTime = 0;
      } catch {
        // A not-yet-seekable element is already at its initial position.
      }
      return;
    }
    const source = this.audio.src;
    const apply = () => {
      this.cancelPendingPositionRestore = null;
      if (this.audio.src !== source) return;
      const duration = this.audio.duration;
      if (!Number.isFinite(duration) || duration <= 0 || time < duration) this.audio.currentTime = time;
    };
    if (this.audio.readyState >= HTMLMediaElement.HAVE_METADATA) apply();
    else {
      this.audio.addEventListener("loadedmetadata", apply, { once: true });
      this.cancelPendingPositionRestore = () => {
        this.audio.removeEventListener("loadedmetadata", apply);
        this.cancelPendingPositionRestore = null;
      };
    }
  }

  getCapabilities(): AudioCapabilities {
    const AudioContextConstructor = getAudioContextConstructor();
    return {
      webAudio: Boolean(AudioContextConstructor),
      equalizer: Boolean(AudioContextConstructor),
      stereoBalance: Boolean(AudioContextConstructor && "createStereoPanner" in AudioContextConstructor.prototype),
      outputSelection: typeof this.audio.setSinkId === "function",
      preservesPitch: "preservesPitch" in this.audio || "webkitPreservesPitch" in this.audio,
    };
  }

  configureAudioProcessing(settings: AudioProcessingSettings): boolean {
    this.processingSettings = {
      ...settings,
      equalizerGains: settings.equalizerGains.map((gain) => clamp(gain, -12, 12)) as EqualizerGains,
      preampDb: clamp(settings.preampDb, -12, 12),
      stereoBalance: clamp(settings.stereoBalance, -1, 1),
    };
    if (!processingIsActive(this.processingSettings) && !this.audioContext) return true;
    if (!this.ensureAudioGraph()) return false;
    this.applyAudioProcessingSettings();
    return true;
  }

  private ensureAudioGraph(): boolean {
    if (this.audioContext && this.sourceNode && this.preampNode && this.outputGainNode) return true;
    const AudioContextConstructor = getAudioContextConstructor();
    if (!AudioContextConstructor) return false;
    try {
      const context = this.audioContext ?? new AudioContextConstructor();
      this.audioContext = context;
      this.sourceNode ??= context.createMediaElementSource(this.audio);
      this.preampNode = context.createGain();
      this.equalizerNodes = EQ_FREQUENCIES.map((frequency, index) => {
        const node = context.createBiquadFilter();
        node.type = index === 0 ? "lowshelf" : index === EQ_FREQUENCIES.length - 1 ? "highshelf" : "peaking";
        node.frequency.value = frequency;
        if (node.type === "peaking") node.Q.value = 1.4;
        return node;
      });
      this.compressorNode = context.createDynamicsCompressor();
      this.compressorNode.threshold.value = -24;
      this.compressorNode.knee.value = 24;
      this.compressorNode.ratio.value = 4;
      this.compressorNode.attack.value = 0.005;
      this.compressorNode.release.value = 0.25;
      this.monoNode = context.createGain();
      this.monoNode.channelCount = 1;
      this.monoNode.channelCountMode = "explicit";
      this.monoNode.channelInterpretation = "speakers";
      this.pannerNode = typeof context.createStereoPanner === "function" ? context.createStereoPanner() : null;
      this.outputGainNode = context.createGain();
      this.applyAudioProcessingSettings();
      return true;
    } catch (error) {
      console.warn("Web Audio processing is unavailable:", error);
      this.bypassAudioGraph();
      return false;
    }
  }

  private applyAudioProcessingSettings(): void {
    if (!this.sourceNode || !this.preampNode || !this.outputGainNode || !this.audioContext) return;
    const settings = this.processingSettings;
    this.preampNode.gain.value = decibelsToGain(settings.preampDb);
    this.equalizerNodes.forEach((node, index) => {
      node.gain.value = settings.equalizerGains[index] ?? 0;
    });
    if (this.pannerNode) this.pannerNode.pan.value = settings.stereoBalance;

    const nodes: AudioNode[] = [this.sourceNode, this.preampNode];
    if (settings.equalizerEnabled) nodes.push(...this.equalizerNodes);
    if (settings.normalizationEnabled && this.compressorNode) nodes.push(this.compressorNode);
    if (settings.monoEnabled && this.monoNode) nodes.push(this.monoNode);
    if (this.pannerNode) nodes.push(this.pannerNode);
    nodes.push(this.outputGainNode, this.audioContext.destination);

    for (const node of [this.sourceNode, this.preampNode, ...this.equalizerNodes, this.compressorNode, this.monoNode, this.pannerNode, this.outputGainNode]) {
      try {
        node?.disconnect();
      } catch {
        // A disconnected node is already safe to reconnect.
      }
    }
    for (let index = 0; index < nodes.length - 1; index += 1) nodes[index].connect(nodes[index + 1]);
  }

  private disconnectAudioGraph(): void {
    for (const node of [this.sourceNode, this.preampNode, ...this.equalizerNodes, this.compressorNode, this.monoNode, this.pannerNode, this.outputGainNode]) {
      try {
        node?.disconnect();
      } catch {
        // Ignore partial graph cleanup failures.
      }
    }
    this.sourceNode = null;
    this.preampNode = null;
    this.equalizerNodes = [];
    this.compressorNode = null;
    this.monoNode = null;
    this.pannerNode = null;
    this.outputGainNode = null;
  }

  private bypassAudioGraph(): void {
    const sourceNode = this.sourceNode;
    const context = this.audioContext;
    this.disconnectAudioGraph();
    this.sourceNode = sourceNode;
    if (!sourceNode || !context) return;
    try {
      sourceNode.connect(context.destination);
    } catch {
      // If media-source creation itself failed, native media playback remains in charge.
    }
  }

  async listOutputDevices(): Promise<MediaDeviceInfo[]> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === "audiooutput");
  }

  async setOutputDevice(deviceId: string | null): Promise<void> {
    if (typeof this.audio.setSinkId !== "function") {
      throw new DOMException("Audio output selection is not supported by this browser.", "NotSupportedError");
    }
    await this.audio.setSinkId(deviceId ?? "");
  }

  async fadeOut(durationMs: number): Promise<void> {
    const duration = clamp(durationMs, 0, 60_000);
    const generation = ++this.fadeGeneration;
    if (duration === 0) {
      if (this.ensureAudioGraph() && this.outputGainNode && this.audioContext) {
        this.outputGainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
      } else {
        this.fallbackFadeVolume = this.audio.volume;
        this.audio.volume = 0;
      }
      return;
    }

    if (this.ensureAudioGraph() && this.outputGainNode && this.audioContext) {
      if (this.audioContext.state === "suspended") await this.audioContext.resume().catch(() => undefined);
      const now = this.audioContext.currentTime;
      this.outputGainNode.gain.cancelScheduledValues(now);
      this.outputGainNode.gain.setValueAtTime(this.outputGainNode.gain.value, now);
      this.outputGainNode.gain.linearRampToValueAtTime(0, now + duration / 1_000);
      await delay(duration);
      return;
    }

    const initialVolume = this.audio.volume;
    this.fallbackFadeVolume = initialVolume;
    const startedAt = Date.now();
    await new Promise<void>((resolve) => {
      const interval = window.setInterval(() => {
        if (generation !== this.fadeGeneration) {
          window.clearInterval(interval);
          resolve();
          return;
        }
        const progress = Math.min(1, (Date.now() - startedAt) / duration);
        this.audio.volume = initialVolume * (1 - progress);
        if (progress >= 1) {
          window.clearInterval(interval);
          resolve();
        }
      }, Math.min(100, duration));
    });
  }

  resetFade(): void {
    this.fadeGeneration += 1;
    if (this.outputGainNode && this.audioContext) {
      const now = this.audioContext.currentTime;
      this.outputGainNode.gain.cancelScheduledValues(now);
      this.outputGainNode.gain.setValueAtTime(1, now);
    }
    if (this.fallbackFadeVolume !== null) {
      this.audio.volume = this.fallbackFadeVolume;
      this.fallbackFadeVolume = null;
    }
  }

  updateMediaSessionPlaybackState(playing: boolean): void {
    if (!this.mediaSession) return;
    try {
      this.mediaSession.playbackState = playing ? "playing" : "paused";
    } catch {
      // Playback state is optional in older Media Session implementations.
    }
  }

  updateMediaSessionPosition(): void {
    if (!this.mediaSession || !Number.isFinite(this.audio.duration) || this.audio.duration <= 0) return;
    try {
      this.mediaSession.setPositionState({
        duration: this.audio.duration,
        playbackRate: this.audio.playbackRate,
        position: Math.min(Math.max(0, this.audio.currentTime), this.audio.duration),
      });
    } catch {
      // Some browsers expose Media Session without position-state support.
    }
  }

  getError(): MediaError | null {
    return this.audio.error;
  }

  onTimeUpdate(callback: AudioEventCallback): () => void { return this.on("timeupdate", callback); }
  onEnded(callback: AudioEventCallback): () => void { return this.on("ended", callback); }
  onPlay(callback: AudioEventCallback): () => void { return this.on("play", callback); }
  onPlaying(callback: AudioEventCallback): () => void { return this.on("playing", callback); }
  onPause(callback: AudioEventCallback): () => void { return this.on("pause", callback); }
  onLoadedMetadata(callback: AudioEventCallback): () => void { return this.on("loadedmetadata", callback); }
  onLoadStart(callback: AudioEventCallback): () => void { return this.on("loadstart", callback); }
  onWaiting(callback: AudioEventCallback): () => void { return this.on("waiting", callback); }
  onStalled(callback: AudioEventCallback): () => void { return this.on("stalled", callback); }
  onCanPlay(callback: AudioEventCallback): () => void { return this.on("canplay", callback); }
  onRateChange(callback: AudioEventCallback): () => void { return this.on("ratechange", callback); }

  onProgress(callback: (bufferedUntil: number) => void): () => void {
    const handler = () => callback(this.getBufferedUntil());
    this.audio.addEventListener("progress", handler);
    return () => this.audio.removeEventListener("progress", handler);
  }

  onError(callback: (error: Event) => void): () => void {
    this.audio.addEventListener("error", callback);
    return () => this.audio.removeEventListener("error", callback);
  }

  onOutputDevicesChanged(callback: AudioEventCallback): () => void {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.addEventListener) return () => undefined;
    navigator.mediaDevices.addEventListener("devicechange", callback);
    return () => navigator.mediaDevices.removeEventListener("devicechange", callback);
  }

  private on(eventName: string, callback: AudioEventCallback): () => void {
    this.audio.addEventListener(eventName, callback);
    return () => this.audio.removeEventListener(eventName, callback);
  }

  setMediaSessionHandlers(handlers: MediaSessionHandlers): void {
    if (!this.mediaSession) return;
    for (const action of supportedMediaSessionActions) {
      try {
        const handler = handlers[action];
        this.mediaSession.setActionHandler(action, handler ?? null);
      } catch (error) {
        console.warn(`Media session action ${action} not supported:`, error);
      }
    }
  }

  clearMediaSessionHandlers(): void {
    if (!this.mediaSession) return;
    for (const action of supportedMediaSessionActions) {
      try {
        this.mediaSession.setActionHandler(action, null);
      } catch {
        // Some browsers implement only a subset of Media Session actions.
      }
    }
  }

  destroy(): void {
    this.cancelPendingPositionRestore?.();
    this.resetFade();
    this.audio.pause();
    this.audio.src = "";
    this.audio.load();
    this.disconnectAudioGraph();
    if (this.audioContext) void this.audioContext.close().catch(() => undefined);
    this.audioContext = null;
  }
}

function processingIsActive(settings: AudioProcessingSettings): boolean {
  return settings.equalizerEnabled
    || settings.preampDb !== 0
    || settings.stereoBalance !== 0
    || settings.monoEnabled
    || settings.normalizationEnabled;
}

const supportedMediaSessionActions = [
  "play",
  "pause",
  "stop",
  "seekbackward",
  "seekforward",
  "seekto",
  "previoustrack",
  "nexttrack",
] as const satisfies readonly MediaSessionAction[];

function getAudioContextConstructor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  const contextWindow = window as AudioContextWindow;
  return contextWindow.AudioContext ?? contextWindow.webkitAudioContext ?? null;
}

function decibelsToGain(decibels: number): number {
  return 10 ** (decibels / 20);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export const audioService = new AudioService();

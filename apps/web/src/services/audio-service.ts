import {
  getLibraryTrackStreamUrl,
  getSongStreamUrl,
  getYouTubeStreamUrl,
} from "@/services/music-api";
import type { PlayerTrack } from "@/types/player";

type AudioEventCallback = () => void;

export class AudioService {
  private audio: HTMLAudioElement;
  private mediaSession: MediaSession | null = null;

  constructor() {
    this.audio = new Audio();
    this.audio.preload = "metadata";
    
    if ("mediaSession" in navigator) {
      this.mediaSession = navigator.mediaSession;
    }
  }

  // Playback control
  async loadSong(song: PlayerTrack): Promise<void> {
    if (song.source === "youtube" && !song.videoId) {
      throw new Error("Cannot play a YouTube track without a video id.");
    }
    const source = await this.resolvePlaybackSource(song);
    const url = source.url;
    
    if (this.audio.src !== url) {
      console.info(`Aura playback source: ${source.kind}`);
      this.audio.src = url;
      this.audio.load();
    }

    // Update media session metadata
    if (this.mediaSession) {
      this.mediaSession.metadata = new MediaMetadata({
        title: song.title,
        artist: song.artistName || "Unknown Artist",
        album: song.albumTitle || "Unknown Album",
        artwork: song.artworkUrl ? [{ src: song.artworkUrl }] : [],
      });
    }
  }

  private async resolvePlaybackSource(song: PlayerTrack): Promise<{ url: string; kind: "downloaded" | "backend-resolved" }> {
    if (song.source === "local") {
      return {
        url: song.localKind === "library_track"
          ? getLibraryTrackStreamUrl(song.libraryTrackId)
          : getSongStreamUrl(song.songId),
        kind: "downloaded",
      };
    }

    // The backend endpoint is authoritative for downloaded file -> cache ->
    // InnerTube priority. Every online surface uses this same URL.
    return {
      url: getYouTubeStreamUrl(song.videoId),
      kind: "backend-resolved",
    };
  }

  async play(): Promise<void> {
    await this.audio.play();
  }

  pause(): void {
    this.audio.pause();
  }

  stop(): void {
    this.audio.pause();
    this.audio.currentTime = 0;
  }

  seek(time: number): void {
    if (time >= 0 && time <= this.audio.duration) {
      this.audio.currentTime = time;
    }
  }

  // Volume control
  setVolume(volume: number): void {
    this.audio.volume = Math.max(0, Math.min(1, volume));
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

  // Getters
  getCurrentTime(): number {
    return this.audio.currentTime;
  }

  getDuration(): number {
    return this.audio.duration || 0;
  }

  isPaused(): boolean {
    return this.audio.paused;
  }

  isEnded(): boolean {
    return this.audio.ended;
  }

  restorePosition(time: number): void {
    if (time <= 0) return;
    const apply = () => {
      if (Number.isFinite(this.audio.duration) && time < this.audio.duration) {
        this.audio.currentTime = time;
      }
    };
    if (this.audio.readyState >= HTMLMediaElement.HAVE_METADATA) apply();
    else this.audio.addEventListener("loadedmetadata", apply, { once: true });
  }

  updateMediaSessionPlaybackState(playing: boolean): void {
    if (this.mediaSession) this.mediaSession.playbackState = playing ? "playing" : "paused";
  }

  updateMediaSessionPosition(): void {
    if (!this.mediaSession || !Number.isFinite(this.audio.duration) || this.audio.duration <= 0) return;
    try {
      this.mediaSession.setPositionState({
        duration: this.audio.duration,
        playbackRate: this.audio.playbackRate,
        position: Math.min(this.audio.currentTime, this.audio.duration),
      });
    } catch {
      // Some browsers expose Media Session without position-state support.
    }
  }

  getError(): MediaError | null {
    return this.audio.error;
  }

  // Event listeners
  onTimeUpdate(callback: AudioEventCallback): () => void {
    this.audio.addEventListener("timeupdate", callback);
    return () => this.audio.removeEventListener("timeupdate", callback);
  }

  onEnded(callback: AudioEventCallback): () => void {
    this.audio.addEventListener("ended", callback);
    return () => this.audio.removeEventListener("ended", callback);
  }

  onPlay(callback: AudioEventCallback): () => void {
    this.audio.addEventListener("play", callback);
    return () => this.audio.removeEventListener("play", callback);
  }

  onPause(callback: AudioEventCallback): () => void {
    this.audio.addEventListener("pause", callback);
    return () => this.audio.removeEventListener("pause", callback);
  }

  onLoadedMetadata(callback: AudioEventCallback): () => void {
    this.audio.addEventListener("loadedmetadata", callback);
    return () => this.audio.removeEventListener("loadedmetadata", callback);
  }

  onError(callback: (error: Event) => void): () => void {
    this.audio.addEventListener("error", callback);
    return () => this.audio.removeEventListener("error", callback);
  }

  onCanPlay(callback: AudioEventCallback): () => void {
    this.audio.addEventListener("canplay", callback);
    return () => this.audio.removeEventListener("canplay", callback);
  }

  // Media Session handlers
  setMediaSessionHandlers(handlers: {
    play?: () => void;
    pause?: () => void;
    seekbackward?: () => void;
    seekforward?: () => void;
    previoustrack?: () => void;
    nexttrack?: () => void;
  }): void {
    if (!this.mediaSession) return;

    const actions = [
      "play",
      "pause",
      "seekbackward",
      "seekforward",
      "previoustrack",
      "nexttrack",
    ] as const;

    actions.forEach((action) => {
      try {
        const handler = handlers[action];
        if (handler) {
          this.mediaSession!.setActionHandler(action, handler);
        }
      } catch (error) {
        console.warn(`Media session action ${action} not supported:`, error);
      }
    });
  }

  // Cleanup
  destroy(): void {
    this.audio.pause();
    this.audio.src = "";
    this.audio.load();
  }
}

// Singleton instance
export const audioService = new AudioService();

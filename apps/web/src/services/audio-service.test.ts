import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeAudio extends EventTarget {
  preload = "";
  src = "";
  currentTime = 0;
  duration = 100;
  volume = 0.8;
  muted = false;
  paused = true;
  ended = false;
  readyState = HTMLMediaElement.HAVE_METADATA;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  preservesPitch = true;
  error: MediaError | null = null;
  load = vi.fn();
  pause = vi.fn(() => { this.paused = true; });
  play = vi.fn(async () => { this.paused = false; });
  setSinkId = vi.fn(async () => undefined);
  buffered: TimeRanges = {
    length: 1,
    start: () => 0,
    end: () => 40,
  };
}

class FakeAudioParam {
  value = 0;
  setValueAtTime = vi.fn((value: number) => { this.value = value; });
  linearRampToValueAtTime = vi.fn((value: number) => { this.value = value; });
  cancelScheduledValues = vi.fn();
}

class FakeAudioNode {
  connect = vi.fn((target: FakeAudioNode) => target);
  disconnect = vi.fn();
  channelCount = 2;
  channelCountMode: ChannelCountMode = "max";
  channelInterpretation: ChannelInterpretation = "speakers";
}

class FakeGainNode extends FakeAudioNode { gain = new FakeAudioParam(); }
class FakeFilterNode extends FakeAudioNode {
  type: BiquadFilterType = "peaking";
  frequency = new FakeAudioParam();
  Q = new FakeAudioParam();
  gain = new FakeAudioParam();
}
class FakeCompressorNode extends FakeAudioNode {
  threshold = new FakeAudioParam();
  knee = new FakeAudioParam();
  ratio = new FakeAudioParam();
  attack = new FakeAudioParam();
  release = new FakeAudioParam();
}
class FakePannerNode extends FakeAudioNode { pan = new FakeAudioParam(); }

class FakeAudioContext {
  static last: FakeAudioContext | null = null;
  state: AudioContextState = "running";
  currentTime = 0;
  destination = new FakeAudioNode();
  gains: FakeGainNode[] = [];
  filters: FakeFilterNode[] = [];
  panner = new FakePannerNode();
  constructor() { FakeAudioContext.last = this; }
  createMediaElementSource() { return new FakeAudioNode(); }
  createGain() { const node = new FakeGainNode(); this.gains.push(node); return node; }
  createBiquadFilter() { const node = new FakeFilterNode(); this.filters.push(node); return node; }
  createDynamicsCompressor() { return new FakeCompressorNode(); }
  createStereoPanner() { return this.panner; }
  resume = vi.fn().mockResolvedValue(undefined);
  close = vi.fn().mockResolvedValue(undefined);
}

describe("audio service browser adapter", () => {
  let fakeAudio: FakeAudio;

  beforeEach(() => {
    vi.resetModules();
    fakeAudio = new FakeAudio();
    const AudioMock = function AudioMock() { return fakeAudio; } as unknown as typeof Audio;
    vi.stubGlobal("Audio", AudioMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clamps seek/rate values, preserves pitch, and can force a source reload", async () => {
    const { audioService } = await import("@/services/audio-service");
    audioService.setPlaybackRate(8, false);
    audioService.seek(150);
    expect(fakeAudio.playbackRate).toBe(4);
    expect(fakeAudio.defaultPlaybackRate).toBe(4);
    expect(fakeAudio.preservesPitch).toBe(false);
    expect(fakeAudio.currentTime).toBe(100);

    const song = {
      source: "local" as const,
      localKind: "song" as const,
      id: "local:1",
      songId: 1,
      title: "Local song",
      artistName: null,
      albumTitle: null,
      artworkUrl: null,
      durationSeconds: 100,
      rawSong: {},
    };
    await audioService.loadSong(song as never);
    await audioService.loadSong(song as never, { forceReload: true });
    expect(fakeAudio.load).toHaveBeenCalledTimes(2);
  });

  it("reports safe fallbacks, output routing, buffering, and media events", async () => {
    const output = { deviceId: "speaker", groupId: "group", kind: "audiooutput", label: "Desk speakers", toJSON: () => ({}) } as MediaDeviceInfo;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { enumerateDevices: vi.fn().mockResolvedValue([output]) },
    });
    const { audioService } = await import("@/services/audio-service");
    expect(audioService.getCapabilities()).toMatchObject({
      webAudio: false,
      equalizer: false,
      outputSelection: true,
      preservesPitch: true,
    });
    expect(await audioService.listOutputDevices()).toEqual([output]);
    await audioService.setOutputDevice("speaker");
    expect(fakeAudio.setSinkId).toHaveBeenCalledWith("speaker");
    expect(audioService.getBufferedUntil()).toBe(40);

    const waiting = vi.fn();
    const unsubscribe = audioService.onWaiting(waiting);
    fakeAudio.dispatchEvent(new Event("waiting"));
    unsubscribe();
    fakeAudio.dispatchEvent(new Event("waiting"));
    expect(waiting).toHaveBeenCalledTimes(1);
  });

  it("builds and updates the 10-band Web Audio processing graph", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext as unknown as typeof AudioContext);
    const { audioService } = await import("@/services/audio-service");
    const configured = audioService.configureAudioProcessing({
      equalizerEnabled: true,
      equalizerGains: [1, 2, 3, 4, 5, 6, 5, 4, 3, 2],
      preampDb: 6,
      stereoBalance: 0.5,
      monoEnabled: true,
      normalizationEnabled: true,
    });

    const context = FakeAudioContext.last!;
    expect(configured).toBe(true);
    expect(context.filters).toHaveLength(10);
    expect(context.filters.map((filter) => filter.gain.value)).toEqual([1, 2, 3, 4, 5, 6, 5, 4, 3, 2]);
    expect(context.gains[0].gain.value).toBeCloseTo(10 ** (6 / 20));
    expect(context.panner.pan.value).toBe(0.5);
  });
});

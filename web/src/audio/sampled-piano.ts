import bank from '../../../shared/audio/upright-kw.json';

/** Timbre backend; musical time and exercise definitions belong to the caller. */
export interface MusicalRenderer {
  readonly output: GainNode;
  load(): Promise<void>;
  noteOn(midi: number, at: number, heldSeconds: number, velocity?: number): void;
  fadeOut(): Promise<void>;
  fadeIn(): void;
  stop(): void;
}

type Voice = { source: AudioBufferSourceNode; gain: GainNode; start: number; end: number; releaseAt: number; level: number; attack: number };
const banks = new WeakMap<AudioContext, Promise<Map<number, AudioBuffer>>>();
const FADE = 0.015;
const MAX_VOICES = 8;

/** Blend loop tail into the pre-loop waveform, keeping loop length/pitch unchanged. */
function smoothLoop(buffer: AudioBuffer, startSeconds: number, endSeconds: number) {
  const start = Math.round(startSeconds * buffer.sampleRate);
  const end = Math.round(endSeconds * buffer.sampleRate);
  const width = Math.min(Math.round(buffer.sampleRate * 0.01), start, Math.floor((end - start) / 4));
  if (width < 2 || end > buffer.length) throw new Error('Invalid piano sample loop');
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < width; i++) {
      const blend = i / (width - 1);
      data[end - width + i] = data[end - width + i] * (1 - blend) + data[start - width + i] * blend;
    }
  }
}

async function decodeBank(context: AudioContext) {
  const buffers = new Map<number, AudioBuffer>();
  // Bound decode concurrency and reuse the same decoded bank for every restart.
  let next = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < bank.regions.length) {
      const region = bank.regions[next++];
      const response = await fetch(region.file);
      if (!response.ok) throw new Error(`Piano sample unavailable (${response.status})`);
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      if (region.loopStartSeconds !== undefined && region.loopEndSeconds !== undefined) {
        smoothLoop(buffer, region.loopStartSeconds, region.loopEndSeconds);
      }
      buffers.set(region.root, buffer);
    }
  }));
  return buffers;
}

export class SampledPiano implements MusicalRenderer {
  readonly output: GainNode;
  private buffers?: Map<number, AudioBuffer>;
  private voices = new Set<Voice>();
  private stopped = false;

  constructor(private readonly context: AudioContext) {
    this.output = context.createGain();
    // Eight full-scale voices * .32 * .35 = .896, leaving room for the metronome.
    this.output.gain.value = 0.35;
    this.output.connect(context.destination);
  }

  async load() {
    let pending = banks.get(this.context);
    if (!pending) {
      pending = decodeBank(this.context);
      banks.set(this.context, pending);
      void pending.catch(() => { if (banks.get(this.context) === pending) banks.delete(this.context); });
    }
    this.buffers = await pending;
  }

  noteOn(midi: number, at: number, heldSeconds: number, velocity = 112) {
    if (this.stopped) return;
    if (!Number.isInteger(midi) || midi < bank.supportedMidi[0] || midi > bank.supportedMidi[1] || !Number.isFinite(at) || !Number.isFinite(heldSeconds) || heldSeconds <= 0) {
      throw new RangeError('Unsupported sampled piano note');
    }
    const region = bank.regions.find((entry) => midi >= entry.low && midi <= entry.high);
    const buffer = region && this.buffers?.get(region.root);
    if (!region || !buffer) throw new Error('Piano bank has not loaded');
    const overlapping = [...this.voices].filter((voice) => voice.start <= at && voice.end > at).sort((a, b) => a.start - b.start);
    // Release the oldest voice, including its ramp, before admitting a ninth voice.
    if (overlapping.length >= MAX_VOICES) {
      const oldest = overlapping[0];
      const releaseStart = Math.max(this.context.currentTime, at - FADE);
      const envelope = releaseStart < oldest.start ? 0 : releaseStart < oldest.start + oldest.attack
        ? (releaseStart - oldest.start) / oldest.attack
        : releaseStart < oldest.releaseAt ? 1 : Math.max(0, (oldest.end - releaseStart) / bank.releaseSeconds);
      // Preserve the existing attack/release up to the steal boundary.
      oldest.gain.gain.cancelAndHoldAtTime(releaseStart);
      oldest.gain.gain.setValueAtTime(oldest.level * envelope, releaseStart);
      oldest.gain.gain.linearRampToValueAtTime(0, at);
      oldest.source.stop(at);
      oldest.end = at;
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 2 ** ((midi - region.root) / 12);
    if (region.loopStartSeconds !== undefined && region.loopEndSeconds !== undefined) {
      source.loop = true;
      source.loopStart = region.loopStartSeconds;
      source.loopEnd = region.loopEndSeconds;
    }
    const gain = this.context.createGain();
    const level = 0.32 * (Math.max(1, Math.min(127, velocity)) / 127) ** 1.5;
    const releaseAt = at + heldSeconds;
    const end = releaseAt + bank.releaseSeconds;
    gain.gain.setValueAtTime(0, at);
    const attack = Math.min(0.003, heldSeconds / 2);
    gain.gain.linearRampToValueAtTime(level, at + attack);
    gain.gain.setValueAtTime(level, releaseAt);
    gain.gain.linearRampToValueAtTime(0, end);
    source.connect(gain).connect(this.output);
    const voice = { source, gain, start: at, end, releaseAt, level, attack };
    this.voices.add(voice);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      this.voices.delete(voice);
      if (this.stopped && this.voices.size === 0) this.output.disconnect();
    };
    source.start(at);
    source.stop(end + 0.002);
  }

  async fadeOut() {
    const now = this.context.currentTime;
    this.output.gain.cancelAndHoldAtTime(now);
    this.output.gain.setValueAtTime(this.output.gain.value, now);
    this.output.gain.linearRampToValueAtTime(0, now + FADE);
    // Wall timers do not prove that the audio thread has rendered the fade.
    const deadline = performance.now() + 1000;
    while (this.context.state === 'running' && this.context.currentTime < now + FADE + 256 / this.context.sampleRate) {
      if (performance.now() > deadline) throw new Error('Piano audio clock stalled');
      await new Promise<void>((resolve) => window.setTimeout(resolve, 5));
    }
  }

  fadeIn() {
    if (this.stopped) return;
    const now = this.context.currentTime;
    this.output.gain.cancelAndHoldAtTime(now);
    this.output.gain.setValueAtTime(this.output.gain.value, now);
    this.output.gain.linearRampToValueAtTime(0.35, now + FADE);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    const now = this.context.currentTime;
    this.output.gain.cancelAndHoldAtTime(now);
    this.output.gain.setValueAtTime(this.output.gain.value, now);
    this.output.gain.linearRampToValueAtTime(0, now + FADE);
    for (const voice of this.voices) voice.source.stop(now + FADE + 0.005);
    // Audio-thread completion, rather than a wall timer, owns graph teardown.
    if (this.voices.size === 0) this.output.disconnect();
  }
}

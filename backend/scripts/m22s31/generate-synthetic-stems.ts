// M22-S3.1: deterministic, procedurally synthesized six-stem WAV set (no commercial music, no external audio) for the long
// MP3 homologation. Each stem has its own character and plenty of transients so that the sample-alignment evidence is
// "signal" and not "metadata-only". 16-bit PCM, 44.1 kHz stereo.
//   npx tsx scripts/m22s31/generate-synthetic-stems.ts <outDir> [seconds=298]
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import path from 'node:path';

const RATE = 44_100;
const IDS = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'] as const;
type Id = (typeof IDS)[number];

function rng(seed: number) {
  let x = seed >>> 0;
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296 - 0.5; };
}

/** One sample of both channels for a stem at time index `i`. State lives in the closure. */
function voice(id: Id): (i: number) => [number, number] {
  const noise = rng(IDS.indexOf(id) + 11);
  const bpm = 96;
  const beat = (RATE * 60) / bpm;
  const notes = [0, 3, 7, 10, 5, 8, 12, 2]; // semitones above the root
  const hz = (root: number, semis: number) => root * 2 ** (semis / 12);
  switch (id) {
    case 'vocals': {
      return (i) => {
        const bar = Math.floor(i / (beat * 2)), t = (i % (beat * 2)) / RATE;
        const f = hz(220, notes[bar % notes.length]!) * (1 + 0.012 * Math.sin(2 * Math.PI * 5.5 * t));
        const env = Math.min(1, t * 20) * Math.exp(-t * 1.1);
        const ph = 2 * Math.PI * f * t;
        const s = env * (0.5 * Math.sin(ph) + 0.25 * Math.sin(2 * ph) + 0.12 * Math.sin(3 * ph) + 0.05 * noise() * (t < 0.04 ? 1 : 0.1));
        return [s * 0.8, s * 0.7];
      };
    }
    case 'drums': {
      let hat = 0;
      return (i) => {
        const inBeat = i % beat, t = inBeat / RATE;
        const step = Math.floor(i / beat) % 4;
        const kick = step % 2 === 0 ? Math.sin(2 * Math.PI * (55 + 90 * Math.exp(-t * 28)) * t) * Math.exp(-t * 14) : 0;
        const snare = step % 2 === 1 ? noise() * 1.6 * Math.exp(-t * 18) : 0;
        const half = (i % (beat / 2)) / RATE;
        hat = 0.7 * hat + 0.3 * noise();
        const hh = (hat - 0.0) * 0.8 * Math.exp(-half * 60);
        return [0.7 * kick + 0.5 * snare + 0.25 * hh, 0.7 * kick + 0.45 * snare - 0.25 * hh];
      };
    }
    case 'bass': {
      return (i) => {
        const note = Math.floor(i / (beat / 2)), t = (i % (beat / 2)) / RATE;
        const f = hz(55, notes[note % notes.length]! % 12);
        const env = Math.min(1, t * 80) * Math.exp(-t * 3.2);
        const ph = 2 * Math.PI * f * t;
        const s = env * (0.7 * Math.sin(ph) + 0.18 * Math.sin(2 * ph) + 0.06 * Math.sin(3 * ph));
        return [s, s];
      };
    }
    case 'guitar': {
      // Plucked strings: decaying harmonics with a noisy attack, strummed every half beat.
      return (i) => {
        const pluck = Math.floor(i / (beat / 2)), t = (i % (beat / 2)) / RATE;
        let s = 0;
        for (const [k, semis] of [[0, 0], [1, 7], [2, 12]] as const) {
          const f = hz(165, (notes[pluck % notes.length]! + semis) % 24);
          s += Math.sin(2 * Math.PI * f * (t + k * 0.004)) * Math.exp(-t * (5 + k)) * 0.3;
        }
        s += noise() * 0.5 * Math.exp(-t * 90);
        return [s * 0.9, s * 0.55];
      };
    }
    case 'piano': {
      return (i) => {
        const chord = Math.floor(i / (beat * 2)), t = (i % (beat * 2)) / RATE;
        let s = 0;
        for (const semis of [0, 4, 7, 11]) {
          const f = hz(262, (notes[chord % notes.length]! + semis) % 24);
          const ph = 2 * Math.PI * f * t;
          s += (Math.sin(ph) + 0.4 * Math.sin(2 * ph) + 0.15 * Math.sin(4 * ph)) * Math.exp(-t * 1.6) * 0.16;
        }
        s += noise() * 0.2 * Math.exp(-t * 200);
        return [s * 0.6, s * 0.95];
      };
    }
    case 'other': {
      let lp = 0;
      return (i) => {
        const t = i / RATE;
        lp = 0.985 * lp + 0.015 * noise();
        const sweep = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.07 * t);
        const click = i % (beat * 4) < 40 ? noise() * 1.2 : 0; // a sparse transient so the stem always has alignment evidence
        const s = lp * 5 * sweep + 0.08 * Math.sin(2 * Math.PI * 880 * t) * Math.sin(2 * Math.PI * 0.2 * t) + click;
        return [s * 0.7, -s * 0.5 + 0.2 * click];
      };
    }
  }
}

function writeWav(file: string, seconds: number, sample: (i: number) => [number, number]): number {
  const frames = Math.round(seconds * RATE);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + frames * 4, 4); header.write('WAVE', 8); header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22); header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(frames * 4, 40);
  const fd = openSync(file, 'wx');
  try {
    writeSync(fd, header);
    const chunk = Buffer.alloc(RATE * 4);
    for (let start = 0; start < frames; start += RATE) {
      const count = Math.min(RATE, frames - start);
      for (let j = 0; j < count; j++) {
        const [l, r] = sample(start + j);
        chunk.writeInt16LE(Math.round(Math.max(-1, Math.min(1, l)) * 30_000), j * 4);
        chunk.writeInt16LE(Math.round(Math.max(-1, Math.min(1, r)) * 30_000), j * 4 + 2);
      }
      writeSync(fd, chunk, 0, count * 4);
    }
  } finally { closeSync(fd); }
  return frames;
}

const [outDir, secondsArg] = process.argv.slice(2);
if (!outDir) throw new Error('usage: generate-synthetic-stems.ts <outDir> [seconds]');
const seconds = Number(secondsArg ?? 298);
if (!(seconds > 0 && seconds <= 300)) throw new Error('seconds must be in (0, 300]');
mkdirSync(outDir, { recursive: true });
for (const id of IDS) {
  const frames = writeWav(path.join(outDir, `${id}.wav`), seconds, voice(id));
  console.log(id, frames, 'frames', (frames / RATE).toFixed(2), 's');
}

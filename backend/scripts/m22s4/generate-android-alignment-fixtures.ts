// M22-S4-B: impulse fixtures used to MEASURE (on a real device) how the Android MP3 decoder aligns audio.
// Same Hann-windowed 4 kHz click bursts at the start, middle and end, encoded by BOTH production profiles:
//   LAME 3.100 WASM (Web encoder) and ffmpeg/libmp3lame ("Lavc"). Deterministic synthetic signals only.
//   npx tsx scripts/m22s4/generate-android-alignment-fixtures.ts <outDir>
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLameWasmBackend } from '../../../web/src/audio/mp3-encoding/mp3-lame-backend';
import { encodeWavStemToMp3 } from '../../../web/src/audio/mp3-encoding/mp3-stem-encoder';

const DECODER_DELAY = 529; // the server's reference policy; NOT assumed to hold on Android (that is what is measured)
const BURST_LEN = 33;

function bursts(frames: number): number[] {
  return [3000, Math.floor(frames / 2), frames - 3000]; // centres of the bursts
}

function wavOf(rate: number, frames: number): Uint8Array {
  const out = new Uint8Array(44 + frames * 4);
  const v = new DataView(out.buffer);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + frames * 4, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 2, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, frames * 4, true);
  for (const c of bursts(frames)) {
    for (let k = -(BURST_LEN >> 1); k <= BURST_LEN >> 1; k++) {
      const hann = 0.5 * (1 + Math.cos((Math.PI * k) / ((BURST_LEN >> 1) + 1)));
      const s = Math.round(0.8 * hann * Math.sin((2 * Math.PI * 4000 * k) / rate + Math.PI / 2) * 32767);
      v.setInt16(44 + (c + k) * 4, s, true);
      v.setInt16(46 + (c + k) * 4, s, true);
    }
  }
  return out;
}

function u32(b: Buffer, o: number) { return b.readUInt32BE(o); }

/** Reads the Xing/Info + LAME tag of the first MPEG frame (MPEG-1 L3 stereo: tag at 36). */
function readTag(mp3: Buffer) {
  if (mp3.subarray(36, 40).toString('latin1') !== 'Info') throw new Error('no Info frame');
  const frames = u32(mp3, 44);
  const bytes = u32(mp3, 48);
  const delay = (mp3[177] << 4) | (mp3[178] >> 4);
  const padding = ((mp3[178] & 0xf) << 8) | mp3[179];
  return { encoder: mp3.subarray(156, 165).toString('latin1'), frames, bytes, delay, padding };
}

function lavc(wav: Uint8Array): Buffer {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'louvaio-align-'));
  writeFileSync(path.join(dir, 'in.wav'), wav);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', path.join(dir, 'in.wav'), '-c:a', 'libmp3lame', '-b:a', '256k', '-id3v2_version', '0', '-write_xing', '1', path.join(dir, 'out.mp3')]);
  return readFileSync(path.join(dir, 'out.mp3'));
}

async function main() {
  const outDir = path.resolve(process.argv[2] ?? 'out');
  mkdirSync(outDir, { recursive: true });
  const cases: Record<string, unknown>[] = [];
  for (const rate of [44100, 48000]) {
    const frames = rate === 44100 ? 44100 : 48000; // 1 s
    const wav = wavOf(rate, frames);
    const lame = await encodeWavStemToMp3(wav, { backend: await createLameWasmBackend(), decoderDelayFrames: DECODER_DELAY });
    writeFileSync(path.join(outDir, `impulse_lame_${rate}.mp3`), lame.bytes);
    cases.push({ name: `lame_${rate}`, file: `impulse_lame_${rate}.mp3`, sampleRate: rate, frames, bursts: bursts(frames), alignment: lame.alignment, encoder: 'LAME3.100' });

    const mp3 = lavc(wav);
    const t = readTag(mp3);
    const delay = t.delay + DECODER_DELAY;
    const padding = t.padding - DECODER_DELAY;
    if (t.frames * 1152 - delay - padding !== frames) throw new Error(`lavc ${rate}: tag does not give ${frames} frames`);
    writeFileSync(path.join(outDir, `impulse_lavc_${rate}.mp3`), mp3);
    cases.push({ name: `lavc_${rate}`, file: `impulse_lavc_${rate}.mp3`, sampleRate: rate, frames, bursts: bursts(frames),
      alignment: { encoderDelayFrames: delay, paddingFrames: padding, mpegAudioFrames: t.frames, infoFrame: true }, encoder: t.encoder, tag: { delay: t.delay, padding: t.padding } });
  }
  writeFileSync(path.join(outDir, 'cases.json'), JSON.stringify({ format: 'louvaio.android-mp3-alignment-cases', version: 1, burstLength: BURST_LEN, decoderDelayPolicy: DECODER_DELAY, cases }, null, 1) + '\n');
  console.log(JSON.stringify(cases.map((c) => ({ n: c.name, a: c.alignment, e: c.encoder })), null, 0));
}
main().catch((e) => { console.error(e); process.exit(1); });

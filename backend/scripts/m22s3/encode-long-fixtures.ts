// M22-S3: encodes six full-length WAV stems with the REAL Web encoder (LAME 3.100 WASM) into MP3 files plus manifests.json,
// for the long-audio (close to 300 s) homologation. The outputs are large and are NOT committed.
//   npx tsx scripts/m22s3/encode-long-fixtures.ts <dirWithSixWavs> <outDir>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createLameWasmBackend } from '../../../web/src/audio/mp3-encoding/mp3-lame-backend';
import { encodeWavStemToMp3 } from '../../../web/src/audio/mp3-encoding/mp3-stem-encoder';

const IDS = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'] as const;

async function main() {
  const [wavDir, outDir] = process.argv.slice(2);
  if (!wavDir || !outDir) throw new Error('usage: encode-long-fixtures.ts <dirWithSixWavs> <outDir>');
  mkdirSync(outDir, { recursive: true });
  const manifests = [];
  for (const id of IDS) {
    const wav = new Uint8Array(readFileSync(path.join(wavDir, `${id}.wav`)));
    const started = performance.now();
    const enc = await encodeWavStemToMp3(wav, { backend: await createLameWasmBackend(), decoderDelayFrames: 529 });
    writeFileSync(path.join(outDir, `${id}.mp3`), enc.bytes);
    manifests.push({
      id, codec: 'mp3_cbr256', sampleRate: enc.sampleRate, channels: 2, bitrateKbps: 256, frames: enc.frames, durationSeconds: enc.frames / enc.sampleRate,
      sizeBytes: enc.sizeBytes, sha256: enc.sha256, alignment: enc.alignment,
    });
    console.log(id, 'mp3 bytes', enc.sizeBytes, 'seconds', (enc.frames / enc.sampleRate).toFixed(1), 'ms', Math.round(performance.now() - started));
  }
  writeFileSync(path.join(outDir, 'manifests.json'), JSON.stringify(manifests, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
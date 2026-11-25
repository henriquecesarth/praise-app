import type { MinistryAudioMp3Stem } from '../ministry-audio-contract';
import type { SeparationDraft } from '../local-separation-draft';
import type { Mp3StemDecoder } from '../mp3-stem-decoder';
import {
  CANONICAL_STEM_IDS,
  STEM_DISPLAY_LABELS_PT_BR,
  allocatePcm16WavBuffer,
  parseStrictWavDescriptor,
  quantizePcm16,
  type CanonicalStemId,
} from '../separation/demucs-onnx-separator';
import type { SeparatedStemMixerInput } from '../separation/six-stem-mixer';
import { Mp3EncodingError } from './mp3-info-frame';
import type { EncodedMp3Stem } from './mp3-stem-encoder';

// M22-S2 (experimental, behind a disabled-by-default flag): turns the six WAV files of a separation draft into six MP3
// CBR 256 files and the MP3 v2 manifest, WITHOUT touching the WAV draft. One stem at a time: encode in the Worker, then
// verify (SHA-256, MPEG/LAME tag against the manifest, calibrated decoder delay, exact frame count, sample alignment
// against the original WAV). Nothing is uploaded or published here.

export type Mp3StemDecoderLike = Pick<Mp3StemDecoder, 'calibrate' | 'decodeStem'>;

export interface Mp3StemEncoderLike {
  encodeStem(job: { wav: ArrayBuffer; decoderDelayFrames: number; signal?: AbortSignal; onProgress?: (fraction: number) => void }): Promise<EncodedMp3Stem>;
}

export interface CompressionProgress {
  readonly stemIndex: number; // 0-based
  readonly stemCount: number;
  readonly stemId: CanonicalStemId;
  readonly label: string;
  readonly phase: 'encoding' | 'verifying';
  /** 0..1 over the six stems. */
  readonly overall: number;
}

/** One compressed and verified stem. Holds the MP3 as a Blob-backed File, never the raw buffers. */
export interface CompressedStemEntry {
  readonly id: CanonicalStemId;
  readonly file: File;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly sampleRate: 44100 | 48000;
  readonly frames: number;
  readonly alignment: { encoderDelayFrames: number; paddingFrames: number; mpegAudioFrames: number; infoFrame: true };
  /** How many of the three probe windows (start, middle, end) had enough signal to prove lag 0 against the WAV. */
  readonly alignmentWindowsChecked: number;
}

export class Mp3CompressionError extends Error {
  constructor(readonly code: 'CANCELLED' | 'FAILED' | 'INVALID_DRAFT' | 'INCONSISTENT', message: string, readonly stemId?: CanonicalStemId) {
    super(message);
    this.name = 'Mp3CompressionError';
  }
}

export interface Mp3CompressedDraft {
  readonly sampleRate: number;
  readonly totalFrames: number;
  readonly disposed: boolean;
  readonly wavBytesTotal: number;
  readonly mp3BytesTotal: number;
  /** 1 - mp3/wav, from the real sizes. */
  readonly savingsRatio: number;
  readonly decoderDelayFrames: number;
  /** MP3 v2 manifest stems (declarative until a server validates them). */
  manifestStems(): MinistryAudioMp3Stem[];
  files(): Record<CanonicalStemId, File>;
  /** Preview inputs: each loader decodes ONE MP3 on demand into a fresh WAV buffer (nothing decoded is retained). */
  mixerInputs(): SeparatedStemMixerInput[];
  dispose(): void;
}

export interface CompressDraftOptions {
  readonly draft: SeparationDraft;
  readonly encoder: Mp3StemEncoderLike;
  readonly decoder: Mp3StemDecoderLike;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: CompressionProgress) => void;
  /**
   * Stems already compressed in a previous failed attempt. Entries are reused (retry resumes where it stopped) and every
   * newly finished stem is added, so the caller keeps partial progress even when this call throws.
   */
  readonly completed?: Map<CanonicalStemId, CompressedStemEntry>;
  readonly yieldFn?: () => Promise<void>;
}

const PROBE_WINDOW = 8192;
const MAX_LAG = 4;
const MIN_WINDOW_POWER = 1e-8;

/** Lag (in samples) of `decoded` against the original WAV's left channel in a window, or null when the window is too quiet. */
export function measureLag(wav: Uint8Array, dataOffset: number, totalFrames: number, decodedLeft: Float32Array, start: number): number | null {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const n = Math.min(PROBE_WINDOW, totalFrames - start);
  if (n <= 2 * MAX_LAG) return null;
  const orig = new Float32Array(n);
  let power = 0;
  for (let i = 0; i < n; i++) {
    orig[i] = view.getInt16(dataOffset + (start + i) * 4, true) / 32768;
    power += orig[i] * orig[i];
  }
  if (power / n < MIN_WINDOW_POWER) return null;
  // Residual energy per lag. Raw correlation is unreliable on narrow-band material (bass): its peak is flat across
  // neighbouring lags and codec noise flips it. A shift only counts when it clearly (>= 1.5x) beats lag 0.
  let bestErr = Infinity;
  let bestLag = 0;
  let zeroErr = Infinity;
  for (let lag = -MAX_LAG; lag <= MAX_LAG; lag++) {
    let err = 0;
    for (let i = MAX_LAG; i < n - MAX_LAG; i++) { const d = orig[i] - decodedLeft[start + i + lag]; err += d * d; }
    if (lag === 0) zeroErr = err;
    if (err < bestErr) { bestErr = err; bestLag = lag; }
  }
  return zeroErr > 1.5 * bestErr ? bestLag : 0;
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function compressSeparationDraft(options: CompressDraftOptions): Promise<Mp3CompressedDraft> {
  const { draft, encoder, decoder, signal } = options;
  const completed = options.completed ?? new Map<CanonicalStemId, CompressedStemEntry>();
  const stemCount = CANONICAL_STEM_IDS.length;
  const cancelled = () => { if (signal?.aborted) throw new Mp3CompressionError('CANCELLED', 'Compressão cancelada.'); };
  if (draft.disposed) throw new Mp3CompressionError('INVALID_DRAFT', 'O rascunho de publicação foi descartado.');
  const rate = draft.sampleRate;
  if (rate !== 44_100 && rate !== 48_000) throw new Mp3CompressionError('INVALID_DRAFT', `Taxa ${rate} Hz não suportada para MP3.`);

  let wavFiles: Record<string, File>;
  try {
    wavFiles = draft.files();
  } catch {
    throw new Mp3CompressionError('INVALID_DRAFT', 'O rascunho de publicação foi descartado.');
  }

  let decoderDelayFrames: number;
  try {
    decoderDelayFrames = (await decoder.calibrate(rate)).decoderDelayFrames;
  } catch (reason) {
    throw new Mp3CompressionError('FAILED', `Este navegador não decodifica MP3 de forma confiável: ${reason instanceof Error ? reason.message : String(reason)}`);
  }
  cancelled();

  for (let index = 0; index < stemCount; index++) {
    const id = CANONICAL_STEM_IDS[index];
    const label = STEM_DISPLAY_LABELS_PT_BR[id];
    const report = (phase: 'encoding' | 'verifying', fraction: number) => options.onProgress?.({
      stemIndex: index, stemCount, stemId: id, label, phase, overall: (index + (phase === 'encoding' ? 0.85 * fraction : 0.85 + 0.15 * fraction)) / stemCount,
    });
    if (completed.has(id)) { report('verifying', 1); continue; }
    cancelled();
    if (draft.disposed) throw new Mp3CompressionError('INVALID_DRAFT', 'O rascunho de publicação foi descartado.', id);

    try {
      report('encoding', 0);
      const encoded = await encoder.encodeStem({
        wav: await wavFiles[id].arrayBuffer(), // a fresh copy; the encoder takes ownership, the draft File is untouched
        decoderDelayFrames,
        signal,
        onProgress: (fraction) => report('encoding', fraction),
      });
      cancelled();
      report('verifying', 0);
      if (encoded.frames !== draft.totalFrames || encoded.sampleRate !== rate) {
        throw new Mp3CompressionError('INCONSISTENT', 'O MP3 não corresponde à duração ou taxa do WAV.', id);
      }
      const pcm = await decoder.decodeStem(encoded.bytes, {
        sampleRate: encoded.sampleRate, frames: encoded.frames, sizeBytes: encoded.sizeBytes, sha256: encoded.sha256, alignment: encoded.alignment,
      }, signal);
      cancelled();
      if (pcm.left.length !== draft.totalFrames || pcm.right.length !== draft.totalFrames) {
        throw new Mp3CompressionError('INCONSISTENT', 'O MP3 decodificado não tem o número de frames do WAV.', id);
      }
      // Sample alignment against the ORIGINAL WAV (start, middle, end).
      const original = new Uint8Array(await wavFiles[id].arrayBuffer());
      const format = parseStrictWavDescriptor(original);
      let checked = 0;
      for (const start of [0, Math.max(0, Math.floor(draft.totalFrames / 2) - PROBE_WINDOW / 2), Math.max(0, draft.totalFrames - PROBE_WINDOW)]) {
        const lag = measureLag(original, format.dataOffset, draft.totalFrames, pcm.left, start);
        if (lag === null) continue;
        checked++;
        if (lag !== 0) throw new Mp3CompressionError('INCONSISTENT', `O MP3 da faixa ${label} está desalinhado em ${lag} amostra(s).`, id);
      }
      completed.set(id, {
        id,
        file: new File([encoded.bytes as unknown as BlobPart], `${id}.mp3`, { type: 'audio/mpeg' }), // copies into a Blob
        sizeBytes: encoded.sizeBytes,
        sha256: encoded.sha256,
        sampleRate: encoded.sampleRate,
        frames: encoded.frames,
        alignment: encoded.alignment,
        alignmentWindowsChecked: checked,
      });
      report('verifying', 1);
    } catch (reason) {
      if (reason instanceof Mp3CompressionError) throw reason;
      if (signal?.aborted || (reason instanceof Mp3EncodingError && reason.code === 'CANCELLED')) throw new Mp3CompressionError('CANCELLED', 'Compressão cancelada.', id);
      throw new Mp3CompressionError('FAILED', `Falha ao comprimir a faixa ${label}: ${reason instanceof Error ? reason.message : String(reason)}`, id);
    }
    await (options.yieldFn ?? tick)();
  }
  cancelled();

  const entries = CANONICAL_STEM_IDS.map((id) => completed.get(id)!);
  const first = entries[0];
  for (const e of entries) {
    if (e.sampleRate !== first.sampleRate || e.frames !== first.frames || e.alignment.mpegAudioFrames !== first.alignment.mpegAudioFrames ||
        e.alignment.encoderDelayFrames !== first.alignment.encoderDelayFrames || e.alignment.paddingFrames !== first.alignment.paddingFrames) {
      throw new Mp3CompressionError('INCONSISTENT', 'As seis faixas comprimidas não têm a mesma linha do tempo.', e.id);
    }
  }
  return buildCompressedDraft(draft, entries, decoder, decoderDelayFrames);
}

/** Decodes one stem into a fresh PCM16 WAV buffer in slices that yield to the main thread. */
async function decodeToWav(entry: CompressedStemEntry, decoder: Mp3StemDecoderLike, isCancelled: () => boolean, yieldFn: () => Promise<void>): Promise<Uint8Array> {
  const bytes = new Uint8Array(await entry.file.arrayBuffer());
  const pcm = await decoder.decodeStem(bytes, {
    sampleRate: entry.sampleRate, frames: entry.frames, sizeBytes: entry.sizeBytes, sha256: entry.sha256, alignment: entry.alignment,
  });
  const wav = allocatePcm16WavBuffer(entry.sampleRate, entry.frames);
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const SLICE = 262_144;
  for (let start = 0; start < entry.frames; start += SLICE) {
    if (isCancelled()) throw new Mp3CompressionError('CANCELLED', 'Pré-escuta cancelada.', entry.id);
    const end = Math.min(entry.frames, start + SLICE);
    for (let i = start; i < end; i++) {
      view.setInt16(44 + i * 4, quantizePcm16(pcm.left[i]), true);
      view.setInt16(46 + i * 4, quantizePcm16(pcm.right[i]), true);
    }
    if (end < entry.frames) await yieldFn();
  }
  return wav;
}

function buildCompressedDraft(draft: SeparationDraft, entries: CompressedStemEntry[], decoder: Mp3StemDecoderLike, decoderDelayFrames: number): Mp3CompressedDraft {
  const byId = new Map(entries.map((e) => [e.id, e] as const));
  const wavFiles = draft.files();
  let held: Map<CanonicalStemId, CompressedStemEntry> | null = byId;
  const own = () => {
    if (!held) throw new Mp3CompressionError('INVALID_DRAFT', 'A compressão foi descartada.');
    return held;
  };
  const wavBytesTotal = CANONICAL_STEM_IDS.reduce((sum, id) => sum + wavFiles[id]!.size, 0);
  const mp3BytesTotal = entries.reduce((sum, e) => sum + e.sizeBytes, 0);
  let disposed = false;
  return {
    sampleRate: draft.sampleRate,
    totalFrames: draft.totalFrames,
    get disposed() { return disposed; },
    wavBytesTotal,
    mp3BytesTotal,
    savingsRatio: 1 - mp3BytesTotal / wavBytesTotal,
    decoderDelayFrames,
    manifestStems: () => CANONICAL_STEM_IDS.map((id) => {
      const e = own().get(id)!;
      return {
        id, codec: 'mp3_cbr256' as const, sampleRate: e.sampleRate, channels: 2 as const, bitrateKbps: 256 as const,
        durationSeconds: e.frames / e.sampleRate, frames: e.frames, sizeBytes: e.sizeBytes, sha256: e.sha256, alignment: { ...e.alignment },
      };
    }),
    files: () => Object.fromEntries(CANONICAL_STEM_IDS.map((id) => [id, own().get(id)!.file])) as Record<CanonicalStemId, File>,
    mixerInputs: () => CANONICAL_STEM_IDS.map((id) => {
      const e = own().get(id)!;
      return {
        id,
        labelPtBr: STEM_DISPLAY_LABELS_PT_BR[id],
        sampleRate: e.sampleRate,
        totalFrames: e.frames,
        byteLength: 44 + e.frames * 4,
        wavBytes: () => decodeToWav(e, decoder, () => disposed, tick),
      };
    }),
    dispose() { disposed = true; held = null; },
  };
}

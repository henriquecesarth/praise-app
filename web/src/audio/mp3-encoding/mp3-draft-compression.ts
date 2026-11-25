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
  /**
   * What backs the sample alignment of this stem. `signal`: at least one probe window (start/middle/end) had enough
   * structure to tell a 1-sample shift from codec noise and showed lag 0. `metadata-only`: no window was conclusive
   * (silence, or material where a 1-sample shift is indistinguishable from codec noise); alignment then rests on the
   * MP3 tag and the calibrated decoder delay only. It is never reported as signal-verified.
   */
  readonly alignmentEvidence: 'signal' | 'metadata-only';
  readonly alignmentWindows: { readonly aligned: number; readonly inconclusive: number };
  /** Identity of the WAV File and of the encoder profile this entry was produced from (resume safety). */
  readonly source: File;
  readonly profile: string;
}

export const ENCODER_PROFILE_PREFIX = 'lame-3.100-wasm-576';

/**
 * Resume state of ONE draft. It is created per draft, owns its own Map, accepts writes only while open and only from the
 * single active run, and is closed (never merely cleared) when the draft/compression is discarded, so a late result of an
 * old run cannot repopulate it and nothing can be reused by another draft.
 */
export class Mp3ResumeStore {
  private readonly map = new Map<CanonicalStemId, CompressedStemEntry>();
  private open = true;
  private running = false;
  constructor(readonly draft: SeparationDraft) {}
  get closed() { return !this.open; }
  get size() { return this.map.size; }
  get active() { return this.running; }
  ids(): CanonicalStemId[] { return [...this.map.keys()]; }
  /** Reuse only for the same source File and the same encoder profile; anything else is ignored. */
  reusable(id: CanonicalStemId, source: File, profile: string): CompressedStemEntry | undefined {
    const entry = this.open ? this.map.get(id) : undefined;
    return entry && entry.source === source && entry.profile === profile ? entry : undefined;
  }
  /** Returns false (and stores nothing) when the store was closed meanwhile. */
  put(entry: CompressedStemEntry): boolean {
    if (!this.open) return false;
    this.map.set(entry.id, entry);
    return true;
  }
  drop(id: CanonicalStemId) { this.map.delete(id); }
  begin(): () => void {
    if (!this.open) throw new Mp3CompressionError('CANCELLED', 'A compressão foi descartada.');
    if (this.running) throw new Mp3CompressionError('FAILED', 'Já existe uma compressão em andamento para este rascunho.');
    this.running = true;
    return () => { this.running = false; };
  }
  close() { this.open = false; this.map.clear(); }
}

export const createResumeStore = (draft: SeparationDraft) => new Mp3ResumeStore(draft);

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
  /** "signal": every stem had signal evidence of lag 0; "partial": some stems rest on metadata/calibration only; "metadata-only": none had signal evidence. */
  readonly alignmentEvidence: 'signal' | 'partial' | 'metadata-only';
  readonly stemsWithoutSignalEvidence: CanonicalStemId[];
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
  /** Per-draft resume state (see Mp3ResumeStore). Without one, a private store is used and nothing survives a failure. */
  readonly resume?: Mp3ResumeStore;
  readonly yieldFn?: () => Promise<void>;
}

const PROBE_WINDOW = 8192;
const MAX_LAG = 4;
const MIN_WINDOW_POWER = 1e-8;
/** A shift only counts as detected when lag 0 has at least this many times the residual of the best lag. */
const SHIFT_RATIO = 1.5;
/** Lag 0 only counts as proven when a 1-sample shift would have added at least this many times the codec residual. */
const DISCRIMINATION = 3;

export type WindowAlignment =
  | { readonly status: 'aligned' }
  | { readonly status: 'shifted'; readonly lag: number }
  | { readonly status: 'inconclusive'; readonly reason: 'silent' | 'short' | 'ambiguous' };

/**
 * Compares the decoded MP3 with the original WAV in one window, for BOTH channels, by residual energy per lag.
 * - `shifted`: a lag in +-4 samples reduces the residual of lag 0 by >= 1.5x (in any channel).
 * - `aligned`: lag 0 is best AND a 1-sample shift would have been clearly visible (its residual >= 3x the codec residual),
 *   so lag 0 is evidence, not just absence of evidence.
 * - `inconclusive`: silent window, too short, or material (e.g. a low sustained bass) where a 1-sample shift is as small
 *   as the codec noise. Inconclusive is never treated as proof; it is reported as such.
 */
export function measureWindowAlignment(wav: Uint8Array, dataOffset: number, totalFrames: number, decoded: { left: Float32Array; right: Float32Array }, start: number): WindowAlignment {
  const n = Math.min(PROBE_WINDOW, totalFrames - start);
  if (n <= 4 * MAX_LAG) return { status: 'inconclusive', reason: 'short' };
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let worst: WindowAlignment = { status: 'inconclusive', reason: 'silent' };
  let anyAligned = false;
  let ambiguous = false;
  for (const channel of [0, 1] as const) {
    const orig = new Float32Array(n);
    let power = 0;
    for (let i = 0; i < n; i++) {
      orig[i] = view.getInt16(dataOffset + (start + i) * 4 + channel * 2, true) / 32768;
      power += orig[i] * orig[i];
    }
    if (power / n < MIN_WINDOW_POWER) continue;
    const dec = channel === 0 ? decoded.left : decoded.right;
    let bestErr = Infinity;
    let bestLag = 0;
    let zeroErr = 0;
    for (let lag = -MAX_LAG; lag <= MAX_LAG; lag++) {
      let err = 0;
      for (let i = MAX_LAG; i < n - MAX_LAG; i++) { const d = orig[i] - dec[start + i + lag]; err += d * d; }
      if (lag === 0) zeroErr = err;
      if (err < bestErr) { bestErr = err; bestLag = lag; }
    }
    if (bestLag !== 0 && zeroErr > SHIFT_RATIO * bestErr) { worst = { status: 'shifted', lag: bestLag }; break; }
    // Residual a 1-sample shift of the ORIGINAL itself would add (smaller side).
    let up = 0;
    let down = 0;
    for (let i = MAX_LAG; i < n - MAX_LAG; i++) { const a = orig[i] - orig[i + 1]; const b = orig[i] - orig[i - 1]; up += a * a; down += b * b; }
    if (Math.min(up, down) >= DISCRIMINATION * zeroErr) anyAligned = true;
    else ambiguous = true;
  }
  if (worst.status === 'shifted') return worst;
  if (anyAligned) return { status: 'aligned' };
  return { status: 'inconclusive', reason: ambiguous ? 'ambiguous' : 'silent' };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function compressSeparationDraft(options: CompressDraftOptions): Promise<Mp3CompressedDraft> {
  const { draft, encoder, decoder, signal } = options;
  const store = options.resume ?? createResumeStore(draft);
  if (store.draft !== draft) throw new Mp3CompressionError('INVALID_DRAFT', 'O estado de retomada pertence a outro rascunho.');
  const stemCount = CANONICAL_STEM_IDS.length;
  // A run may only act while it is not aborted, its store is open and its draft is alive: checked after every await that
  // matters and, above all, immediately before anything is stored.
  const alive = (id?: CanonicalStemId) => {
    if (signal?.aborted || store.closed) throw new Mp3CompressionError('CANCELLED', 'Compressão cancelada.', id);
    if (draft.disposed) throw new Mp3CompressionError('INVALID_DRAFT', 'O rascunho de publicação foi descartado.', id);
  };
  alive();
  const rate = draft.sampleRate;
  if (rate !== 44_100 && rate !== 48_000) throw new Mp3CompressionError('INVALID_DRAFT', `Taxa ${rate} Hz não suportada para MP3.`);
  const finish = store.begin();
  try {
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
    alive();
    const profile = `${ENCODER_PROFILE_PREFIX}-${decoderDelayFrames}`;

    for (let index = 0; index < stemCount; index++) {
      const id = CANONICAL_STEM_IDS[index];
      const label = STEM_DISPLAY_LABELS_PT_BR[id];
      const source = wavFiles[id]!;
      const report = (phase: 'encoding' | 'verifying', fraction: number) => options.onProgress?.({
        stemIndex: index, stemCount, stemId: id, label, phase, overall: (index + (phase === 'encoding' ? 0.85 * fraction : 0.85 + 0.15 * fraction)) / stemCount,
      });
      alive(id);
      if (store.reusable(id, source, profile)) { report('verifying', 1); continue; }
      store.drop(id); // an entry from another source/profile is stale: never reused

      try {
        report('encoding', 0);
        const wavBuffer = await source.arrayBuffer(); // a fresh copy; the encoder takes ownership, the draft File is untouched
        alive(id);
        const encoded = await encoder.encodeStem({ wav: wavBuffer, decoderDelayFrames, signal, onProgress: (fraction) => report('encoding', fraction) });
        alive(id);
        report('verifying', 0);
        if (encoded.frames !== draft.totalFrames || encoded.sampleRate !== rate) {
          throw new Mp3CompressionError('INCONSISTENT', 'O MP3 não corresponde à duração ou taxa do WAV.', id);
        }
        const pcm = await decoder.decodeStem(encoded.bytes, {
          sampleRate: encoded.sampleRate, frames: encoded.frames, sizeBytes: encoded.sizeBytes, sha256: encoded.sha256, alignment: encoded.alignment,
        }, signal);
        alive(id);
        if (pcm.left.length !== draft.totalFrames || pcm.right.length !== draft.totalFrames) {
          throw new Mp3CompressionError('INCONSISTENT', 'O MP3 decodificado não tem o número de frames do WAV.', id);
        }
        // Sample alignment against the ORIGINAL WAV (start, middle, end), both channels.
        const original = new Uint8Array(await source.arrayBuffer());
        alive(id);
        const format = parseStrictWavDescriptor(original);
        let aligned = 0;
        let inconclusive = 0;
        for (const start of [0, Math.max(0, Math.floor(draft.totalFrames / 2) - PROBE_WINDOW / 2), Math.max(0, draft.totalFrames - PROBE_WINDOW)]) {
          const window = measureWindowAlignment(original, format.dataOffset, draft.totalFrames, pcm, start);
          if (window.status === 'shifted') throw new Mp3CompressionError('INCONSISTENT', `O MP3 da faixa ${label} está desalinhado em ${window.lag} amostra(s).`, id);
          if (window.status === 'aligned') aligned++; else inconclusive++;
        }
        alive(id); // last check, immediately before storing
        const stored = store.put({
          id,
          file: new File([encoded.bytes as unknown as BlobPart], `${id}.mp3`, { type: 'audio/mpeg' }), // copies into a Blob
          sizeBytes: encoded.sizeBytes,
          sha256: encoded.sha256,
          sampleRate: encoded.sampleRate,
          frames: encoded.frames,
          alignment: encoded.alignment,
          alignmentEvidence: aligned > 0 ? 'signal' : 'metadata-only',
          alignmentWindows: { aligned, inconclusive },
          source,
          profile,
        });
        if (!stored) throw new Mp3CompressionError('CANCELLED', 'Compressão cancelada.', id);
        report('verifying', 1);
      } catch (reason) {
        if (reason instanceof Mp3CompressionError) throw reason;
        if (signal?.aborted || store.closed || (reason instanceof Mp3EncodingError && reason.code === 'CANCELLED')) throw new Mp3CompressionError('CANCELLED', 'Compressão cancelada.', id);
        throw new Mp3CompressionError('FAILED', `Falha ao comprimir a faixa ${label}: ${reason instanceof Error ? reason.message : String(reason)}`, id);
      }
      await (options.yieldFn ?? tick)();
    }
    alive();

    const entries = CANONICAL_STEM_IDS.map((id) => store.reusable(id, wavFiles[id]!, profile));
    if (entries.some((e) => !e)) throw new Mp3CompressionError('CANCELLED', 'Compressão cancelada.');
    const all = entries as CompressedStemEntry[];
    const first = all[0];
    for (const e of all) {
      if (e.sampleRate !== first.sampleRate || e.frames !== first.frames || e.alignment.mpegAudioFrames !== first.alignment.mpegAudioFrames ||
          e.alignment.encoderDelayFrames !== first.alignment.encoderDelayFrames || e.alignment.paddingFrames !== first.alignment.paddingFrames) {
        throw new Mp3CompressionError('INCONSISTENT', 'As seis faixas comprimidas não têm a mesma linha do tempo.', e.id);
      }
    }
    return buildCompressedDraft(draft, all, decoder, decoderDelayFrames);
  } finally {
    finish();
  }
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
    alignmentEvidence: entries.every((e) => e.alignmentEvidence === 'signal') ? 'signal' : entries.some((e) => e.alignmentEvidence === 'signal') ? 'partial' : 'metadata-only',
    stemsWithoutSignalEvidence: entries.filter((e) => e.alignmentEvidence !== 'signal').map((e) => e.id),
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

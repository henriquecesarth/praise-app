import type { MinistryAudioModel } from './ministry-audio-contract';
import type { MinistryStemFiles } from './ministry-audio-files';
import {
  CANONICAL_STEM_IDS,
  STEM_DISPLAY_LABELS_PT_BR,
  computeSha256Hex,
  parseStrictWavDescriptor,
  type SeparationResult,
} from './separation/demucs-onnx-separator';
import type { SeparatedStemMixerInput } from './separation/six-stem-mixer';

// M22-C.5D-C4-B — the publication draft of a local separation.
//
// The draft owns exactly six validated WAV files (one Blob-backed File per canonical stem). The mixer preview is a
// different consumer with a different lifetime: it reads each file through a deferred loader that hands it a FRESH copy,
// so disposing or replacing the mixer never touches the bytes that are still to be uploaded. The raw separator output
// (Float32 channels + WAV bytes) is NOT retained here: only the Files are.

export class SeparationDraftError extends Error {}

export interface SeparationDraft {
  readonly model: MinistryAudioModel;
  readonly sampleRate: number;
  readonly totalFrames: number;
  readonly disposed: boolean;
  /** The six WAV files, by canonical stem. Throws once the draft was disposed. */
  files(): MinistryStemFiles;
  /** Deferred mixer inputs; each loader returns a new buffer that the mixer may own and discard. */
  mixerInputs(): SeparatedStemMixerInput[];
  /** Drops every reference to the files. Idempotent. */
  dispose(): void;
}

type StemLike = SeparationResult['orderedStems'][number];

/**
 * Builds a draft from a separation result, refusing anything that is not exactly six consistent, intact stems:
 * missing, duplicated or unknown ids, differing rate or length, a WAV whose header disagrees with its descriptor, or
 * bytes whose SHA-256 differs from the one reported. The input order does not matter.
 */
export async function createSeparationDraft(
  result: Pick<SeparationResult, 'descriptor' | 'orderedStems'>,
  signal?: AbortSignal,
): Promise<SeparationDraft> {
  const byId = new Map<string, StemLike>();
  for (const stem of result.orderedStems) {
    if (!(CANONICAL_STEM_IDS as readonly string[]).includes(stem?.id) || byId.has(stem.id)) {
      throw new SeparationDraftError('A separação não devolveu exatamente as seis faixas esperadas.');
    }
    byId.set(stem.id, stem);
  }
  if (byId.size !== CANONICAL_STEM_IDS.length) {
    throw new SeparationDraftError('A separação não devolveu exatamente as seis faixas esperadas.');
  }

  const files: Record<string, File> = {};
  const metrics = new Map<string, { sha256: string; byteLength: number; totalFrames: number; label: string }>();
  let sampleRate = 0;
  let totalFrames = 0;
  for (const id of CANONICAL_STEM_IDS) {
    signal?.throwIfAborted();
    const stem = byId.get(id)!;
    const label = STEM_DISPLAY_LABELS_PT_BR[id];
    const bytes = stem.wavBytes;
    let wav;
    try {
      wav = parseStrictWavDescriptor(bytes);
    } catch {
      throw new SeparationDraftError(`WAV inválido na faixa ${label}.`);
    }
    if (stem.channels !== 2 || wav.channels !== 2 || wav.bitsPerSample !== 16 || stem.byteLength !== bytes.byteLength ||
        wav.sampleRate !== stem.sampleRate || wav.totalFrames !== stem.totalFrames || stem.totalFrames <= 0) {
      throw new SeparationDraftError(`A faixa ${label} é inconsistente com seu descritor.`);
    }
    if (id === CANONICAL_STEM_IDS[0]) {
      sampleRate = stem.sampleRate;
      totalFrames = stem.totalFrames;
    } else if (stem.sampleRate !== sampleRate || stem.totalFrames !== totalFrames) {
      throw new SeparationDraftError('As seis faixas precisam ter a mesma duração e taxa de amostragem.');
    }
    if ((await computeSha256Hex(bytes)) !== stem.sha256) {
      throw new SeparationDraftError(`A faixa ${label} está corrompida (SHA-256 divergente).`);
    }
    // A Blob copies the bytes: the separator output can be released as soon as the draft exists.
    files[id] = new File([bytes as unknown as BlobPart], `${id}.wav`, { type: 'audio/wav' });
    metrics.set(id, { sha256: stem.sha256, byteLength: stem.byteLength, totalFrames: stem.totalFrames, label });
  }
  signal?.throwIfAborted();

  let held: Record<string, File> | null = files;
  const model: MinistryAudioModel = { id: result.descriptor.id, version: result.descriptor.version };
  const own = () => {
    if (!held) throw new SeparationDraftError('O rascunho de publicação foi descartado.');
    return held;
  };
  return {
    model,
    sampleRate,
    totalFrames,
    get disposed() { return held === null; },
    files: () => ({ ...own() }) as MinistryStemFiles,
    mixerInputs: () => CANONICAL_STEM_IDS.map((id) => {
      const file = own()[id];
      const stem = metrics.get(id)!;
      return {
        id,
        labelPtBr: stem.label,
        sampleRate,
        totalFrames: stem.totalFrames,
        byteLength: stem.byteLength,
        sha256: stem.sha256,
        wavBytes: async () => new Uint8Array(await file.arrayBuffer()),
      };
    }),
    dispose: () => { held = null; },
  };
}

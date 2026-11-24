// M22-E1 — turns the song file picked in the local-separation screen into the WAV bytes the Demucs worker already accepts.
// The format is decided from the CONTENT, never from the extension or MIME type. WAV bytes pass through untouched (the worker
// keeps validating them exactly as before); MP3 is decoded in this browser. Nothing is uploaded and the picked file is only read.

import {
  Mp3ImportError,
  importOriginalMp3,
  looksLikeMp3,
  looksLikeWav,
  type OriginalMp3ImportResult,
} from './original-mp3-import';
import { DEFAULT_MAX_AUDIO_SECONDS, MAX_AUDIO_WAV_BYTES } from './separation/demucs-onnx-separator';
import type { Mp3DecodeBackend } from './mp3-stem-decoder';

export type SeparationInputKind = 'wav' | 'mp3';

export interface PreparedSeparationInput {
  readonly kind: SeparationInputKind;
  /** Exclusively owned bytes, safe to transfer to the worker. */
  readonly wavBytes: ArrayBuffer;
  readonly mp3?: Pick<OriginalMp3ImportResult, 'info' | 'frames' | 'sourceChannels'>;
}

export interface PrepareSeparationInputOptions {
  readonly signal?: AbortSignal;
  readonly backend?: Mp3DecodeBackend | null;
  /** Called once, only when MP3 decoding actually starts. */
  readonly onDecoding?: () => void;
}

export async function prepareSeparationInput(file: File, options: PrepareSeparationInputOptions = {}): Promise<PreparedSeparationInput> {
  const { signal } = options;
  if (file.size <= 0) throw new Mp3ImportError('EMPTY', 'O arquivo está vazio.');
  // The largest accepted input is the WAV ceiling; MP3 has its own, tighter ceiling checked on the structure.
  if (file.size > MAX_AUDIO_WAV_BYTES) {
    throw new Mp3ImportError('TOO_LARGE', `O arquivo precisa ter até ${MAX_AUDIO_WAV_BYTES / (1024 * 1024)} MiB (WAV) ou 24 MiB (MP3), com até ${DEFAULT_MAX_AUDIO_SECONDS} segundos.`);
  }
  const bytes = await file.arrayBuffer();
  if (signal?.aborted) throw new Mp3ImportError('CANCELLED', 'Importação cancelada.');
  const head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 16));
  if (looksLikeWav(head)) return { kind: 'wav', wavBytes: bytes };
  if (looksLikeMp3(head)) {
    options.onDecoding?.();
    const result = await importOriginalMp3(bytes, { signal, backend: options.backend });
    return { kind: 'mp3', wavBytes: result.wavBytes, mp3: { info: result.info, frames: result.frames, sourceChannels: result.sourceChannels } };
  }
  throw new Mp3ImportError('NOT_MP3', 'Formato não reconhecido. Selecione um arquivo MP3 ou WAV válido.');
}

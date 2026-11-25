import { Mp3EncodingError } from './mp3-info-frame';
import type { Mp3EncoderBackend } from './mp3-stem-encoder';

// M22-S1/S2 (experimental): LAME 3.100 (LGPL-2.0, compiled to WebAssembly) through wasm-media-encoders 0.7.0 (MIT wrapper).
// Loaded lazily so nothing is added to any bundle that does not use compression.
//
// The WASM binary is a SEPARATE FILE (`wasm-media-encoders/wasm/mp3.wasm`, served as its own asset) that the Worker fetches
// and instantiates. Its size and SHA-256 are pinned below: a different binary (for example a rebuilt or replaced LAME,
// which is how the LGPL lets a user swap the library) is refused until the pin is updated on purpose, after review.
// See docs/architecture/m22s1-local-mp3-stem-encoding.md and THIRD_PARTY_NOTICES/lame-wasm.md.

export const LAME_WASM_BYTES = 132_999;
export const LAME_WASM_SHA256 = '85e81719250b9a667b1258143f689dda70e3e57a7e7c29ab0b4cef65c8f6eb9a';

export interface LameBackendOptions {
  /** URL of the separate mp3.wasm asset. Production code always passes it. */
  readonly wasmUrl?: string;
  /** Already-loaded binary (tests, or a caller that cached it). Takes precedence over `wasmUrl`. */
  readonly wasmBytes?: ArrayBuffer | Uint8Array;
  readonly signal?: AbortSignal;
  /**
   * Replacement binary (LGPL substitution mechanism): the expected SHA-256 (and optionally size) of a rebuilt or updated LAME.
   * Defaults to the pinned binary. Set at build time by the application, never by user input.
   */
  readonly expected?: { readonly sha256: string; readonly bytes?: number };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function loadPinnedWasm(options: LameBackendOptions): Promise<Uint8Array> {
  let bytes: Uint8Array;
  if (options.wasmBytes) {
    bytes = options.wasmBytes instanceof Uint8Array ? options.wasmBytes : new Uint8Array(options.wasmBytes);
  } else {
    let response: Response;
    try {
      response = await fetch(options.wasmUrl!, { credentials: 'same-origin', redirect: 'error', signal: options.signal });
    } catch (reason) {
      if (options.signal?.aborted) throw new Mp3EncodingError('CANCELLED', 'Compressão cancelada.');
      throw new Mp3EncodingError('ENCODER_FAILED', `Não foi possível carregar o codificador MP3: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
    if (!response.ok) throw new Mp3EncodingError('ENCODER_FAILED', `Codificador MP3 indisponível (HTTP ${response.status}).`);
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  const expectedSha = options.expected?.sha256 ?? LAME_WASM_SHA256;
  const expectedBytes = options.expected ? options.expected.bytes : LAME_WASM_BYTES;
  if ((expectedBytes !== undefined && bytes.byteLength !== expectedBytes) || (await sha256Hex(bytes)) !== expectedSha) {
    throw new Mp3EncodingError('ENCODER_FAILED', 'O binário do codificador MP3 não é o esperado (tamanho/SHA-256).');
  }
  return bytes;
}

type WasmEncoder = {
  configure(params: { sampleRate: number; channels: 1 | 2; bitrate: 256 }): void;
  encode(samples: readonly Float32Array[]): Uint8Array;
  finalize(): Uint8Array;
};

export async function createLameWasmBackend(options: LameBackendOptions = {}): Promise<Mp3EncoderBackend> {
  const lib = await import('wasm-media-encoders');
  let encoder: WasmEncoder;
  if (options.wasmBytes || options.wasmUrl) {
    encoder = await lib.createEncoder('audio/mpeg', await loadPinnedWasm(options));
  } else {
    encoder = await lib.createMp3Encoder(); // package-inlined binary: unit tests only
  }
  let configured = false;
  return {
    configure(sampleRate: number) {
      encoder.configure({ sampleRate, channels: 2, bitrate: 256 });
      configured = true;
    },
    encode(left: Float32Array, right: Float32Array) {
      if (!configured) throw new Error('Encoder not configured.');
      return encoder.encode([left, right]);
    },
    finalize() {
      return encoder.finalize();
    },
  };
}

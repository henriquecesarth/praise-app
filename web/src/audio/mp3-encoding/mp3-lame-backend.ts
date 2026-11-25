import type { Mp3EncoderBackend } from './mp3-stem-encoder';

// M22-S1 (experimental): LAME 3.100 (LGPL-2.0, compiled to WebAssembly) through wasm-media-encoders 0.7.0 (MIT wrapper).
// Loaded lazily so nothing is added to any bundle that does not use compression. The WASM binary is inlined by the
// package; it is a separate WebAssembly module, replaceable without relinking the application code.

export async function createLameWasmBackend(): Promise<Mp3EncoderBackend> {
  const { createMp3Encoder } = await import('wasm-media-encoders');
  const encoder = await createMp3Encoder();
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

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeSha256Hex, encodeStereoPcm16Wav } from '../separation/demucs-onnx-separator';
import { LAME_WASM_BYTES, LAME_WASM_SHA256, createLameWasmBackend } from './mp3-lame-backend';
import { encodeWavStemToMp3 } from './mp3-stem-encoder';

// M22-S2: the LAME binary is a separate, pinned file. A different binary is refused until the pin is changed on purpose.

const wasmPath = createRequire(import.meta.url).resolve('wasm-media-encoders/wasm/mp3');
const realWasm = () => new Uint8Array(readFileSync(wasmPath));
const wav = () => {
  const frames = 30_000;
  const left = Float32Array.from({ length: frames }, (_, i) => 0.4 * Math.sin(i * 0.03));
  const right = Float32Array.from({ length: frames }, (_, i) => 0.3 * Math.sin(i * 0.05));
  return encodeStereoPcm16Wav({ sampleRate: 44_100, left, right });
};

afterEach(() => vi.unstubAllGlobals());

describe('externalised, pinned LAME WebAssembly binary', () => {
  it('the installed package ships exactly the pinned binary (an upgrade must update the pin and the notices)', async () => {
    const bytes = realWasm();
    expect(bytes.byteLength).toBe(LAME_WASM_BYTES);
    expect(await computeSha256Hex(bytes)).toBe(LAME_WASM_SHA256);
  });

  it('encodes with the separate binary and produces the same bytes as the package-inlined one', async () => {
    const input = wav();
    const external = await encodeWavStemToMp3(input, { backend: await createLameWasmBackend({ wasmBytes: realWasm() }), decoderDelayFrames: 529 });
    const inlined = await encodeWavStemToMp3(input, { backend: await createLameWasmBackend(), decoderDelayFrames: 529 });
    expect(external.sha256).toBe(inlined.sha256);
  });

  it('loads the binary from a URL (fetch) and verifies it before instantiating', async () => {
    const fetchMock = vi.fn(async () => new Response(realWasm()));
    vi.stubGlobal('fetch', fetchMock);
    const backend = await createLameWasmBackend({ wasmUrl: '/assets/mp3.wasm' });
    expect(fetchMock).toHaveBeenCalledWith('/assets/mp3.wasm', expect.objectContaining({ redirect: 'error', credentials: 'same-origin' }));
    expect(typeof backend.encode).toBe('function');
  });

  it('accepts a deliberately substituted binary only with its own expected SHA-256 (LGPL replacement mechanism)', async () => {
    const rebuilt = realWasm();
    const sha = await computeSha256Hex(rebuilt);
    await expect(createLameWasmBackend({ wasmBytes: rebuilt, expected: { sha256: '0'.repeat(64) } })).rejects.toMatchObject({ code: 'ENCODER_FAILED' });
    await expect(createLameWasmBackend({ wasmBytes: rebuilt, expected: { sha256: sha } })).resolves.toBeDefined();
    await expect(createLameWasmBackend({ wasmBytes: rebuilt, expected: { sha256: sha, bytes: 1 } })).rejects.toMatchObject({ code: 'ENCODER_FAILED' });
  });

  it('refuses a replaced, truncated or corrupted binary, and HTTP errors, fail-closed', async () => {
    const good = realWasm();
    const flipped = good.slice(); flipped[1000] ^= 1;
    await expect(createLameWasmBackend({ wasmBytes: flipped })).rejects.toMatchObject({ code: 'ENCODER_FAILED' });
    await expect(createLameWasmBackend({ wasmBytes: good.slice(0, good.length - 1) })).rejects.toMatchObject({ code: 'ENCODER_FAILED' });
    await expect(createLameWasmBackend({ wasmBytes: new TextEncoder().encode('<html>not wasm</html>') })).rejects.toMatchObject({ code: 'ENCODER_FAILED' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    await expect(createLameWasmBackend({ wasmUrl: '/x.wasm' })).rejects.toMatchObject({ code: 'ENCODER_FAILED', message: expect.stringContaining('404') });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    await expect(createLameWasmBackend({ wasmUrl: '/x.wasm' })).rejects.toMatchObject({ code: 'ENCODER_FAILED' });
    const abort = new AbortController();
    abort.abort();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('aborted', 'AbortError'); }));
    await expect(createLameWasmBackend({ wasmUrl: '/x.wasm', signal: abort.signal })).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});

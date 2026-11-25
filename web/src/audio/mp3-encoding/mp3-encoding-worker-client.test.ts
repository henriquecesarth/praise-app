import { describe, expect, it, vi } from 'vitest';
import { computeSha256Hex } from '../separation/demucs-onnx-separator';
import { Mp3EncodingWorkerClient, type Mp3WorkerLike } from './mp3-encoding-worker-client';
import type { Mp3WorkerRequest, Mp3WorkerResponse } from './mp3-encoding-protocol';

class FakeWorker implements Mp3WorkerLike {
  onmessage: ((event: MessageEvent<Mp3WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = 0;
  requests: Mp3WorkerRequest[] = [];
  postMessage(message: Mp3WorkerRequest) { this.requests.push(message); }
  terminate() { this.terminated++; }
  reply(message: Mp3WorkerResponse) { this.onmessage?.({ data: message } as MessageEvent<Mp3WorkerResponse>); }
}

const meta = (bytes: Uint8Array, sha256: string) => ({
  sha256, sampleRate: 44100 as const, frames: 100, sizeBytes: bytes.length,
  alignment: { encoderDelayFrames: 1105, paddingFrames: 100, mpegAudioFrames: 2, infoFrame: true as const },
  tag: { encoder: 'LAME3.100', delayFrames: 576, paddingFrames: 629 },
  stats: { encodeMs: 1, wavBytes: 400, mp3Bytes: bytes.length, slices: 1 },
});

function setup() {
  const worker = new FakeWorker();
  const client = new Mp3EncodingWorkerClient(() => worker);
  return { worker, client };
}

describe('Mp3EncodingWorkerClient', () => {
  it('transfers the WAV, forwards progress and resolves only after verifying size and SHA-256', async () => {
    const { worker, client } = setup();
    const onProgress = vi.fn();
    const wav = new ArrayBuffer(400);
    const pending = client.encodeStem({ wav, decoderDelayFrames: 529, onProgress });
    expect(worker.requests[0]).toMatchObject({ type: 'encode', jobId: 1, decoderDelayFrames: 529 });
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    worker.reply({ type: 'progress', jobId: 1, fraction: 0.5 });
    worker.reply({ type: 'done', jobId: 1, mp3Buffer: bytes.buffer.slice(0), meta: meta(bytes, await computeSha256Hex(bytes)) });
    const result = await pending;
    expect(onProgress).toHaveBeenCalledWith(0.5);
    expect(Array.from(result.bytes)).toEqual([1, 2, 3, 4, 5]);
    expect(worker.terminated).toBe(1); // the Worker (and its WASM memory) is released after every job
  });

  it('rejects a corrupted or inconsistent result (SHA-256, size) and releases the Worker', async () => {
    for (const mutate of ['sha', 'size'] as const) {
      const { worker, client } = setup();
      const pending = client.encodeStem({ wav: new ArrayBuffer(8), decoderDelayFrames: 529 });
      const bytes = new Uint8Array([9, 9, 9]);
      const good = await computeSha256Hex(bytes);
      const m = meta(bytes, mutate === 'sha' ? '0'.repeat(64) : good);
      if (mutate === 'size') m.sizeBytes = 99;
      worker.reply({ type: 'done', jobId: 1, mp3Buffer: bytes.buffer.slice(0), meta: m });
      await expect(pending).rejects.toMatchObject({ code: 'INVALID_STREAM' });
      expect(worker.terminated).toBe(1);
    }
  });

  it('maps Worker error messages and Worker crashes', async () => {
    const a = setup();
    const p1 = a.client.encodeStem({ wav: new ArrayBuffer(8), decoderDelayFrames: 529 });
    a.worker.reply({ type: 'error', jobId: 1, code: 'OUT_OF_MEMORY', message: 'sem memória' });
    await expect(p1).rejects.toMatchObject({ code: 'OUT_OF_MEMORY' });
    const b = setup();
    const p2 = b.client.encodeStem({ wav: new ArrayBuffer(8), decoderDelayFrames: 529 });
    b.worker.onerror?.({} as ErrorEvent);
    await expect(p2).rejects.toMatchObject({ code: 'ENCODER_FAILED' });
    expect(b.worker.terminated).toBe(1);
  });

  it('cancels at once by terminating the Worker, and ignores its late reply', async () => {
    const { worker, client } = setup();
    const abort = new AbortController();
    const pending = client.encodeStem({ wav: new ArrayBuffer(8), decoderDelayFrames: 529, signal: abort.signal });
    abort.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(worker.terminated).toBe(1);
    const bytes = new Uint8Array([1]);
    worker.reply({ type: 'done', jobId: 1, mp3Buffer: bytes.buffer, meta: meta(bytes, await computeSha256Hex(bytes)) }); // no throw, no effect
    await expect(client.encodeStem({ wav: new ArrayBuffer(8), decoderDelayFrames: 529, signal: abort.signal })).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('allows one job at a time and ignores replies for other job ids', async () => {
    const { worker, client } = setup();
    const first = client.encodeStem({ wav: new ArrayBuffer(8), decoderDelayFrames: 529 });
    await expect(client.encodeStem({ wav: new ArrayBuffer(8), decoderDelayFrames: 529 })).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    worker.reply({ type: 'error', jobId: 99, code: 'ENCODER_FAILED', message: 'stale' });
    worker.reply({ type: 'error', jobId: 1, code: 'ENCODER_FAILED', message: 'real' });
    await expect(first).rejects.toMatchObject({ message: 'real' });
  });

  it('dispose terminates an active Worker', () => {
    const { worker, client } = setup();
    void client.encodeStem({ wav: new ArrayBuffer(8), decoderDelayFrames: 529 }).catch(() => {});
    client.dispose();
    expect(worker.terminated).toBe(1);
  });
});

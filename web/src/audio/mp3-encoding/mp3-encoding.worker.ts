/// <reference lib="webworker" />
import { createLameWasmBackend } from './mp3-lame-backend';
import { Mp3EncodingError } from './mp3-info-frame';
import { encodeWavStemToMp3 } from './mp3-stem-encoder';
import type { Mp3WorkerRequest, Mp3WorkerResponse } from './mp3-encoding-protocol';

// M22-S1 (experimental): encodes ONE stem per job off the main thread. A `cancel` message is observed between slices
// because the encoder yields to this Worker's event loop; the input buffer is dropped as soon as the job ends.

const scope = self as unknown as DedicatedWorkerGlobalScope;
const cancelled = new Set<number>();
const post = (message: Mp3WorkerResponse, transfer: Transferable[] = []) => scope.postMessage(message, transfer);
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

scope.onmessage = async (event: MessageEvent<Mp3WorkerRequest>) => {
  const message = event.data;
  if (message?.type === 'cancel') { cancelled.add(message.jobId); return; }
  if (message?.type !== 'encode') return;
  const { jobId } = message;
  try {
    const backend = await createLameWasmBackend();
    const wav = new Uint8Array(message.wavBuffer);
    const totalSlices = Math.max(1, Math.ceil(wav.byteLength / 4 / (1152 * 64)));
    let seen = 0;
    const encoded = await encodeWavStemToMp3(wav, {
      backend,
      decoderDelayFrames: message.decoderDelayFrames,
      isCancelled: () => cancelled.has(jobId),
      yieldFn: async () => { seen += 4; post({ type: 'progress', jobId, fraction: Math.min(0.99, seen / totalSlices) }); await tick(); },
    });
    const { bytes, ...meta } = encoded;
    // Copy only when the result is a view over a larger buffer; the common case transfers without copying.
    const out = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer as ArrayBuffer : bytes.slice().buffer;
    post({ type: 'done', jobId, mp3Buffer: out, meta }, [out]);
  } catch (reason) {
    const code = reason instanceof Mp3EncodingError ? reason.code : 'ENCODER_FAILED';
    post({ type: 'error', jobId, code, message: reason instanceof Error ? reason.message : 'Falha ao comprimir a faixa.' });
  } finally {
    cancelled.delete(jobId);
  }
};

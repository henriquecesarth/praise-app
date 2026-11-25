import { Mp3EncodingError } from './mp3-info-frame';
import type { Mp3WorkerRequest, Mp3WorkerResponse } from './mp3-encoding-protocol';
import type { EncodedMp3Stem } from './mp3-stem-encoder';

// M22-S1 (experimental, not used by any screen): runs one stem encode at a time in a dedicated Worker. Cancelling or
// disposing TERMINATES the Worker, which releases the WebAssembly memory immediately; a late response from a
// terminated or older job is ignored. The result is verified here (size, SHA-256) before it is handed out.

export interface Mp3WorkerLike {
  postMessage(message: Mp3WorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<Mp3WorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export interface EncodeStemJob {
  readonly wav: ArrayBuffer;
  readonly decoderDelayFrames: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (fraction: number) => void;
}

const defaultFactory = (): Mp3WorkerLike =>
  new Worker(new URL('./mp3-encoding.worker.ts', import.meta.url), { type: 'module' }) as unknown as Mp3WorkerLike;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export class Mp3EncodingWorkerClient {
  private worker: Mp3WorkerLike | null = null;
  private nextJob = 1;
  private busy = false;

  constructor(private readonly factory: () => Mp3WorkerLike = defaultFactory) {}

  private release(): void {
    const w = this.worker;
    this.worker = null;
    if (w) { w.onmessage = null; w.onerror = null; w.terminate(); }
  }

  dispose(): void { this.release(); }

  encodeStem(job: EncodeStemJob): Promise<EncodedMp3Stem> {
    if (this.busy) return Promise.reject(new Mp3EncodingError('UNSUPPORTED', 'Já existe uma compressão em andamento.'));
    if (job.signal?.aborted) return Promise.reject(new Mp3EncodingError('CANCELLED', 'Compressão cancelada.'));
    this.busy = true;
    const jobId = this.nextJob++;
    return new Promise<EncodedMp3Stem>((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void, terminate: boolean) => {
        if (settled) return;
        settled = true;
        job.signal?.removeEventListener('abort', onAbort);
        this.busy = false;
        if (terminate) this.release();
        action();
      };
      const onAbort = () => finish(() => reject(new Mp3EncodingError('CANCELLED', 'Compressão cancelada.')), true);
      job.signal?.addEventListener('abort', onAbort, { once: true });
      let worker: Mp3WorkerLike;
      try {
        worker = this.factory();
      } catch (reason) {
        finish(() => reject(new Mp3EncodingError('ENCODER_FAILED', `Não foi possível iniciar o Worker: ${reason instanceof Error ? reason.message : String(reason)}`)), false);
        return;
      }
      this.worker = worker;
      worker.onerror = () => finish(() => reject(new Mp3EncodingError('ENCODER_FAILED', 'O Worker de compressão falhou.')), true);
      worker.onmessage = (event) => {
        const message = event.data;
        if (!message || message.jobId !== jobId) return; // another or an old job: ignored
        if (message.type === 'progress') { if (!settled) job.onProgress?.(message.fraction); return; }
        if (message.type === 'error') { finish(() => reject(new Mp3EncodingError(message.code, message.message)), true); return; }
        if (message.type !== 'done') return;
        const { mp3Buffer, meta } = message;
        void (async () => {
          try {
            if (!(mp3Buffer instanceof ArrayBuffer) || mp3Buffer.byteLength !== meta.sizeBytes || meta.sizeBytes <= 0) {
              throw new Mp3EncodingError('INVALID_STREAM', 'Resposta do Worker inconsistente (tamanho).');
            }
            const bytes = new Uint8Array(mp3Buffer);
            if ((await sha256Hex(bytes)) !== meta.sha256) throw new Mp3EncodingError('INVALID_STREAM', 'SHA-256 do MP3 diverge do informado pelo Worker.');
            if (settled) return; // cancelled while hashing
            finish(() => resolve({ ...meta, bytes }), true);
          } catch (reason) {
            finish(() => reject(reason), true);
          }
        })();
      };
      worker.postMessage({ type: 'encode', jobId, wavBuffer: job.wav, decoderDelayFrames: job.decoderDelayFrames }, [job.wav]);
    });
  }
}

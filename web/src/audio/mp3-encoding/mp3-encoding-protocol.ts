import type { EncodedMp3Stem } from './mp3-stem-encoder';
import type { Mp3EncodingError } from './mp3-info-frame';

// M22-S1 (experimental): message contract between the main thread and the MP3 encoding Worker. One stem per job.

export interface Mp3WorkerEncodeRequest {
  type: 'encode';
  jobId: number;
  /** The stem WAV. Transferred to the Worker (the caller passes a copy when it must keep the original). */
  wavBuffer: ArrayBuffer;
  decoderDelayFrames: number;
}
export interface Mp3WorkerCancelRequest { type: 'cancel'; jobId: number }
export type Mp3WorkerRequest = Mp3WorkerEncodeRequest | Mp3WorkerCancelRequest;

export type Mp3WorkerResponse =
  | { type: 'progress'; jobId: number; fraction: number }
  | { type: 'done'; jobId: number; mp3Buffer: ArrayBuffer; meta: Omit<EncodedMp3Stem, 'bytes'> }
  | { type: 'error'; jobId: number; code: Mp3EncodingError['code']; message: string };

import type {
  AudioSeparationErrorCode,
  AudioSeparationModelDescriptor,
  CanonicalStemId,
  ExecutionProviderName,
  OnnxModelSource,
  SeparationProgressEvent,
  SeparationTelemetryMetrics,
} from './demucs-onnx-separator';

export interface DemucsWorkerRunRequest {
  type: 'run_separation';
  jobId: string;
  descriptor: AudioSeparationModelDescriptor;
  modelSource: OnnxModelSource;
  audioWavBytes: ArrayBuffer;
  wasmPaths?: string;
  preferredProviders: readonly ExecutionProviderName[];
  numThreads?: number;
  verifyModelChecksum?: boolean;
  useModelBytesCache?: boolean;
  reuseWarmSession?: boolean;
}

export interface DemucsWorkerCancelRequest {
  type: 'cancel_job';
  jobId: string;
}

export interface DemucsWorkerClearCacheRequest {
  type: 'clear_cache';
  requestId: string;
}

export interface DemucsWorkerDisposeRequest {
  type: 'dispose_worker';
  requestId: string;
}

export type DemucsWorkerRequest =
  | DemucsWorkerRunRequest
  | DemucsWorkerCancelRequest
  | DemucsWorkerClearCacheRequest
  | DemucsWorkerDisposeRequest;

export interface TransferredStemPayload {
  id: CanonicalStemId;
  labelPtBr: string;
  sampleRate: number;
  channels: 2;
  totalFrames: number;
  leftBuffer: ArrayBuffer;
  rightBuffer: ArrayBuffer;
  wavBuffer: ArrayBuffer;
  byteLength: number;
  sha256: string;
  rms: number;
  peak: number;
}

export interface DemucsWorkerProgressResponse {
  type: 'progress';
  jobId: string;
  event: SeparationProgressEvent;
}

export interface DemucsWorkerCompletedResponse {
  type: 'completed';
  jobId: string;
  descriptor: AudioSeparationModelDescriptor;
  telemetry: SeparationTelemetryMetrics;
  orderedStems: readonly TransferredStemPayload[];
}

export interface DemucsWorkerErrorResponse {
  type: 'error';
  jobId: string;
  code: AudioSeparationErrorCode;
  message: string;
}

export interface DemucsWorkerCacheClearedResponse {
  type: 'cache_cleared';
  requestId: string;
}

export interface DemucsWorkerDisposedResponse {
  type: 'disposed';
  requestId: string;
}

export type DemucsWorkerResponse =
  | DemucsWorkerProgressResponse
  | DemucsWorkerCompletedResponse
  | DemucsWorkerErrorResponse
  | DemucsWorkerCacheClearedResponse
  | DemucsWorkerDisposedResponse;

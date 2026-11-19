import {
  AudioSeparationError,
  CANONICAL_STEM_IDS,
  DEFAULT_MAX_AUDIO_SECONDS,
  HTDEMUCS_6S_ONNX_DESCRIPTOR,
  MAX_AUDIO_WAV_BYTES,
  MAX_MODEL_BYTES,
  MAX_SEPARATION_TOTAL_FRAMES,
  computeSha256Hex,
  descriptorsMatchContract,
  parseStrictWavDescriptor,
  snapshotModelDescriptor,
  type AudioSeparationModelDescriptor,
  type CanonicalStemId,
  type ExecutionProviderName,
  type OnnxModelSource,
  type SeparatedStemOutput,
  type SeparationProgressEvent,
  type SeparationResult,
} from './demucs-onnx-separator';
import type {
  DemucsWorkerCompletedResponse,
  DemucsWorkerRequest,
  DemucsWorkerResponse,
} from './demucs-worker-protocol';

export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  addEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: (event: Event) => void
  ): void;
  removeEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: (event: Event) => void
  ): void;
}

export interface DemucsSeparationWorkerClientOptions {
  createWorker?: () => WorkerLike;
  terminateOnCancel?: boolean;
}

export interface SeparateInWorkerOptions {
  descriptor?: AudioSeparationModelDescriptor;
  modelSource: OnnxModelSource;
  audioWavBytes: Uint8Array | ArrayBuffer;
  wasmPaths?: string;
  preferredProviders?: readonly ExecutionProviderName[];
  numThreads?: number;
  verifyModelChecksum?: boolean;
  useModelBytesCache?: boolean;
  reuseWarmSession?: boolean;
  transferInputBuffer?: boolean;
  signal?: AbortSignal;
  onProgress?: (event: SeparationProgressEvent) => void;
}

interface ActiveWorkerJob {
  jobId: string;
  descriptor: AudioSeparationModelDescriptor;
  requestedPreferredProviders: readonly ExecutionProviderName[];
  expectedTotalFrames: number;
  expectedOverlapSamples: number;
  onProgress?: (event: SeparationProgressEvent) => void;
  resolve: (result: SeparationResult) => void;
  reject: (err: unknown) => void;
  cleanupAbortListener: () => void;
  cancelling: boolean;
  settled: boolean;
}

function defaultCreateWorker(): WorkerLike {
  return new Worker(new URL('./demucs-separation.worker.ts', import.meta.url), {
    type: 'module',
  });
}

function resolveWorkerUrl(pathOrUrl: string): string {
  const trimmed = pathOrUrl.trim();
  if (!trimmed) {
    return trimmed;
  }
  const hasLocation =
    typeof globalThis !== 'undefined' &&
    'location' in globalThis &&
    globalThis.location;
  const href =
    hasLocation &&
    typeof globalThis.location.href === 'string' &&
    globalThis.location.href !== 'about:blank' &&
    !globalThis.location.href.startsWith('data:')
      ? globalThis.location.href
      : '';
  if (href && !href.startsWith('null')) {
    try {
      return new URL(trimmed, href).href;
    } catch {
      // Fall back to origin/raw resolution below.
    }
  }
  const origin =
    hasLocation &&
    typeof globalThis.location.origin === 'string' &&
    globalThis.location.origin !== 'null'
      ? globalThis.location.origin
      : '';
  if (origin && trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return `${origin}${trimmed}`;
  }
  return trimmed;
}

function cloneToOwnedArrayBuffer(bytes: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) {
    return bytes.slice(0);
  }
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return out.buffer;
}

export class DemucsSeparationWorkerClient {
  private readonly createWorkerFn: () => WorkerLike;
  private readonly terminateOnCancel: boolean;

  private worker: WorkerLike | null = null;
  private workerOrtConfig: { wasmPaths?: string; numThreadsKey: string } | null =
    null;
  private activeJob: ActiveWorkerJob | null = null;
  private pendingControlResolvers = new Map<
    string,
    { resolve: () => void; reject: (err: unknown) => void }
  >();
  private disposed = false;
  private seq = 0;

  constructor(options?: DemucsSeparationWorkerClientOptions) {
    this.createWorkerFn = options?.createWorker ?? defaultCreateWorker;
    this.terminateOnCancel = options?.terminateOnCancel ?? true;
  }

  private readonly handleMessage = (rawEvent: Event): void => {
    const msg = (rawEvent as MessageEvent<DemucsWorkerResponse>).data;
    if (!msg || typeof msg !== 'object') {
      return;
    }

    if (msg.type === 'cache_cleared' || msg.type === 'disposed') {
      const pending = this.pendingControlResolvers.get(msg.requestId);
      if (pending) {
        this.pendingControlResolvers.delete(msg.requestId);
        pending.resolve();
      }
      return;
    }

    if (msg.type === 'error') {
      const pendingCtrl = this.pendingControlResolvers.get(msg.jobId);
      if (pendingCtrl) {
        this.pendingControlResolvers.delete(msg.jobId);
        pendingCtrl.reject(new AudioSeparationError(msg.code, msg.message));
        return;
      }
    }

    const job = this.activeJob;
    if (!job || job.settled || msg.jobId !== job.jobId) {
      return;
    }

    if (msg.type === 'progress') {
      if (!job.cancelling) {
        job.onProgress?.(msg.event);
      }
      return;
    }

    if (msg.type === 'error') {
      if (msg.code === 'MODEL_LOAD_FAILED') {
        // ORT cannot retry a failed WASM initialization in this worker context.
        this.terminateWorkerInstance();
      }
      if (job.cancelling) {
        this.finishActiveJobWithError(
          new AudioSeparationError('CANCELLED', 'Audio separation was cancelled.')
        );
        return;
      }
      this.finishActiveJobWithError(
        new AudioSeparationError(msg.code, msg.message)
      );
      return;
    }

    if (msg.type === 'completed') {
      if (job.cancelling) {
        this.finishActiveJobWithError(
          new AudioSeparationError('CANCELLED', 'Audio separation was cancelled.')
        );
        return;
      }
      void this.verifyAndResolveCompleted(job, msg);
    }
  };

  private readonly handleWorkerError = (rawEvent: Event): void => {
    const errEvt = rawEvent as ErrorEvent;
    const message =
      errEvt?.message || 'Unexpected worker execution failure during separation.';
    this.terminateWorkerInstance();
    this.rejectAllPendingControls(
      new AudioSeparationError('WORKER_ERROR', message)
    );
    if (this.activeJob && !this.activeJob.settled) {
      this.finishActiveJobWithError(
        new AudioSeparationError('WORKER_ERROR', message)
      );
    }
  };

  private readonly handleWorkerMessageError = (): void => {
    this.terminateWorkerInstance();
    this.rejectAllPendingControls(
      new AudioSeparationError(
        'WORKER_ERROR',
        'Worker message deserialization failed.'
      )
    );
    if (this.activeJob && !this.activeJob.settled) {
      this.finishActiveJobWithError(
        new AudioSeparationError(
          'WORKER_ERROR',
          'Worker message deserialization failed.'
        )
      );
    }
  };

  private ensureWorker(): WorkerLike {
    if (this.disposed) {
      throw new AudioSeparationError(
        'WORKER_DISPOSED',
        'DemucsSeparationWorkerClient has been disposed.'
      );
    }
    if (this.worker) {
      return this.worker;
    }
    const created = this.createWorkerFn();
    created.addEventListener('message', this.handleMessage);
    created.addEventListener('error', this.handleWorkerError);
    created.addEventListener('messageerror', this.handleWorkerMessageError);
    this.worker = created;
    return created;
  }

  private terminateWorkerInstance(controlRejectErr?: unknown): void {
    const existing = this.worker;
    this.worker = null;
    this.workerOrtConfig = null;
    if (controlRejectErr !== undefined) {
      this.rejectAllPendingControls(controlRejectErr);
    }
    if (!existing) {
      return;
    }
    existing.removeEventListener('message', this.handleMessage);
    existing.removeEventListener('error', this.handleWorkerError);
    existing.removeEventListener('messageerror', this.handleWorkerMessageError);
    try {
      existing.terminate();
    } catch {
      // Ignore worker termination errors.
    }
  }

  private rejectAllPendingControls(err: unknown): void {
    for (const [id, pending] of this.pendingControlResolvers.entries()) {
      this.pendingControlResolvers.delete(id);
      pending.reject(err);
    }
  }

  private finishActiveJobWithError(err: unknown): void {
    const job = this.activeJob;
    if (!job || job.settled) {
      return;
    }
    job.settled = true;
    job.cleanupAbortListener();
    this.activeJob = null;
    job.reject(err);
  }

  private async verifyAndResolveCompleted(
    job: ActiveWorkerJob,
    msg: DemucsWorkerCompletedResponse
  ): Promise<void> {
    try {
      const returnedDescriptor = snapshotModelDescriptor(msg.descriptor);
      if (!descriptorsMatchContract(returnedDescriptor, job.descriptor)) {
        throw new AudioSeparationError(
          'INFERENCE_FAILED',
          'Worker returned separation result with mismatched model descriptor.'
        );
      }

      const telemetry = msg.telemetry;
      if (!telemetry || typeof telemetry !== 'object') {
        throw new AudioSeparationError(
          'INFERENCE_FAILED',
          'Worker returned missing separation telemetry.'
        );
      }
      if (
        telemetry.modelId !== job.descriptor.id ||
        telemetry.modelVersion !== job.descriptor.version
      ) {
        throw new AudioSeparationError(
          'INFERENCE_FAILED',
          'Worker telemetry model identity does not match requested descriptor.'
        );
      }
      if (
        job.descriptor.expectedModelBytes !== undefined &&
        telemetry.modelBytes !== job.descriptor.expectedModelBytes
      ) {
        throw new AudioSeparationError(
          'INFERENCE_FAILED',
          'Worker telemetry modelBytes mismatch.'
        );
      }
      if (
        job.descriptor.expectedModelSha256 !== undefined &&
        (telemetry.modelChecksumVerified !== true ||
          typeof telemetry.modelSha256 !== 'string' ||
          telemetry.modelSha256.toLowerCase() !==
            job.descriptor.expectedModelSha256.toLowerCase())
      ) {
        throw new AudioSeparationError(
          'INFERENCE_FAILED',
          'Worker telemetry missing verified expected SHA-256 attestation.'
        );
      }
      if (
        (telemetry.executionProvider !== 'wasm' &&
          telemetry.executionProvider !== 'webgpu') ||
        !job.requestedPreferredProviders.includes(telemetry.executionProvider)
      ) {
        throw new AudioSeparationError(
          'INFERENCE_FAILED',
          `Worker executionProvider "${String(telemetry.executionProvider)}" violates requested providers [${job.requestedPreferredProviders.join(', ')}].`
        );
      }
      if (
        !Number.isFinite(telemetry.modelLoadMs) ||
        telemetry.modelLoadMs < 0 ||
        !Number.isFinite(telemetry.inferenceMs) ||
        telemetry.inferenceMs < 0 ||
        !Number.isFinite(telemetry.encodeMs) ||
        telemetry.encodeMs < 0 ||
        !Number.isFinite(telemetry.totalWallMs) ||
        telemetry.totalWallMs < 0 ||
        !Number.isFinite(telemetry.rtf) ||
        telemetry.rtf < 0 ||
        !Number.isFinite(telemetry.reconstructionMaxAbsError) ||
        telemetry.reconstructionMaxAbsError < 0 ||
        telemetry.totalFrames !== job.expectedTotalFrames ||
        telemetry.sampleRate !== job.descriptor.sampleRate ||
        telemetry.segmentSamples !== job.descriptor.segmentSamples ||
        telemetry.overlapSamples !== job.expectedOverlapSamples
      ) {
        throw new AudioSeparationError(
          'INFERENCE_FAILED',
          'Worker returned invalid or non-finite telemetry metrics.'
        );
      }

      if (
        !Array.isArray(msg.orderedStems as unknown) ||
        msg.orderedStems.length !== CANONICAL_STEM_IDS.length
      ) {
        throw new AudioSeparationError(
          'INFERENCE_FAILED',
          'Worker did not return all 6 canonical stems.'
        );
      }

      const stemsRecord = {} as Record<CanonicalStemId, SeparatedStemOutput>;
      const orderedStems: SeparatedStemOutput[] = [];
      const seenBuffers = new Set<ArrayBuffer>();

      for (let i = 0; i < job.descriptor.canonicalStemOrder.length; i++) {
        const expectedId = job.descriptor.canonicalStemOrder[i];
        const stem = msg.orderedStems[i];
        if (!stem || stem.id !== expectedId) {
          throw new AudioSeparationError(
            'INFERENCE_FAILED',
            `Worker stem order mismatch at index ${i}: expected "${expectedId}".`
          );
        }
        if (
          stem.sampleRate !== job.descriptor.sampleRate ||
          stem.channels !== 2 ||
          stem.totalFrames !== telemetry.totalFrames ||
          !(stem.leftBuffer instanceof ArrayBuffer) ||
          !(stem.rightBuffer instanceof ArrayBuffer) ||
          !(stem.wavBuffer instanceof ArrayBuffer)
        ) {
          throw new AudioSeparationError(
            'INFERENCE_FAILED',
            `Worker stem "${stem.id}" returned invalid PCM/WAV buffer metadata.`
          );
        }
        if (
          seenBuffers.has(stem.leftBuffer) ||
          seenBuffers.has(stem.rightBuffer) ||
          seenBuffers.has(stem.wavBuffer) ||
          stem.leftBuffer === stem.rightBuffer ||
          stem.leftBuffer === stem.wavBuffer ||
          stem.rightBuffer === stem.wavBuffer
        ) {
          throw new AudioSeparationError(
            'INFERENCE_FAILED',
            `Worker stem "${stem.id}" returned aliased or shared channel/WAV buffers.`
          );
        }
        seenBuffers.add(stem.leftBuffer);
        seenBuffers.add(stem.rightBuffer);
        seenBuffers.add(stem.wavBuffer);

        const left = new Float32Array(stem.leftBuffer);
        const right = new Float32Array(stem.rightBuffer);
        const wavBytes = new Uint8Array(stem.wavBuffer);
        const expectedWavBytes = 44 + telemetry.totalFrames * 4;
        if (
          left.length !== telemetry.totalFrames ||
          right.length !== telemetry.totalFrames ||
          wavBytes.byteLength !== expectedWavBytes ||
          stem.byteLength !== expectedWavBytes ||
          !Number.isFinite(stem.rms) ||
          stem.rms < 0 ||
          !Number.isFinite(stem.peak) ||
          stem.peak < 0 ||
          typeof stem.sha256 !== 'string'
        ) {
          throw new AudioSeparationError(
            'INFERENCE_FAILED',
            `Worker stem "${stem.id}" failed length or metric verification.`
          );
        }
        for (let frameIdx = 0; frameIdx < left.length; frameIdx++) {
          if (!Number.isFinite(left[frameIdx]) || !Number.isFinite(right[frameIdx])) {
            throw new AudioSeparationError(
              'NON_FINITE_OUTPUT',
              `Worker stem "${stem.id}" contains non-finite PCM sample at frame ${frameIdx}.`
            );
          }
        }
        const clientMaxFrames = Math.min(
          job.descriptor.sampleRate * DEFAULT_MAX_AUDIO_SECONDS,
          MAX_SEPARATION_TOTAL_FRAMES
        );
        if (
          !Number.isSafeInteger(telemetry.totalFrames) ||
          telemetry.totalFrames <= 0 ||
          telemetry.totalFrames > clientMaxFrames
        ) {
          throw new AudioSeparationError(
            'INVALID_AUDIO',
            `Worker returned totalFrames=${String(telemetry.totalFrames)} outside safe limit (0, ${clientMaxFrames}].`
          );
        }
        const wavDescriptor = parseStrictWavDescriptor(wavBytes);
        if (
          wavDescriptor.effectiveFormat !== 1 ||
          wavDescriptor.bitsPerSample !== 16 ||
          wavDescriptor.channels !== 2 ||
          wavDescriptor.sampleRate !== job.descriptor.sampleRate ||
          wavDescriptor.totalFrames !== telemetry.totalFrames ||
          wavDescriptor.dataBytes !== telemetry.totalFrames * 4
        ) {
          throw new AudioSeparationError(
            'CORRUPT_WAV',
            `Worker stem "${stem.id}" WAV chunks or fmt header failed strict contract verification.`
          );
        }

        const verifiedSha256 = await computeSha256Hex(wavBytes);
        if (job.cancelling || job.settled || this.activeJob !== job) {
          if (job.cancelling && !job.settled && this.activeJob === job) {
            this.finishActiveJobWithError(
              new AudioSeparationError(
                'CANCELLED',
                'Audio separation was cancelled.'
              )
            );
          }
          return;
        }
        if (verifiedSha256 !== stem.sha256.toLowerCase()) {
          throw new AudioSeparationError(
            'INFERENCE_FAILED',
            `Worker stem "${stem.id}" WAV SHA-256 digest mismatch.`
          );
        }

        const reconstructed: SeparatedStemOutput = {
          id: expectedId,
          labelPtBr: stem.labelPtBr,
          sampleRate: stem.sampleRate,
          channels: 2,
          totalFrames: stem.totalFrames,
          left,
          right,
          wavBytes,
          byteLength: stem.byteLength,
          sha256: verifiedSha256,
          rms: stem.rms,
          peak: stem.peak,
        };
        stemsRecord[expectedId] = reconstructed;
        orderedStems.push(reconstructed);
      }

      if (job.cancelling) {
        this.finishActiveJobWithError(
          new AudioSeparationError(
            'CANCELLED',
            'Audio separation was cancelled.'
          )
        );
        return;
      }
      if (job.settled || this.activeJob !== job) {
        return;
      }
      job.settled = true;
      job.cleanupAbortListener();
      this.activeJob = null;
      job.resolve({
        descriptor: job.descriptor,
        stems: stemsRecord,
        orderedStems,
        telemetry,
      });
    } catch (err) {
      if (job.settled || this.activeJob !== job) {
        return;
      }
      if (job.cancelling) {
        this.finishActiveJobWithError(
          new AudioSeparationError(
            'CANCELLED',
            'Audio separation was cancelled.'
          )
        );
        return;
      }
      this.finishActiveJobWithError(err);
    }
  }

  isBusy(): boolean {
    return this.activeJob !== null || this.pendingControlResolvers.size > 0;
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  hasActiveWorkerInstance(): boolean {
    return this.worker !== null;
  }

  async separate(options: SeparateInWorkerOptions): Promise<SeparationResult> {
    if (this.disposed) {
      throw new AudioSeparationError(
        'WORKER_DISPOSED',
        'DemucsSeparationWorkerClient has been disposed.'
      );
    }
    if (this.activeJob !== null || this.pendingControlResolvers.size > 0) {
      throw new AudioSeparationError(
        'CONCURRENT_SESSION_FORBIDDEN',
        'Another audio separation or cache control operation is already pending in the Worker.'
      );
    }
    if (options.signal?.aborted) {
      throw new AudioSeparationError(
        'CANCELLED',
        'Audio separation was cancelled.'
      );
    }

    const descriptor = snapshotModelDescriptor(
      options.descriptor ?? HTDEMUCS_6S_ONNX_DESCRIPTOR
    );

    const wavByteLength = options.audioWavBytes.byteLength;
    if (wavByteLength <= 0 || wavByteLength > MAX_AUDIO_WAV_BYTES) {
      throw new AudioSeparationError(
        wavByteLength <= 0 ? 'EMPTY_AUDIO' : 'INVALID_AUDIO',
        `Audio WAV size (${wavByteLength} bytes) must be in (0, ${MAX_AUDIO_WAV_BYTES}].`
      );
    }
    const inputWavHeader = parseStrictWavDescriptor(options.audioWavBytes);
    if (inputWavHeader.sampleRate !== descriptor.sampleRate) {
      throw new AudioSeparationError(
        'SAMPLE_RATE_MISMATCH',
        `Expected ${descriptor.sampleRate} Hz WAV, got ${inputWavHeader.sampleRate} Hz.`
      );
    }
    const maxDurationFrames = Math.min(
      descriptor.sampleRate * DEFAULT_MAX_AUDIO_SECONDS,
      MAX_SEPARATION_TOTAL_FRAMES
    );
    if (
      !Number.isSafeInteger(inputWavHeader.totalFrames) ||
      inputWavHeader.totalFrames <= 0 ||
      inputWavHeader.totalFrames > maxDurationFrames
    ) {
      throw new AudioSeparationError(
        'INVALID_AUDIO',
        `Input WAV frame count (${inputWavHeader.totalFrames}) exceeds browser RAM budget cap (${maxDurationFrames} frames / ${DEFAULT_MAX_AUDIO_SECONDS} s).`
      );
    }

    const transferList: Transferable[] = [];
    const audioBuffer =
      options.transferInputBuffer && options.audioWavBytes instanceof ArrayBuffer
        ? options.audioWavBytes
        : cloneToOwnedArrayBuffer(options.audioWavBytes);
    transferList.push(audioBuffer);

    let normalizedModelSource: OnnxModelSource = options.modelSource;
    if (typeof options.modelSource === 'string') {
      const resolvedUrl = resolveWorkerUrl(options.modelSource);
      if (!resolvedUrl) {
        throw new AudioSeparationError(
          'INVALID_MODEL_SOURCE',
          'Model URL must be non-empty.'
        );
      }
      normalizedModelSource = resolvedUrl;
    } else if (
      options.modelSource instanceof Uint8Array ||
      options.modelSource instanceof ArrayBuffer
    ) {
      if (
        options.modelSource.byteLength === 0 ||
        options.modelSource.byteLength > MAX_MODEL_BYTES
      ) {
        throw new AudioSeparationError(
          'INVALID_MODEL_SOURCE',
          `Model buffer byteLength (${options.modelSource.byteLength}) must be in (0, ${MAX_MODEL_BYTES}].`
        );
      }
      const clonedModelBuf = cloneToOwnedArrayBuffer(options.modelSource);
      normalizedModelSource = clonedModelBuf;
      transferList.push(clonedModelBuf);
    }

    const wasmPaths = options.wasmPaths
      ? resolveWorkerUrl(options.wasmPaths) || undefined
      : undefined;
    const numThreadsKey =
      options.numThreads === undefined ? 'auto' : String(options.numThreads);
    if (
      this.worker !== null &&
      this.workerOrtConfig !== null &&
      (this.workerOrtConfig.wasmPaths !== wasmPaths ||
        this.workerOrtConfig.numThreadsKey !== numThreadsKey)
    ) {
      // ORT Web initializes its WASM/pthread pool once per Worker context; respawn cleanly when pool options change.
      this.terminateWorkerInstance(
        new AudioSeparationError(
          'CANCELLED',
          'Worker respawned to apply updated WASM pool configuration.'
        )
      );
    }

    const worker = this.ensureWorker();
    this.workerOrtConfig = { wasmPaths, numThreadsKey };
    const jobId = `m22b-job-${++this.seq}`;
    const preferredProviders =
      options.preferredProviders && options.preferredProviders.length > 0
        ? [...options.preferredProviders]
        : (['wasm'] as ExecutionProviderName[]);
    const expectedOverlapSamples = Math.floor(
      descriptor.segmentSamples * descriptor.defaultOverlapRatio
    );

    return await new Promise<SeparationResult>((resolve, reject) => {
      const onAbort = () => {
        this.cancelActiveJob();
      };
      if (options.signal) {
        options.signal.addEventListener('abort', onAbort, { once: true });
      }

      const job: ActiveWorkerJob = {
        jobId,
        descriptor,
        requestedPreferredProviders: Object.freeze([...preferredProviders]),
        expectedTotalFrames: inputWavHeader.totalFrames,
        expectedOverlapSamples,
        onProgress: options.onProgress,
        resolve,
        reject,
        cleanupAbortListener: () => {
          options.signal?.removeEventListener('abort', onAbort);
        },
        cancelling: false,
        settled: false,
      };
      this.activeJob = job;

      const req: DemucsWorkerRequest = {
        type: 'run_separation',
        jobId,
        descriptor,
        modelSource: normalizedModelSource,
        audioWavBytes: audioBuffer,
        wasmPaths,
        preferredProviders,
        ...(options.numThreads !== undefined
          ? { numThreads: options.numThreads }
          : {}),
        ...(options.verifyModelChecksum !== undefined
          ? { verifyModelChecksum: options.verifyModelChecksum }
          : {}),
        ...(options.useModelBytesCache !== undefined
          ? { useModelBytesCache: options.useModelBytesCache }
          : {}),
        ...(options.reuseWarmSession !== undefined
          ? { reuseWarmSession: options.reuseWarmSession }
          : {}),
      };

      try {
        worker.postMessage(req, transferList);
      } catch (postErr) {
        this.finishActiveJobWithError(
          new AudioSeparationError(
            'WORKER_ERROR',
            postErr instanceof Error ? postErr.message : String(postErr)
          )
        );
      }
    });
  }

  cancelActiveJob(): void {
    const job = this.activeJob;
    if (!job || job.settled || job.cancelling) {
      return;
    }
    job.cancelling = true;

    if (this.worker) {
      try {
        const cancelReq: DemucsWorkerRequest = {
          type: 'cancel_job',
          jobId: job.jobId,
        };
        this.worker.postMessage(cancelReq);
      } catch {
        // Ignore postMessage failure while terminating.
      }
    }

    if (this.terminateOnCancel) {
      this.terminateWorkerInstance(
        new AudioSeparationError(
          'CANCELLED',
          'Worker terminated while control operation was pending.'
        )
      );
      this.finishActiveJobWithError(
        new AudioSeparationError('CANCELLED', 'Audio separation was cancelled.')
      );
    }
  }

  async clearCache(): Promise<void> {
    if (this.disposed || !this.worker) {
      return;
    }
    if (this.activeJob !== null || this.pendingControlResolvers.size > 0) {
      throw new AudioSeparationError(
        'CONCURRENT_SESSION_FORBIDDEN',
        'Cannot clear worker cache while another separation or control operation is active.'
      );
    }
    const requestId = `m22b-clear-${++this.seq}`;
    const worker = this.worker;
    await new Promise<void>((resolve, reject) => {
      this.pendingControlResolvers.set(requestId, { resolve, reject });
      try {
        const req: DemucsWorkerRequest = { type: 'clear_cache', requestId };
        worker.postMessage(req);
      } catch (err) {
        this.pendingControlResolvers.delete(requestId);
        reject(err);
      }
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const job = this.activeJob;
    if (job && !job.settled) {
      if (this.worker) {
        try {
          this.worker.postMessage({
            type: 'cancel_job',
            jobId: job.jobId,
          } satisfies DemucsWorkerRequest);
        } catch {
          // Ignore postMessage error during dispose.
        }
      }
      this.finishActiveJobWithError(
        new AudioSeparationError('CANCELLED', 'Audio separation was cancelled.')
      );
    }
    this.terminateWorkerInstance(
      new AudioSeparationError('WORKER_DISPOSED', 'Worker client disposed.')
    );
  }
}

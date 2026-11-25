import {
  AudioSeparationError,
  clearVerifiedModelBytesCache,
  computeSha256Hex,
  createOrtWebSessionAdapter,
  decodeWavToStereoFloat32,
  descriptorsMatchContract,
  separateStereoAudio,
  snapshotModelDescriptor,
  type AudioSeparationModelDescriptor,
  type OnnxInferenceSessionHandle,
} from './demucs-onnx-separator';
import type {
  DemucsWorkerRequest,
  DemucsWorkerResponse,
  DemucsWorkerRunRequest,
  TransferredStemPayload,
} from './demucs-worker-protocol';

interface WorkerSelfScope {
  postMessage(message: DemucsWorkerResponse, transfer?: Transferable[]): void;
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<DemucsWorkerRequest>) => void
  ): void;
  close?: () => void;
}

const workerScope = globalThis as unknown as WorkerSelfScope;

interface WarmSessionEntry {
  session: OnnxInferenceSessionHandle;
  descriptor: AudioSeparationModelDescriptor;
  modelSourceKey: string;
  preferredProvidersKey: string;
  numThreadsKey: string;
  wasmPathsKey?: string;
  verifyChecksumKey: boolean;
}

interface BoundOrtWasmConfig {
  wasmPathsKey?: string;
  numThreadsKey: string;
}

let activeJobId: string | null = null;
let activeAbortController: AbortController | null = null;
let isClearingCache = false;
let warmSessionEntry: WarmSessionEntry | null = null;
let boundOrtWasmConfig: BoundOrtWasmConfig | null = null;

function toOwnedArrayBuffer(view: Float32Array | Uint8Array): ArrayBuffer {
  if (
    view.byteOffset === 0 &&
    view.byteLength === view.buffer.byteLength &&
    view.buffer instanceof ArrayBuffer
  ) {
    return view.buffer;
  }
  const copy = new Uint8Array(view.byteLength);
  copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  return copy.buffer;
}

async function disposeWarmSession(): Promise<void> {
  if (!warmSessionEntry) {
    return;
  }
  const entry = warmSessionEntry;
  warmSessionEntry = null;
  try {
    await entry.session.dispose();
  } catch {
    // Ignore warm session release errors during reset/teardown.
  }
}

async function handleRunSeparation(req: DemucsWorkerRunRequest): Promise<void> {
  if (activeJobId !== null || isClearingCache) {
    workerScope.postMessage({
      type: 'error',
      jobId: req.jobId,
      code: 'CONCURRENT_SESSION_FORBIDDEN',
      message: isClearingCache
        ? 'Worker is currently clearing cache.'
        : `Worker already processing separation job "${activeJobId}".`,
    });
    return;
  }

  const abortController = new AbortController();
  activeJobId = req.jobId;
  activeAbortController = abortController;

  try {
    const frozenDescriptor = snapshotModelDescriptor(req.descriptor);

    if (
      !(req.audioWavBytes instanceof ArrayBuffer) ||
      req.audioWavBytes.byteLength === 0
    ) {
      throw new AudioSeparationError(
        'EMPTY_AUDIO',
        'Worker received empty WAV buffer.'
      );
    }

    const inputSha256 = await computeSha256Hex(new Uint8Array(req.audioWavBytes));
    const decoded = decodeWavToStereoFloat32(req.audioWavBytes, {
      expectedSampleRate: frozenDescriptor.sampleRate,
    });
    // The decoded Float32 channels are the only input copy needed from here on: drop the transferred WAV (4 B/frame).
    (req as { audioWavBytes: ArrayBuffer | null }).audioWavBytes = null;
    const retainPcmChannels = req.retainPcmChannels !== false;

    if (abortController.signal.aborted) {
      throw new AudioSeparationError(
        'CANCELLED',
        'Audio separation was cancelled.'
      );
    }

    const reuseWarmSession = Boolean(req.reuseWarmSession);
    const modelSourceKey =
      typeof req.modelSource === 'string'
        ? req.modelSource.trim()
        : '__non_string_source__';
    const preferredProvidersKey = req.preferredProviders.join(',');
    const numThreadsKey =
      req.numThreads === undefined ? 'auto' : String(req.numThreads);
    const wasmPathsKey = req.wasmPaths;
    const isPinnedModel = Boolean(
      frozenDescriptor.expectedModelSha256 ||
        frozenDescriptor.expectedModelBytes !== undefined
    );
    const shouldVerifyChecksum = req.verifyModelChecksum ?? isPinnedModel;
    if (isPinnedModel && !shouldVerifyChecksum) {
      throw new AudioSeparationError(
        'MODEL_CHECKSUM_MISMATCH',
        `Model "${frozenDescriptor.id}" has a pinned checksum/size and cannot be loaded without verification.`
      );
    }
    if (
      boundOrtWasmConfig !== null &&
      (boundOrtWasmConfig.wasmPathsKey !== wasmPathsKey ||
        boundOrtWasmConfig.numThreadsKey !== numThreadsKey)
    ) {
      throw new AudioSeparationError(
        'MODEL_LOAD_FAILED',
        `Worker ONNX Runtime WASM pool already initialized for wasmPaths="${boundOrtWasmConfig.wasmPathsKey}", numThreads=${boundOrtWasmConfig.numThreadsKey}; recreate Worker to change pool configuration.`
      );
    }

    const result = await separateStereoAudio(decoded, {
      descriptor: frozenDescriptor,
      inputSha256,
      executionContext: 'web_worker',
      signal: abortController.signal,
      yieldBetweenChunks: false,
      retainPcmChannels,
      onProgress: (event) => {
        if (!abortController.signal.aborted && activeJobId === req.jobId) {
          workerScope.postMessage({
            type: 'progress',
            jobId: req.jobId,
            event,
          });
        }
      },
      createSession: async (desc) => {
        if (
          reuseWarmSession &&
          typeof req.modelSource === 'string' &&
          warmSessionEntry !== null &&
          warmSessionEntry.modelSourceKey === modelSourceKey &&
          warmSessionEntry.preferredProvidersKey === preferredProvidersKey &&
          warmSessionEntry.numThreadsKey === numThreadsKey &&
          warmSessionEntry.wasmPathsKey === wasmPathsKey &&
          warmSessionEntry.verifyChecksumKey === shouldVerifyChecksum &&
          descriptorsMatchContract(warmSessionEntry.descriptor, desc)
        ) {
          return {
            session: warmSessionEntry.session,
            modelLoadMs: 0,
            modelBytesFetchMs: 0,
            modelChecksumMs: 0,
            sessionInitMs: 0,
            modelCacheHit: true,
            modelCacheMode: 'session_reused',
            ownSession: false,
          };
        }

        await disposeWarmSession();

        boundOrtWasmConfig = { wasmPathsKey, numThreadsKey };
        const created = await createOrtWebSessionAdapter(
          req.modelSource,
          desc,
          {
            wasmPaths: req.wasmPaths,
            preferredProviders: req.preferredProviders,
            numThreads: req.numThreads,
            verifyModelChecksum: shouldVerifyChecksum,
            useModelBytesCache: req.useModelBytesCache,
            signal: abortController.signal,
          }
        );

        if (reuseWarmSession && typeof req.modelSource === 'string') {
          warmSessionEntry = {
            session: created.session,
            descriptor: desc,
            modelSourceKey,
            preferredProvidersKey,
            numThreadsKey,
            wasmPathsKey,
            verifyChecksumKey: shouldVerifyChecksum,
          };
          return {
            ...created,
            ownSession: false,
          };
        }

        return {
          ...created,
          ownSession: true,
        };
      },
    });

    if (abortController.signal.aborted) {
      throw new AudioSeparationError(
        'CANCELLED',
        'Audio separation was cancelled.'
      );
    }

    const transferables: ArrayBuffer[] = [];
    const orderedStems: TransferredStemPayload[] = result.orderedStems.map(
      (stem) => {
        const leftBuffer = retainPcmChannels ? toOwnedArrayBuffer(stem.left) : null;
        const rightBuffer = retainPcmChannels ? toOwnedArrayBuffer(stem.right) : null;
        const wavBuffer = toOwnedArrayBuffer(stem.wavBytes);
        if (leftBuffer && rightBuffer) transferables.push(leftBuffer, rightBuffer);
        transferables.push(wavBuffer);
        return {
          id: stem.id,
          labelPtBr: stem.labelPtBr,
          sampleRate: stem.sampleRate,
          channels: 2,
          totalFrames: stem.totalFrames,
          leftBuffer,
          rightBuffer,
          wavBuffer,
          byteLength: stem.byteLength,
          sha256: stem.sha256,
          rms: stem.rms,
          peak: stem.peak,
        };
      }
    );

    workerScope.postMessage(
      {
        type: 'completed',
        jobId: req.jobId,
        descriptor: result.descriptor,
        telemetry: result.telemetry,
        orderedStems,
      },
      transferables
    );
  } catch (err) {
    if (
      abortController.signal.aborted ||
      (err instanceof AudioSeparationError && err.code === 'CANCELLED') ||
      (err instanceof DOMException && err.name === 'AbortError')
    ) {
      await disposeWarmSession();
      workerScope.postMessage({
        type: 'error',
        jobId: req.jobId,
        code: 'CANCELLED',
        message: 'Audio separation was cancelled.',
      });
      return;
    }

    if (err instanceof AudioSeparationError) {
      if (err.code === 'INFERENCE_FAILED' || err.code === 'MODEL_LOAD_FAILED') {
        await disposeWarmSession();
      }
      workerScope.postMessage({
        type: 'error',
        jobId: req.jobId,
        code: err.code,
        message: err.message,
      });
      return;
    }

    await disposeWarmSession();
    workerScope.postMessage({
      type: 'error',
      jobId: req.jobId,
      code: 'WORKER_ERROR',
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    if (activeJobId === req.jobId) {
      activeJobId = null;
      activeAbortController = null;
    }
  }
}

workerScope.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') {
    return;
  }

  switch (msg.type) {
    case 'run_separation':
      void handleRunSeparation(msg);
      break;
    case 'cancel_job':
      if (activeJobId === msg.jobId && activeAbortController) {
        activeAbortController.abort();
      }
      break;
    case 'clear_cache':
      if (activeJobId !== null || isClearingCache) {
        workerScope.postMessage({
          type: 'error',
          jobId: msg.requestId,
          code: 'CONCURRENT_SESSION_FORBIDDEN',
          message:
            'Cannot clear worker cache while a separation or cache clear operation is active.',
        });
        break;
      }
      isClearingCache = true;
      void (async () => {
        try {
          if (activeJobId !== null) {
            workerScope.postMessage({
              type: 'error',
              jobId: msg.requestId,
              code: 'CONCURRENT_SESSION_FORBIDDEN',
              message:
                'Cannot clear worker cache while a separation job is active.',
            });
            return;
          }
          await disposeWarmSession();
          clearVerifiedModelBytesCache();
          workerScope.postMessage({
            type: 'cache_cleared',
            requestId: msg.requestId,
          });
        } catch (err) {
          workerScope.postMessage({
            type: 'error',
            jobId: msg.requestId,
            code: 'WORKER_ERROR',
            message: err instanceof Error ? err.message : String(err),
          });
        } finally {
          isClearingCache = false;
        }
      })();
      break;
    case 'dispose_worker':
      void (async () => {
        if (activeAbortController) {
          activeAbortController.abort();
        }
        await disposeWarmSession();
        clearVerifiedModelBytesCache();
        workerScope.postMessage({
          type: 'disposed',
          requestId: msg.requestId,
        });
        workerScope.close?.();
      })();
      break;
  }
});

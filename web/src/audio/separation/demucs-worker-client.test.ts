import { describe, expect, it, vi } from 'vitest';
import {
  AudioSeparationError,
  CANONICAL_STEM_IDS,
  HTDEMUCS_6S_ONNX_DESCRIPTOR,
  MAX_SEPARATION_TOTAL_FRAMES,
  computeSha256Hex,
  encodeStereoPcm16Wav,
  type AudioSeparationModelDescriptor,
  type CanonicalStemId,
  type SeparationTelemetryMetrics,
} from './demucs-onnx-separator';
import {
  DemucsSeparationWorkerClient,
  type WorkerLike,
} from './demucs-worker-client';
import type {
  DemucsWorkerRequest,
  DemucsWorkerResponse,
  TransferredStemPayload,
} from './demucs-worker-protocol';

class FakeDemucsWorker implements WorkerLike {
  readonly postedMessages: Array<{ message: unknown; transfer?: Transferable[] }> =
    [];
  terminated = false;
  private listeners = new Map<string, Set<(event: Event) => void>>();

  addEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: (event: Event) => void
  ): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: (event: Event) => void
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.postedMessages.push({ message, transfer });
  }

  terminate(): void {
    this.terminated = true;
  }

  emitMessage(data: DemucsWorkerResponse): void {
    const evt = { data } as unknown as MessageEvent<DemucsWorkerResponse>;
    for (const listener of [...(this.listeners.get('message') ?? [])]) {
      listener(evt);
    }
  }

  emitError(message: string): void {
    const evt = { message } as unknown as ErrorEvent;
    for (const listener of [...(this.listeners.get('error') ?? [])]) {
      listener(evt);
    }
  }
}

async function buildCompletedPayload(
  jobId: string,
  descriptor: AudioSeparationModelDescriptor,
  totalFrames: number,
  options?: { tamperStemSha256?: boolean; tamperChecksumVerified?: boolean }
): Promise<DemucsWorkerResponse> {
  const orderedStems: TransferredStemPayload[] = [];
  for (let i = 0; i < CANONICAL_STEM_IDS.length; i++) {
    const id: CanonicalStemId = CANONICAL_STEM_IDS[i];
    const left = new Float32Array(totalFrames).fill(0.05 * (i + 1));
    const right = new Float32Array(totalFrames).fill(-0.04 * (i + 1));
    const wavBytes = encodeStereoPcm16Wav({
      sampleRate: descriptor.sampleRate,
      left,
      right,
    });
    const sha = await computeSha256Hex(wavBytes);
    orderedStems.push({
      id,
      labelPtBr: id,
      sampleRate: descriptor.sampleRate,
      channels: 2,
      totalFrames,
      leftBuffer: left.buffer,
      rightBuffer: right.buffer,
      wavBuffer: wavBytes.slice().buffer,
      byteLength: wavBytes.byteLength,
      sha256:
        options?.tamperStemSha256 && i === 0 ? '0'.repeat(64) : sha,
      rms: 0.05,
      peak: 0.1,
    });
  }

  const telemetry: SeparationTelemetryMetrics = {
    modelId: descriptor.id,
    modelVersion: descriptor.version,
    executionProvider: 'wasm',
    ortVersion: '1.21.0',
    modelBytes: descriptor.expectedModelBytes ?? 1234,
    modelSha256: descriptor.expectedModelSha256 ?? 'a'.repeat(64),
    modelChecksumVerified: options?.tamperChecksumVerified
      ? false
      : Boolean(descriptor.expectedModelSha256),
    sampleRate: descriptor.sampleRate,
    totalFrames,
    audioDurationSeconds: totalFrames / descriptor.sampleRate,
    segmentSamples: descriptor.segmentSamples,
    overlapSamples: Math.floor(
      descriptor.segmentSamples * descriptor.defaultOverlapRatio
    ),
    chunksProcessed: 1,
    modelLoadMs: 120,
    modelBytesFetchMs: 80,
    modelChecksumMs: 15,
    sessionInitMs: 25,
    modelCacheHit: false,
    modelCacheMode: 'none',
    wasmNumThreads: 1,
    crossOriginIsolated: false,
    executionContext: 'web_worker',
    providerAttempts: [
      {
        provider: 'wasm',
        outcome: 'selected',
        stage: 'session_create',
        durationMs: 25,
      },
    ],
    providerFallbackReason: null,
    inferenceMs: 220,
    encodeMs: 10,
    totalWallMs: 350,
    rtf: 0.5,
    jsHeapUsedBytes: null,
    jsHeapSnapshotKind: 'unavailable',
    reconstructionMaxAbsError: 0.01,
    inputSha256: 'b'.repeat(64),
  };

  return {
    type: 'completed',
    jobId,
    descriptor,
    telemetry,
    orderedStems,
  };
}

describe('DemucsSeparationWorkerClient (M22-B)', () => {
  const testDescriptor: AudioSeparationModelDescriptor = {
    ...HTDEMUCS_6S_ONNX_DESCRIPTOR,
    id: 'worker_test_6s',
    segmentSamples: 16,
    defaultOverlapRatio: 0.25,
    expectedModelBytes: 1234,
    expectedModelSha256: 'a'.repeat(64),
  };

  const sampleWav = encodeStereoPcm16Wav({
    sampleRate: 44100,
    left: new Float32Array(12).fill(0.2),
    right: new Float32Array(12).fill(-0.2),
  });

  it('separates via Worker, forwards progress, enforces single concurrency, and verifies client attestation/WAV hashes', async () => {
    const worker = new FakeDemucsWorker();
    const client = new DemucsSeparationWorkerClient({
      createWorker: () => worker,
    });

    const progressPhases: string[] = [];
    const runPromise = client.separate({
      descriptor: testDescriptor,
      modelSource: '/models/test.onnx',
      audioWavBytes: sampleWav,
      wasmPaths: '/ort/',
      preferredProviders: ['wasm'],
      useModelBytesCache: true,
      onProgress: (evt) => progressPhases.push(evt.phase),
    });

    expect(client.isBusy()).toBe(true);
    expect(worker.postedMessages).toHaveLength(1);
    const req = worker.postedMessages[0].message as DemucsWorkerRequest;
    expect(req.type).toBe('run_separation');
    if (req.type !== 'run_separation') throw new Error('expected run_separation');
    expect(worker.postedMessages[0].transfer).toContain(req.audioWavBytes);

    // Concurrent separation must fail immediately with CONCURRENT_SESSION_FORBIDDEN
    await expect(
      client.separate({
        descriptor: testDescriptor,
        modelSource: '/models/test.onnx',
        audioWavBytes: sampleWav,
      })
    ).rejects.toMatchObject({ code: 'CONCURRENT_SESSION_FORBIDDEN' });

    worker.emitMessage({
      type: 'progress',
      jobId: req.jobId,
      event: {
        phase: 'separating',
        chunkIndex: 1,
        totalChunks: 1,
        fraction: 1,
        elapsedMs: 50,
      },
    });
    expect(progressPhases).toEqual(['separating']);

    const completedMsg = await buildCompletedPayload(
      req.jobId,
      testDescriptor,
      12
    );
    worker.emitMessage(completedMsg);

    const result = await runPromise;
    expect(client.isBusy()).toBe(false);
    expect(result.orderedStems.map((s) => s.id)).toEqual([...CANONICAL_STEM_IDS]);
    expect(result.telemetry.executionContext).toBe('web_worker');
    expect(result.telemetry.modelChecksumVerified).toBe(true);
    expect(result.stems.vocals.totalFrames).toBe(12);
    expect(result.stems.vocals.wavBytes.byteLength).toBe(44 + 12 * 4);

    // Clear cache round-trip
    const clearPromise = client.clearCache();
    const clearReq = worker.postedMessages[1].message as DemucsWorkerRequest;
    expect(clearReq.type).toBe('clear_cache');
    if (clearReq.type !== 'clear_cache') throw new Error('expected clear_cache');
    worker.emitMessage({
      type: 'cache_cleared',
      requestId: clearReq.requestId,
    });
    await clearPromise;

    client.dispose();
    expect(worker.terminated).toBe(true);
    expect(client.isDisposed()).toBe(true);
    await expect(
      client.separate({
        descriptor: testDescriptor,
        modelSource: '/models/test.onnx',
        audioWavBytes: sampleWav,
      })
    ).rejects.toMatchObject({ code: 'WORKER_DISPOSED' });
  });

  it('M22-M1: retainPcmChannels=false asks the worker for WAV only and accepts stems without PCM buffers', async () => {
    const worker = new FakeDemucsWorker();
    const client = new DemucsSeparationWorkerClient({ createWorker: () => worker });
    const run = client.separate({
      descriptor: testDescriptor,
      modelSource: '/models/test.onnx',
      audioWavBytes: sampleWav,
      wasmPaths: '/ort/',
      preferredProviders: ['wasm'],
      retainPcmChannels: false,
    });
    const req = worker.postedMessages[0].message as DemucsWorkerRequest;
    if (req.type !== 'run_separation') throw new Error('expected run_separation');
    expect(req.retainPcmChannels).toBe(false);
    const msg = await buildCompletedPayload(req.jobId, testDescriptor, 12);
    if (msg.type !== 'completed') throw new Error('expected completed');
    worker.emitMessage({
      ...msg,
      orderedStems: msg.orderedStems.map((s) => ({ ...s, leftBuffer: null, rightBuffer: null })),
    });
    const result = await run;
    expect(result.orderedStems).toHaveLength(6);
    for (const stem of result.orderedStems) {
      expect(stem.left.length).toBe(0);
      expect(stem.right.length).toBe(0);
      expect(stem.wavBytes.byteLength).toBe(44 + 12 * 4);
    }
    client.dispose();
  });

  it('M22-M1: fails closed when PCM buffers arrive although they were not requested, or are missing when they were', async () => {
    for (const retain of [false, true]) {
      const worker = new FakeDemucsWorker();
      const client = new DemucsSeparationWorkerClient({ createWorker: () => worker });
      const run = client.separate({
        descriptor: testDescriptor,
        modelSource: '/models/test.onnx',
        audioWavBytes: sampleWav,
        wasmPaths: '/ort/',
        preferredProviders: ['wasm'],
        retainPcmChannels: retain,
      });
      const req = worker.postedMessages[0].message as DemucsWorkerRequest;
      if (req.type !== 'run_separation') throw new Error('expected run_separation');
      const msg = await buildCompletedPayload(req.jobId, testDescriptor, 12);
      if (msg.type !== 'completed') throw new Error('expected completed');
      worker.emitMessage(
        retain
          ? { ...msg, orderedStems: msg.orderedStems.map((s) => ({ ...s, leftBuffer: null, rightBuffer: null })) }
          : msg // still carries Float32 PCM although retainPcmChannels=false
      );
      await expect(run).rejects.toMatchObject({ code: 'INFERENCE_FAILED' });
      client.dispose();
    }
  });
  it('rejects a worker result whose frames disagree with the input WAV', async () => {
    const worker = new FakeDemucsWorker();
    const client = new DemucsSeparationWorkerClient({ createWorker: () => worker });
    const run = client.separate({
      descriptor: testDescriptor,
      modelSource: '/models/test.onnx',
      audioWavBytes: sampleWav,
    });
    const request = worker.postedMessages[0].message as DemucsWorkerRequest;
    if (request.type !== 'run_separation') throw new Error('expected run');

    worker.emitMessage(await buildCompletedPayload(request.jobId, testDescriptor, 11));
    await expect(run).rejects.toMatchObject({ code: 'INFERENCE_FAILED' });
    expect(client.isBusy()).toBe(false);
    client.dispose();
  });

  it('recreates the worker after a failed ONNX load so a retry is possible', async () => {
    const workers: FakeDemucsWorker[] = [];
    const client = new DemucsSeparationWorkerClient({
      createWorker: () => {
        const worker = new FakeDemucsWorker();
        workers.push(worker);
        return worker;
      },
    });
    const options = {
      descriptor: testDescriptor,
      modelSource: '/models/test.onnx',
      audioWavBytes: sampleWav,
    };
    const first = client.separate(options);
    const request = workers[0].postedMessages[0].message as DemucsWorkerRequest;
    if (request.type !== 'run_separation') throw new Error('expected run');
    workers[0].emitMessage({
      type: 'error',
      jobId: request.jobId,
      code: 'MODEL_LOAD_FAILED',
      message: 'ORT WASM initialization failed',
    });
    await expect(first).rejects.toMatchObject({ code: 'MODEL_LOAD_FAILED' });
    expect(workers[0].terminated).toBe(true);

    const retry = client.separate(options);
    const retryRequest = workers[1].postedMessages[0].message as DemucsWorkerRequest;
    if (retryRequest.type !== 'run_separation') throw new Error('expected retry');
    expect(retryRequest.wasmPaths).toBeUndefined();
    workers[1].emitMessage(await buildCompletedPayload(retryRequest.jobId, testDescriptor, 12));
    expect((await retry).orderedStems).toHaveLength(6);
    client.dispose();
  });

  it('cancels safely by terminating blocking Worker immediately and spawns a clean Worker for the next run', async () => {
    const createdWorkers: FakeDemucsWorker[] = [];
    const client = new DemucsSeparationWorkerClient({
      createWorker: () => {
        const w = new FakeDemucsWorker();
        createdWorkers.push(w);
        return w;
      },
    });

    const abortController = new AbortController();
    const cancelledPromise = client.separate({
      descriptor: testDescriptor,
      modelSource: '/models/test.onnx',
      audioWavBytes: sampleWav,
      signal: abortController.signal,
    });

    expect(createdWorkers).toHaveLength(1);
    abortController.abort();

    await expect(cancelledPromise).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(createdWorkers[0].terminated).toBe(true);
    expect(client.isBusy()).toBe(false);
    expect(client.hasActiveWorkerInstance()).toBe(false);
    expect(
      createdWorkers[0].postedMessages.some(
        (m) => (m.message as DemucsWorkerRequest).type === 'cancel_job'
      )
    ).toBe(true);

    // Subsequent run starts cleanly on a fresh Worker instance
    const secondPromise = client.separate({
      descriptor: testDescriptor,
      modelSource: '/models/test.onnx',
      audioWavBytes: sampleWav,
    });
    expect(createdWorkers).toHaveLength(2);
    const secondReq = createdWorkers[1].postedMessages[0]
      .message as DemucsWorkerRequest;
    if (secondReq.type !== 'run_separation') throw new Error('expected run');
    createdWorkers[1].emitMessage(
      await buildCompletedPayload(secondReq.jobId, testDescriptor, 12)
    );
    const secondResult = await secondPromise;
    expect(secondResult.orderedStems).toHaveLength(6);
    client.dispose();
  });

  it('rejects fail-closed when Worker returns forged WAV SHA-256 or unverified pinned telemetry', async () => {
    const worker = new FakeDemucsWorker();
    const client = new DemucsSeparationWorkerClient({
      createWorker: () => worker,
    });

    const p1 = client.separate({
      descriptor: testDescriptor,
      modelSource: '/models/test.onnx',
      audioWavBytes: sampleWav,
    });
    const req1 = worker.postedMessages[0].message as DemucsWorkerRequest;
    if (req1.type !== 'run_separation') throw new Error('expected run');
    worker.emitMessage(
      await buildCompletedPayload(req1.jobId, testDescriptor, 12, {
        tamperStemSha256: true,
      })
    );
    await expect(p1).rejects.toBeInstanceOf(AudioSeparationError);

    const p2 = client.separate({
      descriptor: testDescriptor,
      modelSource: '/models/test.onnx',
      audioWavBytes: sampleWav,
    });
    const req2 = worker.postedMessages[1].message as DemucsWorkerRequest;
    if (req2.type !== 'run_separation') throw new Error('expected run');
    worker.emitMessage(
      await buildCompletedPayload(req2.jobId, testDescriptor, 12, {
        tamperChecksumVerified: true,
      })
    );
    await expect(p2).rejects.toMatchObject({ code: 'INFERENCE_FAILED' });

    // Worker crash mid-job rejects active job with WORKER_ERROR
    const p3 = client.separate({
      descriptor: testDescriptor,
      modelSource: '/models/test.onnx',
      audioWavBytes: sampleWav,
    });
    worker.emitError('WASM memory out of bounds');
    await expect(p3).rejects.toMatchObject({ code: 'WORKER_ERROR' });
    expect(worker.terminated).toBe(true);
    client.dispose();
  });

  it('prevents clearCache() vs separate() races, enforces cooperative cancel drain, validates contract/aliasing/NaN, and respawns on pool change', async () => {
    const workers: FakeDemucsWorker[] = [];
    const client = new DemucsSeparationWorkerClient({
      terminateOnCancel: false,
      createWorker: () => {
        const w = new FakeDemucsWorker();
        workers.push(w);
        return w;
      },
    });

    // Establish initial worker pool config (wasmPaths='/ort/', numThreads=1)
    const initialRun = client.separate({
      descriptor: testDescriptor,
      modelSource: '/models/test.onnx',
      audioWavBytes: sampleWav,
      wasmPaths: '/ort/',
      preferredProviders: ['wasm'],
      numThreads: 1,
    });
    const reqInit = workers[0].postedMessages[0].message as DemucsWorkerRequest;
    if (reqInit.type !== 'run_separation') throw new Error('expected run');
    workers[0].emitMessage(
      await buildCompletedPayload(reqInit.jobId, testDescriptor, 12)
    );
    await initialRun;

    // 1. clearCache() blocks concurrent separate() and rejects cleanly if disposed/terminated while pending
    const clearPending = client.clearCache();
    expect(client.isBusy()).toBe(true);
    await expect(
      client.separate({
        descriptor: testDescriptor,
        modelSource: '/models/test.onnx',
        audioWavBytes: sampleWav,
      })
    ).rejects.toMatchObject({ code: 'CONCURRENT_SESSION_FORBIDDEN' });

    // Respawning worker because pool numThreads changed rejects dangling clearCache cleanly and spawns Worker[1]
    const clearReq = workers[0].postedMessages[1].message as DemucsWorkerRequest;
    if (clearReq.type !== 'clear_cache') throw new Error('expected clear_cache');
    workers[0].emitMessage({
      type: 'cache_cleared',
      requestId: clearReq.requestId,
    });
    await clearPending;

    const respawnedRun = client.separate({
      descriptor: testDescriptor,
      modelSource: '/models/test.onnx',
      audioWavBytes: sampleWav,
      wasmPaths: '/ort/',
      preferredProviders: ['wasm'],
      numThreads: 4,
    });
    expect(workers).toHaveLength(2);
    expect(workers[0].terminated).toBe(true);

    // 2. Cooperative cancellation (terminateOnCancel: false) stays busy until Worker acknowledges cancel
    const coopAbort = new AbortController();
    const runWithAbort = client.separate({
      descriptor: testDescriptor,
      modelSource: '/models/test.onnx',
      audioWavBytes: sampleWav,
      wasmPaths: '/ort/',
      preferredProviders: ['wasm'],
      numThreads: 4,
      signal: coopAbort.signal,
    });
    await expect(runWithAbort).rejects.toMatchObject({
      code: 'CONCURRENT_SESSION_FORBIDDEN',
    });

    const coopAbort2 = new AbortController();
    const req2 = workers[1].postedMessages[0].message as DemucsWorkerRequest;
    if (req2.type !== 'run_separation') throw new Error('expected run');
    workers[1].emitMessage(
      await buildCompletedPayload(req2.jobId, testDescriptor, 12)
    );
    await respawnedRun;

    const cancellingRun = client.separate({
      descriptor: testDescriptor,
      modelSource: '/models/test.onnx',
      audioWavBytes: sampleWav,
      wasmPaths: '/ort/',
      preferredProviders: ['wasm'],
      numThreads: 4,
      signal: coopAbort2.signal,
    });
    coopAbort2.abort();
    expect(workers[1].terminated).toBe(false);
    expect(client.isBusy()).toBe(true);
    await expect(
      client.separate({
        descriptor: testDescriptor,
        modelSource: '/models/test.onnx',
        audioWavBytes: sampleWav,
        wasmPaths: '/ort/',
        preferredProviders: ['wasm'],
        numThreads: 4,
      })
    ).rejects.toMatchObject({ code: 'CONCURRENT_SESSION_FORBIDDEN' });

    const reqCoop = workers[1].postedMessages[1].message as DemucsWorkerRequest;
    if (reqCoop.type !== 'run_separation') throw new Error('expected run');
    workers[1].emitMessage({
      type: 'error',
      jobId: reqCoop.jobId,
      code: 'CANCELLED',
      message: 'Cancelled',
    });
    await expect(cancellingRun).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(client.isBusy()).toBe(false);

    // 3. Out-of-contract provider, aliased PCM buffers, or NaN samples must be rejected even with valid WAV SHA-256
    const pContract = client.separate({
      descriptor: testDescriptor,
      modelSource: '/models/test.onnx',
      audioWavBytes: sampleWav,
      wasmPaths: '/ort/',
      preferredProviders: ['wasm'],
      numThreads: 4,
    });
    const reqContract = workers[1].postedMessages[3].message as DemucsWorkerRequest;
    if (reqContract.type !== 'run_separation') throw new Error('expected run');
    const badProviderMsg = await buildCompletedPayload(
      reqContract.jobId,
      testDescriptor,
      12
    );
    if (badProviderMsg.type === 'completed') {
      badProviderMsg.telemetry.executionProvider = 'webgpu';
    }
    workers[1].emitMessage(badProviderMsg);
    await expect(pContract).rejects.toMatchObject({ code: 'INFERENCE_FAILED' });

    const pAliased = client.separate({
      descriptor: testDescriptor,
      modelSource: '/models/test.onnx',
      audioWavBytes: sampleWav,
      wasmPaths: '/ort/',
      preferredProviders: ['wasm'],
      numThreads: 4,
    });
    const reqAlias = workers[1].postedMessages[4].message as DemucsWorkerRequest;
    if (reqAlias.type !== 'run_separation') throw new Error('expected run');
    const aliasedMsg = await buildCompletedPayload(
      reqAlias.jobId,
      testDescriptor,
      12
    );
    if (aliasedMsg.type === 'completed') {
      aliasedMsg.orderedStems = aliasedMsg.orderedStems.map((s) => ({
        ...s,
        rightBuffer: s.leftBuffer,
      }));
    }
    workers[1].emitMessage(aliasedMsg);
    await expect(pAliased).rejects.toMatchObject({ code: 'INFERENCE_FAILED' });

    const pNan = client.separate({
      descriptor: testDescriptor,
      modelSource: '/models/test.onnx',
      audioWavBytes: sampleWav,
      wasmPaths: '/ort/',
      preferredProviders: ['wasm'],
      numThreads: 4,
    });
    const reqNan = workers[1].postedMessages[5].message as DemucsWorkerRequest;
    if (reqNan.type !== 'run_separation') throw new Error('expected run');
    const nanMsg = await buildCompletedPayload(
      reqNan.jobId,
      testDescriptor,
      12
    );
    if (nanMsg.type === 'completed') {
      new Float32Array(nanMsg.orderedStems[0].leftBuffer!)[0] = Number.NaN;
    }
    workers[1].emitMessage(nanMsg);
    await expect(pNan).rejects.toMatchObject({ code: 'NON_FINITE_OUTPUT' });

    // 4. Relative './models/sub.onnx' URL resolves against page location rather than worker location
    const prevHref = window.location.href;
    window.history.pushState({}, '', '/nested/app/index.html');
    try {
      const pRelUrl = client.separate({
        descriptor: testDescriptor,
        modelSource: './models/sub.onnx',
        audioWavBytes: sampleWav,
        wasmPaths: './ort/',
        preferredProviders: ['wasm'],
        numThreads: 4,
      });
      const relWorker = workers.at(-1)!;
      expect(workers).toHaveLength(3);
      expect(workers[1].terminated).toBe(true);
      const reqRel = relWorker.postedMessages[0].message as DemucsWorkerRequest;
      if (reqRel.type !== 'run_separation') throw new Error('expected run');
      expect(reqRel.modelSource).toMatch(/\/nested\/app\/models\/sub\.onnx$/);
      expect(reqRel.wasmPaths).toMatch(/\/nested\/app\/ort\/$/);
      relWorker.emitMessage(
        await buildCompletedPayload(reqRel.jobId, testDescriptor, 12)
      );
      await pRelUrl;
    } finally {
      window.history.pushState({}, '', prevHref);
    }

    // 5. Aborting during post-'completed' SHA-256 verification under terminateOnCancel:false rejects CANCELLED
    const digestOrig = globalThis.crypto.subtle.digest.bind(
      globalThis.crypto.subtle
    );
    let digestCalls = 0;
    const cancelDuringHash = new AbortController();
    const pHashCancel = client.separate({
      descriptor: testDescriptor,
      modelSource: '/models/test.onnx',
      audioWavBytes: sampleWav,
      wasmPaths: '/ort/',
      preferredProviders: ['wasm'],
      numThreads: 4,
      signal: cancelDuringHash.signal,
    });
    const hashWorker = workers.at(-1)!;
    const reqHashCancel = hashWorker.postedMessages[0]
      .message as DemucsWorkerRequest;
    if (reqHashCancel.type !== 'run_separation') throw new Error('expected run');
    const validCompletedMsg = await buildCompletedPayload(
      reqHashCancel.jobId,
      testDescriptor,
      12
    );
    const digestSpy = vi
      .spyOn(globalThis.crypto.subtle, 'digest')
      .mockImplementation(async (alg, data) => {
        digestCalls += 1;
        if (digestCalls === 2) {
          cancelDuringHash.abort();
        }
        return await digestOrig(alg, data);
      });
    try {
      hashWorker.emitMessage(validCompletedMsg);
      await expect(pHashCancel).rejects.toMatchObject({ code: 'CANCELLED' });
    } finally {
      digestSpy.mockRestore();
    }

    // 6. Corrupt WAV chunk structure with matching SHA-256 must be rejected with CORRUPT_WAV
    const pCorruptWav = client.separate({
      descriptor: testDescriptor,
      modelSource: '/models/test.onnx',
      audioWavBytes: sampleWav,
      wasmPaths: '/ort/',
      preferredProviders: ['wasm'],
      numThreads: 4,
    });
    const reqCorrupt = hashWorker.postedMessages[2]
      .message as DemucsWorkerRequest;
    if (reqCorrupt.type !== 'run_separation') throw new Error('expected run');
    const corruptMsg = await buildCompletedPayload(
      reqCorrupt.jobId,
      testDescriptor,
      12
    );
    if (corruptMsg.type === 'completed') {
      const wavBytes = new Uint8Array(corruptMsg.orderedStems[0].wavBuffer);
      // Corrupt 'fmt ' chunk id while updating digest to match bytes
      wavBytes[12] = 0x78; // 'xmt '
      const digest = await computeSha256Hex(wavBytes);
      corruptMsg.orderedStems = corruptMsg.orderedStems.map((s, idx) =>
        idx === 0 ? { ...s, sha256: digest } : s
      );
    }
    hashWorker.emitMessage(corruptMsg);
    await expect(pCorruptWav).rejects.toMatchObject({ code: 'CORRUPT_WAV' });

    // 7. Small (< MAX_AUDIO_WAV_BYTES) valid 8-bit mono WAV exceeding MAX_SEPARATION_TOTAL_FRAMES fails RAM cap before cloning/Worker
    const hugeCount = MAX_SEPARATION_TOTAL_FRAMES + 2;
    const amplificationWav = new Uint8Array(44 + hugeCount);
    const ampView = new DataView(amplificationWav.buffer);
    amplificationWav.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
    ampView.setUint32(4, 36 + hugeCount, true);
    amplificationWav.set([0x57, 0x41, 0x56, 0x45], 8); // WAVE
    amplificationWav.set([0x66, 0x6d, 0x74, 0x20], 12); // fmt
    ampView.setUint32(16, 16, true);
    ampView.setUint16(20, 1, true); // PCM
    ampView.setUint16(22, 1, true); // mono
    ampView.setUint32(24, 44100, true);
    ampView.setUint32(28, 44100, true);
    ampView.setUint16(32, 1, true); // blockAlign = 1
    ampView.setUint16(34, 8, true); // 8-bit
    amplificationWav.set([0x64, 0x61, 0x74, 0x61], 36); // data
    ampView.setUint32(40, hugeCount, true);
    const postedBeforeAmp = hashWorker.postedMessages.length;
    await expect(
      client.separate({
        descriptor: testDescriptor,
        modelSource: '/models/test.onnx',
        audioWavBytes: amplificationWav,
        wasmPaths: '/ort/',
        preferredProviders: ['wasm'],
        numThreads: 4,
      })
    ).rejects.toMatchObject({ code: 'INVALID_AUDIO' });
    expect(hashWorker.postedMessages).toHaveLength(postedBeforeAmp);

    // 8. Rejecting digest error while cooperative cancel is pending still settles with CANCELLED (not OperationError)
    const abortOnDigestReject = new AbortController();
    const pDigestErrCancel = client.separate({
      descriptor: testDescriptor,
      modelSource: '/models/test.onnx',
      audioWavBytes: sampleWav,
      wasmPaths: '/ort/',
      preferredProviders: ['wasm'],
      numThreads: 4,
      signal: abortOnDigestReject.signal,
    });
    const reqDigestErr = hashWorker.postedMessages.at(-1)!
      .message as DemucsWorkerRequest;
    if (reqDigestErr.type !== 'run_separation') throw new Error('expected run');
    const validCompleted2 = await buildCompletedPayload(
      reqDigestErr.jobId,
      testDescriptor,
      12
    );
    const digestRejectSpy = vi
      .spyOn(globalThis.crypto.subtle, 'digest')
      .mockImplementation(async () => {
        abortOnDigestReject.abort();
        throw new DOMException('digest aborted', 'OperationError');
      });
    try {
      hashWorker.emitMessage(validCompleted2);
      await expect(pDigestErrCancel).rejects.toMatchObject({
        code: 'CANCELLED',
      });
    } finally {
      digestRejectSpy.mockRestore();
    }

    // 9. 8 kHz 300s+ WAV inside the WAV byte cap rejects BEFORE Worker transfer (not only in decoder)
    const lowRateDescriptor = {
      ...testDescriptor,
      sampleRate: 8000,
    };
    const over300sFrames = 8000 * 300 + 2;
    const lowRateWav = new Uint8Array(44 + over300sFrames);
    const lrView = new DataView(lowRateWav.buffer);
    lowRateWav.set([0x52, 0x49, 0x46, 0x46], 0);
    lrView.setUint32(4, 36 + over300sFrames, true);
    lowRateWav.set([0x57, 0x41, 0x56, 0x45], 8);
    lowRateWav.set([0x66, 0x6d, 0x74, 0x20], 12);
    lrView.setUint32(16, 16, true);
    lrView.setUint16(20, 1, true);
    lrView.setUint16(22, 1, true);
    lrView.setUint32(24, 8000, true);
    lrView.setUint32(28, 8000, true);
    lrView.setUint16(32, 1, true);
    lrView.setUint16(34, 8, true);
    lowRateWav.set([0x64, 0x61, 0x74, 0x61], 36);
    lrView.setUint32(40, over300sFrames, true);
    const postedBefore8k = hashWorker.postedMessages.length;
    await expect(
      client.separate({
        descriptor: lowRateDescriptor,
        modelSource: '/models/test.onnx',
        audioWavBytes: lowRateWav,
        wasmPaths: '/ort/',
        preferredProviders: ['wasm'],
        numThreads: 4,
      })
    ).rejects.toMatchObject({ code: 'INVALID_AUDIO' });
    expect(hashWorker.postedMessages).toHaveLength(postedBefore8k);

    client.dispose();
  });
});

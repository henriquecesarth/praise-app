import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  AudioSeparationError,
  DEFAULT_SEPARATION_MODEL_REGISTRY,
  HTDEMUCS_6S_ONNX_DESCRIPTOR,
  MAX_AUDIO_WAV_BYTES,
  MAX_MODEL_BYTES,
  computeSha256Hex,
  createOrtWebSessionAdapter,
  decodeWavToStereoFloat32,
  readBoundedResponseBytes,
  separateStereoAudio,
  type AudioSeparationModelDescriptor,
  type CanonicalStemId,
  type ExecutionProviderName,
  type SeparationProgressEvent,
  type SeparationTelemetryMetrics,
} from './demucs-onnx-separator';

export type ProviderSelectionMode = 'wasm' | 'webgpu-fallback' | 'webgpu';

export interface DemucsOnnxBenchmarkHarnessProps {
  initialModelUrl?: string;
  initialAudioUrl?: string;
  wasmPaths?: string;
  models?: readonly AudioSeparationModelDescriptor[];
}

interface StemPreviewItem {
  id: CanonicalStemId;
  labelPtBr: string;
  byteLength: number;
  sha256: string;
  rms: number;
  peak: number;
  totalFrames: number;
  objectUrl: string;
}

interface BenchmarkReportSnapshot {
  telemetry: SeparationTelemetryMetrics;
  stems: Array<Omit<StemPreviewItem, 'objectUrl'>>;
}

function providersForMode(
  mode: ProviderSelectionMode
): readonly ExecutionProviderName[] {
  switch (mode) {
    case 'webgpu':
      return ['webgpu'];
    case 'webgpu-fallback':
      return ['webgpu', 'wasm'];
    case 'wasm':
    default:
      return ['wasm'];
  }
}

export function DemucsOnnxBenchmarkHarness({
  initialModelUrl = '',
  initialAudioUrl = '',
  wasmPaths = '/ort/',
  models = DEFAULT_SEPARATION_MODEL_REGISTRY.list(),
}: DemucsOnnxBenchmarkHarnessProps) {
  const availableModels =
    models.length > 0 ? models : [HTDEMUCS_6S_ONNX_DESCRIPTOR];
  const [selectedModelId, setSelectedModelId] = useState<string>(
    availableModels[0].id
  );
  const [providerMode, setProviderMode] =
    useState<ProviderSelectionMode>('wasm');
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [modelUrl, setModelUrl] = useState<string>(initialModelUrl);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string>(initialAudioUrl);
  const [verifyChecksum, setVerifyChecksum] = useState<boolean>(true);

  const [status, setStatus] = useState<
    'idle' | 'running' | 'completed' | 'cancelled' | 'error'
  >('idle');
  const [isCleaningUp, setIsCleaningUp] = useState<boolean>(false);
  const [progress, setProgress] = useState<SeparationProgressEvent | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<SeparationTelemetryMetrics | null>(
    null
  );
  const [stemPreviews, setStemPreviews] = useState<StemPreviewItem[]>([]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const runGenerationRef = useRef<number>(0);
  const inFlightRunRef = useRef<boolean>(false);
  const unmountedRef = useRef<boolean>(false);
  const activeUrlsRef = useRef<string[]>([]);

  const revokeActiveUrls = () => {
    for (const url of activeUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    activeUrlsRef.current = [];
  };

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      runGenerationRef.current += 1;
      abortControllerRef.current?.abort();
      revokeActiveUrls();
    };
  }, []);

  const activeDescriptor =
    availableModels.find((m) => m.id === selectedModelId) ?? availableModels[0];
  const isPinnedModel = Boolean(
    activeDescriptor.expectedModelSha256 ||
      activeDescriptor.expectedModelBytes !== undefined
  );
  const effectiveVerifyChecksum = isPinnedModel ? true : verifyChecksum;
  const isBusy = status === 'running' || isCleaningUp;

  const handleModelFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setModelFile(file);
  };

  const handleAudioFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setAudioFile(file);
  };

  const handleCancel = () => {
    runGenerationRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    revokeActiveUrls();
    setStemPreviews([]);
    setTelemetry(null);
    setProgress(null);
    setStatus('cancelled');
    if (inFlightRunRef.current) {
      setIsCleaningUp(true);
      setErrorMessage('Cancelando e liberando sessão anterior...');
    } else {
      setErrorMessage('Separação cancelada.');
    }
  };

  const handleRunSeparation = async () => {
    if (inFlightRunRef.current) {
      return;
    }
    inFlightRunRef.current = true;
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const generation = ++runGenerationRef.current;

    revokeActiveUrls();
    setStemPreviews([]);
    setTelemetry(null);
    setErrorMessage(null);
    setProgress(null);
    setIsCleaningUp(false);
    setStatus('running');

    const createdUrlsForRun: string[] = [];

    try {
      const modelSource = modelFile ?? modelUrl.trim();
      if (!modelSource) {
        throw new AudioSeparationError(
          'INVALID_MODEL_SOURCE',
          'Selecione um arquivo .onnx local ou informe uma URL local do modelo.'
        );
      }
      if (modelFile && modelFile.size > MAX_MODEL_BYTES) {
        throw new AudioSeparationError(
          'INVALID_MODEL_SOURCE',
          `Arquivo .onnx excede o limite de ${(MAX_MODEL_BYTES / (1024 * 1024)).toFixed(0)} MiB.`
        );
      }

      let audioBytes: Uint8Array;
      if (audioFile) {
        if (audioFile.size <= 0) {
          throw new AudioSeparationError('EMPTY_AUDIO', 'Arquivo WAV vazio.');
        }
        if (audioFile.size > MAX_AUDIO_WAV_BYTES) {
          throw new AudioSeparationError(
            'INVALID_AUDIO',
            `Arquivo WAV excede o limite de ${(MAX_AUDIO_WAV_BYTES / (1024 * 1024)).toFixed(0)} MiB para o benchmark.`
          );
        }
        const buf = await audioFile.arrayBuffer();
        if (buf.byteLength > MAX_AUDIO_WAV_BYTES) {
          throw new AudioSeparationError(
            'INVALID_AUDIO',
            `Arquivo WAV excede o limite de ${(MAX_AUDIO_WAV_BYTES / (1024 * 1024)).toFixed(0)} MiB.`
          );
        }
        audioBytes = new Uint8Array(buf);
      } else if (audioUrl.trim()) {
        const res = await fetch(audioUrl.trim(), { signal: controller.signal });
        if (!res.ok) {
          throw new AudioSeparationError(
            'INVALID_AUDIO',
            `Falha ao carregar áudio (${res.status} ${res.statusText}).`
          );
        }
        audioBytes = await readBoundedResponseBytes(
          res,
          MAX_AUDIO_WAV_BYTES,
          'INVALID_AUDIO',
          'WAV audio'
        );
      } else {
        throw new AudioSeparationError(
          'EMPTY_AUDIO',
          'Selecione um arquivo .wav (44.1 kHz) ou informe uma URL local.'
        );
      }

      if (generation !== runGenerationRef.current || controller.signal.aborted) {
        return;
      }

      const inputSha256 = await computeSha256Hex(audioBytes);
      const audioArrayBuffer = audioBytes.slice().buffer;
      const decoded = decodeWavToStereoFloat32(audioArrayBuffer, {
        expectedSampleRate: activeDescriptor.sampleRate,
      });

      const result = await separateStereoAudio(decoded, {
        descriptor: activeDescriptor,
        inputSha256,
        signal: controller.signal,
        onProgress: (evt) => {
          if (
            generation === runGenerationRef.current &&
            !controller.signal.aborted
          ) {
            setProgress(evt);
          }
        },
        createSession: (descriptor) =>
          createOrtWebSessionAdapter(modelSource, descriptor, {
            wasmPaths,
            preferredProviders: providersForMode(providerMode),
            verifyModelChecksum: effectiveVerifyChecksum,
            signal: controller.signal,
          }),
      });

      if (generation !== runGenerationRef.current || controller.signal.aborted) {
        return;
      }

      const previews: StemPreviewItem[] = result.orderedStems.map((stem) => {
        const copy = new Uint8Array(stem.wavBytes.byteLength);
        copy.set(stem.wavBytes);
        const blob = new Blob([copy.buffer], { type: 'audio/wav' });
        const objectUrl = URL.createObjectURL(blob);
        createdUrlsForRun.push(objectUrl);
        return {
          id: stem.id,
          labelPtBr: stem.labelPtBr,
          byteLength: stem.byteLength,
          sha256: stem.sha256,
          rms: stem.rms,
          peak: stem.peak,
          totalFrames: stem.totalFrames,
          objectUrl,
        };
      });

      if (generation !== runGenerationRef.current || controller.signal.aborted) {
        for (const url of createdUrlsForRun) {
          URL.revokeObjectURL(url);
        }
        return;
      }

      activeUrlsRef.current = createdUrlsForRun;
      setTelemetry(result.telemetry);
      setStemPreviews(previews);
      setStatus('completed');
    } catch (err) {
      for (const url of createdUrlsForRun) {
        URL.revokeObjectURL(url);
      }
      if (generation !== runGenerationRef.current) {
        return;
      }
      if (
        controller.signal.aborted ||
        (err instanceof AudioSeparationError && err.code === 'CANCELLED') ||
        (err instanceof DOMException && err.name === 'AbortError')
      ) {
        setStatus('cancelled');
        setErrorMessage('Separação cancelada.');
        return;
      }
      setStatus('error');
      setErrorMessage(
        err instanceof Error ? err.message : 'Erro desconhecido na separação.'
      );
    } finally {
      inFlightRunRef.current = false;
      if (!unmountedRef.current) {
        setIsCleaningUp(false);
        if (controller.signal.aborted) {
          setStatus('cancelled');
          setErrorMessage('Separação cancelada.');
        }
      }
    }
  };

  const reportSnapshot: BenchmarkReportSnapshot | null = telemetry
    ? {
        telemetry,
        stems: stemPreviews.map(({ objectUrl: _ignored, ...rest }) => rest),
      }
    : null;

  return (
    <section
      data-testid="m22a-benchmark-harness"
      style={{
        maxWidth: '920px',
        margin: '0 auto',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      <header>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>
          LouvAIO M22-A — Benchmark Local Demucs ONNX (6 Faixas)
        </h1>
        <p style={{ margin: '6px 0 0', opacity: 0.85, fontSize: '0.92rem' }}>
          Inferência 100% local no navegador via ONNX Runtime Web. Faixas:{' '}
          {activeDescriptor.canonicalStemOrder.join(', ')}.
        </p>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '12px',
          padding: '14px',
          border: '1px solid var(--border-color, #d4d4d8)',
          borderRadius: '12px',
        }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span>Modelo registrado</span>
          <select
            data-testid="m22a-model-select"
            value={selectedModelId}
            onChange={(e) => setSelectedModelId(e.target.value)}
            disabled={isBusy}
            style={{ minHeight: '44px', padding: '0 10px' }}
          >
            {availableModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.displayName} ({model.version})
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span>Execution Provider</span>
          <select
            data-testid="m22a-provider-select"
            value={providerMode}
            onChange={(e) =>
              setProviderMode(e.target.value as ProviderSelectionMode)
            }
            disabled={isBusy}
            style={{ minHeight: '44px', padding: '0 10px' }}
          >
            <option value="wasm">WASM SIMD (CPU Baseline)</option>
            <option value="webgpu-fallback">Auto (WebGPU -&gt; WASM)</option>
            <option value="webgpu">WebGPU somente</option>
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span>Arquivo .onnx local</span>
          <input
            type="file"
            accept=".onnx"
            data-testid="m22a-model-file-input"
            onChange={handleModelFileChange}
            disabled={isBusy}
            style={{ minHeight: '44px' }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span>URL local do modelo .onnx (opcional)</span>
          <input
            type="text"
            data-testid="m22a-model-url-input"
            value={modelUrl}
            onChange={(e) => setModelUrl(e.target.value)}
            placeholder="/models/htdemucs_6s_fp16weights.onnx"
            disabled={isBusy}
            style={{ minHeight: '44px', padding: '0 10px' }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span>Áudio WAV 44.1 kHz</span>
          <input
            type="file"
            accept=".wav,audio/wav"
            data-testid="m22a-audio-file-input"
            onChange={handleAudioFileChange}
            disabled={isBusy}
            style={{ minHeight: '44px' }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span>URL local do áudio WAV (opcional)</span>
          <input
            type="text"
            data-testid="m22a-audio-url-input"
            value={audioUrl}
            onChange={(e) => setAudioUrl(e.target.value)}
            placeholder="/fixtures/mix.wav"
            disabled={isBusy}
            style={{ minHeight: '44px', padding: '0 10px' }}
          />
        </label>
      </div>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          minHeight: '44px',
        }}
      >
        <input
          type="checkbox"
          data-testid="m22a-verify-checksum"
          checked={effectiveVerifyChecksum}
          onChange={(e) => setVerifyChecksum(e.target.checked)}
          disabled={isBusy || isPinnedModel}
        />
        <span>
          Validar SHA-256 esperado do modelo antes de inicializar sessão
          {isPinnedModel ? ' (obrigatório para modelo fixado)' : ''}
        </span>
      </label>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
        <button
          type="button"
          data-testid="m22a-run-button"
          onClick={() => {
            void handleRunSeparation();
          }}
          disabled={isBusy}
          style={{
            minHeight: '44px',
            padding: '0 18px',
            fontWeight: 600,
            cursor: isBusy ? 'not-allowed' : 'pointer',
          }}
        >
          Executar separação (6 faixas)
        </button>

        <button
          type="button"
          data-testid="m22a-cancel-button"
          onClick={handleCancel}
          disabled={status !== 'running' || isCleaningUp}
          style={{
            minHeight: '44px',
            padding: '0 18px',
            cursor:
              status !== 'running' || isCleaningUp ? 'not-allowed' : 'pointer',
          }}
        >
          {isCleaningUp ? 'Cancelando...' : 'Cancelar'}
        </button>
      </div>

      <div
        data-testid="m22a-status"
        data-status={status}
        data-cleaning-up={isCleaningUp ? 'true' : 'false'}
        role="status"
        aria-live="polite"
      >
        Estado: <strong>{status}</strong>
        {progress && (
          <span data-testid="m22a-progress" style={{ marginLeft: '10px' }}>
            {progress.phase} ({progress.chunkIndex}/{progress.totalChunks} —{' '}
            {Math.round(progress.fraction * 100)}%)
          </span>
        )}
      </div>

      {errorMessage && (
        <div
          data-testid="m22a-error"
          role="alert"
          style={{
            padding: '12px',
            border: '1px solid #dc2626',
            borderRadius: '8px',
          }}
        >
          {errorMessage}
        </div>
      )}

      {telemetry && (
        <div
          data-testid="m22a-telemetry"
          style={{
            padding: '14px',
            border: '1px solid var(--border-color, #d4d4d8)',
            borderRadius: '12px',
          }}
        >
          <h2 style={{ fontSize: '1.05rem', marginTop: 0 }}>
            Métricas reais de desempenho
          </h2>
          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '8px',
              margin: 0,
            }}
          >
            <div>
              <dt>Provider</dt>
              <dd>{telemetry.executionProvider}</dd>
            </div>
            <div>
              <dt>ORT Web</dt>
              <dd>{telemetry.ortVersion}</dd>
            </div>
            <div>
              <dt>Duração do áudio</dt>
              <dd>{telemetry.audioDurationSeconds.toFixed(2)} s</dd>
            </div>
            <div>
              <dt>Carga do modelo</dt>
              <dd>{telemetry.modelLoadMs.toFixed(1)} ms</dd>
            </div>
            <div>
              <dt>Inferência ONNX</dt>
              <dd>{telemetry.inferenceMs.toFixed(1)} ms</dd>
            </div>
            <div>
              <dt>Tempo total</dt>
              <dd>{telemetry.totalWallMs.toFixed(1)} ms</dd>
            </div>
            <div>
              <dt>RTF (inferência / áudio)</dt>
              <dd>{telemetry.rtf.toFixed(3)}x</dd>
            </div>
            <div>
              <dt>Chunks processados</dt>
              <dd>{telemetry.chunksProcessed}</dd>
            </div>
            <div>
              <dt>Erro máx. reconstrução</dt>
              <dd>{telemetry.reconstructionMaxAbsError.toExponential(3)}</dd>
            </div>
          </dl>
        </div>
      )}

      {stemPreviews.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: '12px',
          }}
        >
          {stemPreviews.map((stem) => (
            <article
              key={stem.id}
              data-testid={`m22a-stem-card-${stem.id}`}
              style={{
                padding: '12px',
                border: '1px solid var(--border-color, #d4d4d8)',
                borderRadius: '10px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <strong>
                {stem.labelPtBr} ({stem.id})
              </strong>
              <span style={{ fontSize: '0.82rem' }}>
                RMS: {stem.rms.toFixed(5)} | Pico: {stem.peak.toFixed(5)}
              </span>
              <span style={{ fontSize: '0.82rem' }}>
                {stem.totalFrames} frames | {(stem.byteLength / 1024).toFixed(1)} KiB
              </span>
              <code style={{ fontSize: '0.72rem', wordBreak: 'break-all' }}>
                sha256: {stem.sha256}
              </code>
              <audio
                controls
                src={stem.objectUrl}
                style={{ width: '100%', minHeight: '44px' }}
              />
              <a
                href={stem.objectUrl}
                download={`${stem.id}.wav`}
                style={{
                  minHeight: '44px',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                Baixar {stem.id}.wav
              </a>
            </article>
          ))}
        </div>
      )}

      {reportSnapshot && (
        <pre
          data-testid="m22a-report-json"
          style={{
            fontSize: '0.75rem',
            overflow: 'auto',
            padding: '10px',
            borderRadius: '8px',
            border: '1px solid var(--border-color, #d4d4d8)',
          }}
        >
          {JSON.stringify(reportSnapshot, null, 2)}
        </pre>
      )}
    </section>
  );
}

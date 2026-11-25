import { useEffect, useMemo, useRef, useState } from 'react';
import { createSeparationDraft, type SeparationDraft } from '../audio/local-separation-draft';
import { Mp3StemDecoder, type Mp3DecodeBackend } from '../audio/mp3-stem-decoder';
import { Mp3EncodingWorkerClient } from '../audio/mp3-encoding/mp3-encoding-worker-client';
import {
  Mp3CompressionError,
  compressSeparationDraft,
  type CompressedStemEntry,
  type CompressionProgress,
  type Mp3CompressedDraft,
  type Mp3StemDecoderLike,
  type Mp3StemEncoderLike,
} from '../audio/mp3-encoding/mp3-draft-compression';
import { Mp3ImportError } from '../audio/original-mp3-import';
import { prepareSeparationInput } from '../audio/separation-input';
import {
  AudioSeparationError,
  HTDEMUCS_6S_ONNX_DESCRIPTOR,
  type CanonicalStemId,
  type SeparationProgressEvent,
} from '../audio/separation/demucs-onnx-separator';
import { DemucsSeparationWorkerClient } from '../audio/separation/demucs-worker-client';
import { SixStemMixerPanel } from '../audio/separation/SixStemMixerPanel';
import { AUDIO_ACTIONS, AUDIO_CARD, AUDIO_FORM_FIELD, AUDIO_FORM_INPUT } from './ministry-audio-form';
import { createLibraryMixer } from './ministry-audio-mixer';

// M22-C.5D-C4-B — local stem separation for the ministry library (administrators, emulator-only library).
// Everything runs in this browser: a Web Worker, a local WAV and a local ONNX file; nothing is uploaded here and nothing is
// published here. The user listens to the six stems first and must explicitly choose to prepare the publication.
//
// M22-S2 — experimental, OFF by default (VITE_EXPERIMENTAL_MP3_COMPRESSION=true): after the WAV preview the user may ask to
// compress the six stems to MP3 CBR 256 locally, see the real savings and listen to the compressed result. This never
// publishes anything and never replaces the WAV draft: "Preparar publicação" keeps handing over the WAV files.

type Status = 'idle' | 'separating' | 'ready' | 'error';
type CompressionStatus = 'idle' | 'compressing' | 'done' | 'error';
type PreviewSource = 'wav' | 'mp3';

const EXPERIMENTAL_MP3_COMPRESSION = import.meta.env.VITE_EXPERIMENTAL_MP3_COMPRESSION === 'true';

const PHASE_LABEL: Record<SeparationProgressEvent['phase'], string> = {
  loading_model: 'Carregando e verificando o modelo…',
  separating: 'Separando as faixas…',
  encoding: 'Codificando os WAVs…',
  complete: 'Concluído.',
};

const isCancel = (reason: unknown) =>
  (reason instanceof Mp3ImportError && reason.code === 'CANCELLED') || (reason instanceof AudioSeparationError && reason.code === 'CANCELLED') || (reason instanceof DOMException && reason.name === 'AbortError');

const formatMegabytes = (bytes: number) => `${(bytes / 1_000_000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;

export function MinistryAudioLocalSeparation({
  onPrepare, onClose, createWorkerClient, mp3Backend, experimentalMp3Compression = EXPERIMENTAL_MP3_COMPRESSION, createMp3Encoder, mp3Decoder,
}: {
  onPrepare: (draft: SeparationDraft) => void;
  onClose: () => void;
  /** Test seam; production always uses the real Worker client. */
  createWorkerClient?: () => DemucsSeparationWorkerClient;
  /** Test seam for the MP3 decoder: undefined uses the browser's OfflineAudioContext, null simulates a browser without it. */
  mp3Backend?: Mp3DecodeBackend | null;
  /** Experimental MP3 compression of the draft (default: the build flag, disabled). */
  experimentalMp3Compression?: boolean;
  /** Test seam; production uses the Worker client. */
  createMp3Encoder?: () => Mp3StemEncoderLike & { dispose?: () => void };
  /** Test seam; production decodes with the browser (calibrated). */
  mp3Decoder?: Mp3StemDecoderLike;
}) {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState<SeparationProgressEvent | null>(null);
  const [preparingAudio, setPreparingAudio] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SeparationDraft | null>(null);
  const [compression, setCompression] = useState<CompressionStatus>('idle');
  const [compressionProgress, setCompressionProgress] = useState<CompressionProgress | null>(null);
  const [compressionError, setCompressionError] = useState<string | null>(null);
  const [compressed, setCompressed] = useState<Mp3CompressedDraft | null>(null);
  const [preview, setPreview] = useState<PreviewSource>('wav');
  const run = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const client = useRef<DemucsSeparationWorkerClient | null>(null);
  const owned = useRef<SeparationDraft | null>(null);
  const factory = useRef(createWorkerClient);
  factory.current = createWorkerClient;
  const compressionRun = useRef(0);
  const compressionController = useRef<AbortController | null>(null);
  const compressionEncoder = useRef<(Mp3StemEncoderLike & { dispose?: () => void }) | null>(null);
  const completedStems = useRef(new Map<CanonicalStemId, CompressedStemEntry>());
  const ownedCompressed = useRef<Mp3CompressedDraft | null>(null);
  const encoderFactory = useRef(createMp3Encoder);
  encoderFactory.current = createMp3Encoder;

  function releaseWorker() {
    const current = client.current;
    client.current = null;
    current?.dispose();
  }

  /** Aborts any compression and drops every compressed buffer and partial result. The WAV draft is never touched here. */
  function discardCompression() {
    compressionRun.current += 1;
    compressionController.current?.abort();
    compressionController.current = null;
    compressionEncoder.current?.dispose?.();
    compressionEncoder.current = null;
    completedStems.current.clear();
    ownedCompressed.current?.dispose();
    ownedCompressed.current = null;
    setCompressed(null);
    setCompression('idle');
    setCompressionProgress(null);
    setCompressionError(null);
    setPreview('wav');
  }

  function discardDraft() {
    discardCompression();
    owned.current?.dispose();
    owned.current = null;
    setDraft(null);
  }

  // Leaving the screen (or the ministry/session that owns it) cancels the job and drops every buffer not handed over.
  useEffect(() => () => {
    run.current += 1;
    controller.current?.abort();
    releaseWorker();
    compressionRun.current += 1;
    compressionController.current?.abort();
    compressionEncoder.current?.dispose?.();
    ownedCompressed.current?.dispose();
    ownedCompressed.current = null;
    completedStems.current.clear();
    owned.current?.dispose();
    owned.current = null;
  }, []);

  async function separate() {
    if (status === 'separating' || compression === 'compressing') return;
    if (!audioFile || !modelFile) {
      setError('Selecione o arquivo da música (MP3 ou WAV) e o arquivo do modelo ONNX.');
      setStatus('error');
      return;
    }
    if (modelFile.size !== HTDEMUCS_6S_ONNX_DESCRIPTOR.expectedModelBytes) {
      setError('Este arquivo não corresponde ao modelo HT-Demucs 6 faixas suportado.');
      setStatus('error');
      return;
    }

    const mine = run.current + 1;
    run.current = mine;
    const abort = new AbortController();
    controller.current = abort;
    discardDraft();
    setError(null);
    setProgress(null);
    setPreparingAudio(false);
    setStatus('separating');
    const current = () => run.current === mine && !abort.signal.aborted;
    try {
      // WAV passes through untouched; MP3 is decoded here into PCM16 stereo 44.1 kHz. Cancelling drops a late decode result.
      const input = await prepareSeparationInput(audioFile, {
        signal: abort.signal, backend: mp3Backend, onDecoding: () => { if (current()) setPreparingAudio(true); },
      });
      abort.signal.throwIfAborted();
      setPreparingAudio(false);
      const wav = input.wavBytes;
      client.current = factory.current ? factory.current() : new DemucsSeparationWorkerClient();
      const result = await client.current.separate({
        descriptor: HTDEMUCS_6S_ONNX_DESCRIPTOR,
        modelSource: modelFile,
        audioWavBytes: wav,
        transferInputBuffer: true,
        retainPcmChannels: false, // the draft only needs the six WAVs: skip ~48 B/frame of Float32 PCM end to end
        preferredProviders: ['webgpu', 'wasm'],
        verifyModelChecksum: true, // the pinned SHA-256 is always enforced
        useModelBytesCache: false,
        reuseWarmSession: false,
        signal: abort.signal,
        onProgress: (event) => { if (current()) setProgress(event); },
      });
      if (!current()) return;
      const next = await createSeparationDraft(result, abort.signal);
      if (!current()) { next.dispose(); return; }
      owned.current = next;
      setDraft(next);
      setStatus('ready');
    } catch (reason) {
      if (run.current !== mine) return;
      if (abort.signal.aborted || isCancel(reason)) {
        setError('Separação cancelada.');
      } else {
        setError(reason instanceof Error ? reason.message : 'Falha na separação local.');
      }
      setStatus('error');
    } finally {
      if (run.current === mine) {
        setPreparingAudio(false);
        // The model and the ONNX session are released as soon as the job ends: they are the largest buffers in the flow.
        releaseWorker();
        controller.current = null;
      }
    }
  }

  function cancel() {
    controller.current?.abort();
    client.current?.cancelActiveJob();
  }

  async function compress() {
    const target = owned.current;
    if (!target || target.disposed || status !== 'ready' || compression === 'compressing' || ownedCompressed.current) return;
    const mine = compressionRun.current + 1;
    compressionRun.current = mine;
    const abort = new AbortController();
    compressionController.current = abort;
    const current = () => compressionRun.current === mine && !abort.signal.aborted && owned.current === target;
    setCompression('compressing');
    setCompressionError(null);
    setCompressionProgress(null);
    let encoder: (Mp3StemEncoderLike & { dispose?: () => void }) | null = null;
    try {
      // The decoder is needed to calibrate the delay and to verify every stem; without browser MP3 decoding nothing is encoded.
      let decoder: Mp3StemDecoderLike;
      try {
        decoder = mp3Decoder ?? new Mp3StemDecoder({ backend: mp3Backend });
      } catch {
        throw new Mp3CompressionError('FAILED', 'Este navegador não consegue decodificar MP3, então a compressão não pode ser verificada.');
      }
      encoder = encoderFactory.current ? encoderFactory.current() : new Mp3EncodingWorkerClient();
      compressionEncoder.current = encoder;
      const result = await compressSeparationDraft({
        draft: target, encoder, decoder, signal: abort.signal, completed: completedStems.current,
        onProgress: (event) => { if (current()) setCompressionProgress(event); },
      });
      if (!current()) { result.dispose(); return; }
      ownedCompressed.current = result;
      setCompressed(result);
      setCompression('done');
    } catch (reason) {
      if (compressionRun.current !== mine) return;
      if (abort.signal.aborted || (reason instanceof Mp3CompressionError && reason.code === 'CANCELLED')) {
        setCompressionError('Compressão cancelada. Os WAV foram mantidos.');
      } else {
        setCompressionError(reason instanceof Error ? reason.message : 'Falha ao comprimir as faixas. Os WAV foram mantidos.');
      }
      setCompression('error');
    } finally {
      if (compressionRun.current === mine) {
        // One Worker per run; terminating it frees the WebAssembly memory right away.
        encoder?.dispose?.();
        compressionEncoder.current = null;
        compressionController.current = null;
      }
    }
  }

  function cancelCompression() {
    compressionController.current?.abort();
  }

  function prepare() {
    if (!owned.current || owned.current.disposed || compression === 'compressing') return;
    const handedOver = owned.current;
    owned.current = null; // ownership moves to the publication form; this screen no longer disposes it
    // The experimental compressed copy is not handed over: publishing MP3 is not enabled, the WAV files are what is prepared.
    ownedCompressed.current?.dispose();
    ownedCompressed.current = null;
    completedStems.current.clear();
    onPrepare(handedOver);
  }

  const inputs = useMemo(() => (draft && !draft.disposed ? draft.mixerInputs() : null), [draft]);
  const mp3Inputs = useMemo(() => (compressed && !compressed.disposed ? compressed.mixerInputs() : null), [compressed]);
  const busy = status === 'separating';
  const compressing = compression === 'compressing';
  const showCompression = experimentalMp3Compression && status === 'ready' && draft && !draft.disposed;
  const previewingMp3 = preview === 'mp3' && mp3Inputs !== null;

  return (
    <section className={AUDIO_CARD} aria-label="Separar música localmente">
      <h3 className="text-lg font-semibold">Separar música neste dispositivo</h3>
      <p className="text-sm text-[var(--text-secondary)]">
        O processamento acontece no seu navegador, sem enviar o áudio para nenhum serviço de separação. Selecione uma música em MP3 ou WAV com até 300 segundos (5 minutos; o MP3 é convertido aqui mesmo, sem você precisar ajustar taxa de amostragem ou canais) e o modelo ONNX HT-Demucs 6 faixas (fp16) já baixado por você.
        O desempenho e a memória dependem do dispositivo e não são garantidos.
      </p>
      <fieldset disabled={busy || compressing} className="grid min-w-0 gap-3">
        <label className={AUDIO_FORM_FIELD}>
          Arquivo da música
          <input type="file" accept=".mp3,.wav,audio/mpeg,audio/mp3,audio/wav,audio/x-wav"className={AUDIO_FORM_INPUT} data-testid="separation-audio"
            onChange={(event) => setAudioFile(event.target.files?.[0] ?? null)} />
        </label>
        <label className={AUDIO_FORM_FIELD}>
          Modelo ONNX local
          <input type="file" accept=".onnx" className={AUDIO_FORM_INPUT} data-testid="separation-model"
            onChange={(event) => setModelFile(event.target.files?.[0] ?? null)} />
        </label>
      </fieldset>
      {busy && (
        <p role="status">
          {progress
            ? `${PHASE_LABEL[progress.phase]} ${Math.round(progress.fraction * 100)}%`
            : preparingAudio ? 'Preparando áudio… decodificando o MP3 e convertendo para a separação.' : 'Preparando a separação…'}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className={AUDIO_ACTIONS}>
        {!busy && status !== 'ready' && (
          <button type="button" className="btn btn-primary min-h-[44px]" onClick={() => void separate()}>Separar faixas</button>
        )}
        {busy && <button type="button" className="btn btn-secondary min-h-[44px]" onClick={cancel}>Cancelar separação</button>}
        {!busy && <button type="button" className="btn btn-secondary min-h-[44px]" disabled={compressing} onClick={() => { discardDraft(); onClose(); }}>Fechar</button>}
      </div>
      {status === 'ready' && draft && inputs && (
        <div className="grid gap-3">
          <h4 className="font-semibold">{previewingMp3 ? 'Pré-escuta das seis faixas (MP3 comprimido)' : 'Pré-escuta das seis faixas'}</h4>
          {/* One mixer at a time: switching the source unmounts the previous mixer (and its buffers) before the next one loads. */}
          {previewingMp3 ? (
            <SixStemMixerPanel
              key="mp3-preview" playbackOnly stems={mp3Inputs} metadata={{ modelId: draft.model.id, modelVersion: draft.model.version }}
              createController={createLibraryMixer} onPlaybackError={(message) => setError(message)}
            />
          ) : (
            <SixStemMixerPanel
              key="wav-preview" playbackOnly stems={inputs} metadata={{ modelId: draft.model.id, modelVersion: draft.model.version }}
              createController={createLibraryMixer} onPlaybackError={(message) => setError(message)}
            />
          )}
          {showCompression && (
            <div className="grid gap-2" aria-label="Compressão experimental para publicação">
              <h4 className="font-semibold">Compressão para publicar (experimental)</h4>
              {compression === 'idle' && (
                <>
                  <p className="text-sm text-[var(--text-secondary)]">
                    Comprime as seis faixas para MP3 (256 kbps) neste dispositivo. Os WAV continuam guardados e nada é publicado. Só comprima depois de ouvir e decidir manter a separação.
                  </p>
                  <div className={AUDIO_ACTIONS}>
                    <button type="button" className="btn btn-secondary min-h-[44px]" onClick={() => void compress()}>Comprimir para publicar</button>
                  </div>
                </>
              )}
              {compressing && (
                <>
                  <p role="status">
                    {compressionProgress
                      ? `${compressionProgress.phase === 'encoding' ? 'Comprimindo' : 'Verificando'} ${compressionProgress.label} (${compressionProgress.stemIndex + 1} de ${compressionProgress.stemCount})… ${Math.round(compressionProgress.overall * 100)}% no total`
                      : 'Preparando a compressão…'}
                  </p>
                  <progress className="w-full" max={100} value={Math.round((compressionProgress?.overall ?? 0) * 100)} aria-label="Progresso da compressão" />
                  <div className={AUDIO_ACTIONS}>
                    <button type="button" className="btn btn-secondary min-h-[44px]" onClick={cancelCompression}>Cancelar compressão</button>
                  </div>
                </>
              )}
              {compression === 'error' && (
                <>
                  <p role="alert">{compressionError}</p>
                  <div className={AUDIO_ACTIONS}>
                    <button type="button" className="btn btn-secondary min-h-[44px]" onClick={() => void compress()}>Tentar novamente</button>
                    <button type="button" className="btn btn-secondary min-h-[44px]" onClick={discardCompression}>Descartar compressão</button>
                  </div>
                </>
              )}
              {compression === 'done' && compressed && (
                <>
                  <p role="status">
                    {`WAV: ${formatMegabytes(compressed.wavBytesTotal)} → MP3: ${formatMegabytes(compressed.mp3BytesTotal)}. Economia de ${(compressed.savingsRatio * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%.`}
                  </p>
                  <p className="text-sm text-[var(--text-secondary)]">
                    O MP3 ocupa cerca de um quinto do espaço do WAV, o que reduz o armazenamento e o tempo de download. As seis faixas foram verificadas (integridade, duração e alinhamento). A publicação em MP3 ainda não está habilitada: ao preparar a publicação serão usados os WAV.
                  </p>
                  <div className={AUDIO_ACTIONS}>
                    {previewingMp3
                      ? <button type="button" className="btn btn-secondary min-h-[44px]" onClick={() => setPreview('wav')}>Voltar ao WAV</button>
                      : <button type="button" className="btn btn-secondary min-h-[44px]" onClick={() => setPreview('mp3')}>Ouvir versão comprimida (MP3)</button>}
                    <button type="button" className="btn btn-secondary min-h-[44px]" onClick={discardCompression}>Descartar compressão</button>
                  </div>
                </>
              )}
            </div>
          )}
          <p className="text-sm text-[var(--text-secondary)]">Nada foi publicado. Revise as faixas e, se quiser guardá-las no ministério, prepare a publicação.</p>
          <div className={AUDIO_ACTIONS}>
            <button type="button" className="btn btn-primary min-h-[44px]" disabled={compressing} onClick={prepare}>Preparar publicação</button>
            <button type="button" className="btn btn-secondary min-h-[44px]" disabled={compressing} onClick={() => { discardDraft(); setError(null); setStatus('idle'); }}>Descartar faixas</button>
          </div>
        </div>
      )}
    </section>
  );
}

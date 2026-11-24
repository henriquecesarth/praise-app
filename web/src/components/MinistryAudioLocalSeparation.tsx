import { useEffect, useMemo, useRef, useState } from 'react';
import { createSeparationDraft, type SeparationDraft } from '../audio/local-separation-draft';
import type { Mp3DecodeBackend } from '../audio/mp3-stem-decoder';
import { Mp3ImportError } from '../audio/original-mp3-import';
import { prepareSeparationInput } from '../audio/separation-input';
import {
  AudioSeparationError,
  HTDEMUCS_6S_ONNX_DESCRIPTOR,
  type SeparationProgressEvent,
} from '../audio/separation/demucs-onnx-separator';
import { DemucsSeparationWorkerClient } from '../audio/separation/demucs-worker-client';
import { SixStemMixerPanel } from '../audio/separation/SixStemMixerPanel';
import { AUDIO_ACTIONS, AUDIO_CARD, AUDIO_FORM_FIELD, AUDIO_FORM_INPUT } from './ministry-audio-form';
import { createLibraryMixer } from './ministry-audio-mixer';

// M22-C.5D-C4-B — local stem separation for the ministry library (administrators, emulator-only library).
// Everything runs in this browser: a Web Worker, a local WAV and a local ONNX file; nothing is uploaded here and nothing is
// published here. The user listens to the six stems first and must explicitly choose to prepare the publication.

type Status = 'idle' | 'separating' | 'ready' | 'error';

const PHASE_LABEL: Record<SeparationProgressEvent['phase'], string> = {
  loading_model: 'Carregando e verificando o modelo…',
  separating: 'Separando as faixas…',
  encoding: 'Codificando os WAVs…',
  complete: 'Concluído.',
};

const isCancel = (reason: unknown) =>
  (reason instanceof Mp3ImportError && reason.code === 'CANCELLED') || (reason instanceof AudioSeparationError && reason.code === 'CANCELLED') || (reason instanceof DOMException && reason.name === 'AbortError');

export function MinistryAudioLocalSeparation({ onPrepare, onClose, createWorkerClient, mp3Backend }: {
  onPrepare: (draft: SeparationDraft) => void;
  onClose: () => void;
  /** Test seam; production always uses the real Worker client. */
  createWorkerClient?: () => DemucsSeparationWorkerClient;
  /** Test seam for the MP3 decoder: undefined uses the browser's OfflineAudioContext, null simulates a browser without it. */
  mp3Backend?: Mp3DecodeBackend | null;
}) {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState<SeparationProgressEvent | null>(null);
  const [preparingAudio, setPreparingAudio] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SeparationDraft | null>(null);
  const run = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const client = useRef<DemucsSeparationWorkerClient | null>(null);
  const owned = useRef<SeparationDraft | null>(null);
  const factory = useRef(createWorkerClient);
  factory.current = createWorkerClient;

  function releaseWorker() {
    const current = client.current;
    client.current = null;
    current?.dispose();
  }

  function discardDraft() {
    owned.current?.dispose();
    owned.current = null;
    setDraft(null);
  }

  // Leaving the screen (or the ministry/session that owns it) cancels the job and drops every buffer not handed over.
  useEffect(() => () => {
    run.current += 1;
    controller.current?.abort();
    releaseWorker();
    owned.current?.dispose();
    owned.current = null;
  }, []);

  async function separate() {
    if (status === 'separating') return;
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

  function prepare() {
    if (!owned.current || owned.current.disposed) return;
    const handedOver = owned.current;
    owned.current = null; // ownership moves to the publication form; this screen no longer disposes it
    onPrepare(handedOver);
  }

  const inputs = useMemo(() => (draft && !draft.disposed ? draft.mixerInputs() : null), [draft]);
  const busy = status === 'separating';

  return (
    <section className={AUDIO_CARD} aria-label="Separar música localmente">
      <h3 className="text-lg font-semibold">Separar música neste dispositivo</h3>
      <p className="text-sm text-[var(--text-secondary)]">
        O processamento acontece no seu navegador, sem enviar o áudio para nenhum serviço de separação. Selecione uma música em MP3 ou WAV com até 180 segundos (o MP3 é convertido aqui mesmo, sem você precisar ajustar taxa de amostragem ou canais) e o modelo ONNX HT-Demucs 6 faixas (fp16) já baixado por você.
        O desempenho e a memória dependem do dispositivo e não são garantidos.
      </p>
      <fieldset disabled={busy} className="grid min-w-0 gap-3">
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
        {!busy && <button type="button" className="btn btn-secondary min-h-[44px]" onClick={() => { discardDraft(); onClose(); }}>Fechar</button>}
      </div>
      {status === 'ready' && draft && inputs && (
        <div className="grid gap-3">
          <h4 className="font-semibold">Pré-escuta das seis faixas</h4>
          <SixStemMixerPanel
            playbackOnly stems={inputs} metadata={{ modelId: draft.model.id, modelVersion: draft.model.version }}
            createController={createLibraryMixer} onPlaybackError={(message) => setError(message)}
          />
          <p className="text-sm text-[var(--text-secondary)]">Nada foi publicado. Revise as faixas e, se quiser guardá-las no ministério, prepare a publicação.</p>
          <div className={AUDIO_ACTIONS}>
            <button type="button" className="btn btn-primary min-h-[44px]" onClick={prepare}>Preparar publicação</button>
            <button type="button" className="btn btn-secondary min-h-[44px]" onClick={() => { discardDraft(); setError(null); setStatus('idle'); }}>Descartar faixas</button>
          </div>
        </div>
      )}
    </section>
  );
}

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  DEFAULT_SAMPLE_RATE,
  LocalAudioTransportController,
  MAX_TRANSPORT_RATE,
  MIN_TRANSPORT_RATE,
  createSyntheticWavFile,
  type TransportSessionContext,
  type TransportSnapshot,
} from './local-audio-transport';

export type ExperimentalScreenId = 'detail' | 'stand' | 'schedule';

export interface LocalAudioTransportHarnessProps {
  controller?: LocalAudioTransportController;
  createController?: () => LocalAudioTransportController;
  initialScreen?: ExperimentalScreenId;
  initialContext?: TransportSessionContext;
}

const DEFAULT_CONTEXT: TransportSessionContext = {
  accountNamespace: 'user-a',
  ministryId: 'ministry-a',
  songId: 'song-demo-1',
  versionId: 'ver-demo-1',
};

function createIdleSnapshot(
  sessionContext: TransportSessionContext
): TransportSnapshot {
  return {
    state: 'idle',
    generation: 0,
    sessionContext: { ...sessionContext },
    fileName: null,
    fileSizeBytes: null,
    mimeType: null,
    sampleRate: DEFAULT_SAMPLE_RATE,
    channels: 2,
    totalFrames: 0,
    currentFrame: 0,
    durationSeconds: 0,
    currentTimeSeconds: 0,
    rate: 1.0,
    preservesPitch: true,
    pitchShiftSemitonesSupported: false,
    masterGain: 1.0,
    error: null,
    memoryBudget: {
      fileBytes: 0,
      headerSliceBytes: 0,
      estimatedFullFloat32PcmBytes: 0,
      streamingMode: 'blob-object-url',
    },
  };
}

const RATE_PRESETS = [0.5, 0.75, 1.0, 1.25, 1.5];

interface SubscreenPanelProps {
  snapshot: TransportSnapshot;
  onQuickSeekPercent: (percent: number) => void;
}

function ExperimentalDetailPanel({
  snapshot,
  onQuickSeekPercent,
}: SubscreenPanelProps) {
  return (
    <section
      data-testid="harness-screen-detail"
      aria-label="Tela experimental: Detalhe de Música"
    >
      <h3>Tela A — Detalhe (Spike Isolado)</h3>
      <p>
        Contexto: {snapshot.sessionContext.accountNamespace} /{' '}
        {snapshot.sessionContext.ministryId ?? 'sem-ministério'} / versão{' '}
        {snapshot.sessionContext.versionId ?? 'n/a'}
      </p>
      <button type="button" onClick={() => onQuickSeekPercent(0.5)}>
        Saltar para 50% nesta tela
      </button>
    </section>
  );
}

function ExperimentalStandPanel({ snapshot }: { snapshot: TransportSnapshot }) {
  return (
    <section
      data-testid="harness-screen-stand"
      aria-label="Tela experimental: Estante"
    >
      <h3>Tela B — Estante (Spike Isolado)</h3>
      <p>
        Estado herdado da sessão única: <strong>{snapshot.state}</strong> (frame{' '}
        {snapshot.currentFrame} / {snapshot.totalFrames})
      </p>
    </section>
  );
}

function ExperimentalSchedulePanel({
  snapshot,
  onSwitchAccount,
  onSwitchMinistry,
}: {
  snapshot: TransportSnapshot;
  onSwitchAccount: (account: string) => void;
  onSwitchMinistry: (ministry: string) => void;
}) {
  return (
    <section
      data-testid="harness-screen-schedule"
      aria-label="Tela experimental: Escala"
    >
      <h3>Tela C — Escala (Spike Isolado)</h3>
      <p>
        Sessão ativa em: {snapshot.sessionContext.accountNamespace} /{' '}
        {snapshot.sessionContext.ministryId ?? 'nenhum'}
      </p>
      <div>
        <button type="button" onClick={() => onSwitchAccount('user-b')}>
          Trocar para Conta B
        </button>
        <button type="button" onClick={() => onSwitchMinistry('ministry-b')}>
          Trocar para Ministério B
        </button>
      </div>
    </section>
  );
}

export function LocalAudioTransportHarness({
  controller: externalController,
  createController,
  initialScreen = 'detail',
  initialContext = DEFAULT_CONTEXT,
}: LocalAudioTransportHarnessProps) {
  const createControllerRef = useRef(createController);
  createControllerRef.current = createController;
  const initialContextRef = useRef(initialContext);
  initialContextRef.current = initialContext;

  const [ownedController, setOwnedController] =
    useState<LocalAudioTransportController | null>(null);
  const activeController = externalController ?? ownedController;

  const [activeScreen, setActiveScreen] =
    useState<ExperimentalScreenId>(initialScreen);
  const [snapshot, setSnapshot] = useState<TransportSnapshot>(() =>
    activeController
      ? activeController.getSnapshot()
      : createIdleSnapshot(initialContext)
  );
  const [seekFrameInput, setSeekFrameInput] = useState('0');
  const [screenVisits, setScreenVisits] = useState<number>(1);
  const [isDisposedUi, setIsDisposedUi] = useState<boolean>(() =>
    activeController ? activeController.getDiagnostics().disposed : false
  );

  useEffect(() => {
    if (externalController) {
      return undefined;
    }
    const owned = createControllerRef.current
      ? createControllerRef.current()
      : new LocalAudioTransportController(initialContextRef.current);
    setOwnedController(owned);
    return () => {
      owned.dispose();
    };
  }, [externalController]);

  useEffect(() => {
    if (!activeController) {
      return undefined;
    }
    const unsubscribe = activeController.subscribe((next) => {
      setSnapshot(next);
      setIsDisposedUi(activeController.getDiagnostics().disposed);
    });
    return () => {
      unsubscribe();
    };
  }, [activeController]);

  const handleNavigate = (screen: ExperimentalScreenId) => {
    setActiveScreen(screen);
    setScreenVisits((prev) => prev + 1);
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !activeController) {
      return;
    }
    await activeController.load(file);
  };

  const handleLoadSyntheticTone = async (
    frequencyHz: number,
    durationSeconds: number,
    fileName: string
  ) => {
    if (!activeController) return;
    const file = createSyntheticWavFile({
      frequencyHz,
      durationSeconds,
      sampleRate: 44100,
      channels: 2,
      fileName,
    });
    await activeController.load(file);
  };

  const handleSeekInputSubmit = () => {
    const parsed = Number(seekFrameInput);
    if (!Number.isFinite(parsed) || !activeController) return;
    activeController.seek(parsed);
  };

  const handleQuickSeekPercent = (percent: number) => {
    if (!activeController) return;
    const targetFrame = Math.round(snapshot.totalFrames * percent);
    activeController.seek(targetFrame);
  };

  const handleDisposeClick = () => {
    if (!activeController) return;
    activeController.dispose();
    setSnapshot(activeController.getSnapshot());
    setIsDisposedUi(true);
  };

  return (
    <div data-testid="local-audio-transport-harness">
      <header>
        <h2>Spike T6 — Transporte de Áudio Local (Isolado)</h2>
        <p data-testid="harness-nav-meta">
          Tela atual: <strong>{activeScreen}</strong> | Transições:{' '}
          {screenVisits}
        </p>
        <nav aria-label="Navegação experimental do spike">
          <button type="button" onClick={() => handleNavigate('detail')}>
            Ir para Detalhe
          </button>
          <button type="button" onClick={() => handleNavigate('stand')}>
            Ir para Estante
          </button>
          <button type="button" onClick={() => handleNavigate('schedule')}>
            Ir para Escala
          </button>
        </nav>
      </header>

      <div data-testid="harness-file-controls">
        <label htmlFor="t6-local-file-input">
          Selecionar arquivo local:
          <input
            id="t6-local-file-input"
            type="file"
            accept="audio/*"
            onChange={(e) => void handleFileChange(e)}
          />
        </label>
        <button
          type="button"
          onClick={() =>
            void handleLoadSyntheticTone(880, 3, 'fixture-880hz-3s.wav')
          }
        >
          Carregar fixture 880 Hz (3s)
        </button>
        <button
          type="button"
          onClick={() =>
            void handleLoadSyntheticTone(440, 2, 'fixture-440hz-2s.wav')
          }
        >
          Carregar fixture 440 Hz (2s)
        </button>
      </div>

      <main>
        {activeScreen === 'detail' && (
          <ExperimentalDetailPanel
            snapshot={snapshot}
            onQuickSeekPercent={handleQuickSeekPercent}
          />
        )}
        {activeScreen === 'stand' && (
          <ExperimentalStandPanel snapshot={snapshot} />
        )}
        {activeScreen === 'schedule' && (
          <ExperimentalSchedulePanel
            snapshot={snapshot}
            onSwitchAccount={(accountNamespace) =>
              activeController?.setSessionContext({
                ...snapshot.sessionContext,
                accountNamespace,
              })
            }
            onSwitchMinistry={(ministryId) =>
              activeController?.setSessionContext({
                ...snapshot.sessionContext,
                ministryId,
              })
            }
          />
        )}
      </main>

      <section
        data-testid="harness-persistent-mini-player"
        aria-label="Controlador persistente de transporte local"
      >
        <h3>Sessão Global Experimental</h3>
        <div data-testid="transport-status-readout">
          <span>Estado: {isDisposedUi ? 'disposed' : snapshot.state}</span> |{' '}
          <span>Geração: {snapshot.generation}</span> |{' '}
          <span>Arquivo: {snapshot.fileName ?? 'nenhum'}</span> |{' '}
          <span>
            Frames: {snapshot.currentFrame}/{snapshot.totalFrames}
          </span>{' '}
          |{' '}
          <span>
            Tempo: {snapshot.currentTimeSeconds.toFixed(3)}s /{' '}
            {snapshot.durationSeconds.toFixed(3)}s
          </span>{' '}
          | <span>Taxa: {snapshot.rate}x</span> |{' '}
          <span>
            Preservar pitch: {snapshot.preservesPitch ? 'sim' : 'não'}
          </span>{' '}
          | <span>Pitch-shift independente: indisponível</span>
        </div>

        {snapshot.error && (
          <div role="alert" data-testid="transport-error-banner">
            Erro ({snapshot.error.code}): {snapshot.error.message}
          </div>
        )}

        <div>
          <button
            type="button"
            onClick={() => void activeController?.play()}
            disabled={
              !activeController ||
              isDisposedUi ||
              (snapshot.state !== 'ready' &&
                snapshot.state !== 'paused' &&
                !(
                  snapshot.state === 'error' &&
                  snapshot.error?.code === 'PLAYBACK_REJECTED'
                ))
            }
          >
            Play
          </button>
          <button
            type="button"
            onClick={() => activeController?.pause()}
            disabled={
              !activeController ||
              isDisposedUi ||
              snapshot.state !== 'playing'
            }
          >
            Pause
          </button>
          <button
            type="button"
            onClick={() => activeController?.stop()}
            disabled={
              !activeController || isDisposedUi || snapshot.state === 'idle'
            }
          >
            Stop
          </button>
          <button
            type="button"
            onClick={handleDisposeClick}
            disabled={!activeController || isDisposedUi}
          >
            Dispose
          </button>
        </div>

        <div>
          <label htmlFor="t6-seek-frame-input">
            Seek (frame):
            <input
              id="t6-seek-frame-input"
              type="number"
              value={seekFrameInput}
              min={0}
              max={Math.max(0, snapshot.totalFrames)}
              onChange={(e) => setSeekFrameInput(e.target.value)}
            />
          </label>
          <button type="button" onClick={handleSeekInputSubmit}>
            Ir para frame
          </button>
        </div>

        <div>
          <label htmlFor="t6-master-gain-range">
            Master gain ({Math.round(snapshot.masterGain * 100)}%):
            <input
              id="t6-master-gain-range"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={snapshot.masterGain}
              onChange={(e) =>
                activeController?.setMasterGain(Number(e.target.value))
              }
            />
          </label>
        </div>

        <div>
          <span>Velocidade ({MIN_TRANSPORT_RATE}x–{MAX_TRANSPORT_RATE}x): </span>
          {RATE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => activeController?.setRate(preset)}
            >
              {preset}x
            </button>
          ))}
          <label htmlFor="t6-preserves-pitch-checkbox">
            <input
              id="t6-preserves-pitch-checkbox"
              type="checkbox"
              checked={snapshot.preservesPitch}
              onChange={(e) =>
                activeController?.setRate(snapshot.rate, {
                  preservesPitch: e.target.checked,
                })
              }
            />
            Preservar pitch (tempo sem alterar altura)
          </label>
        </div>
      </section>
    </div>
  );
}

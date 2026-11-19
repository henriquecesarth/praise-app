import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  CANONICAL_STEM_IDS,
  type CanonicalStemId,
  type SeparatedStemOutput,
} from './demucs-onnx-separator';
import {
  SixStemWebAudioMixerController,
  type SeparatedMixerMetadata,
  type SixStemMixerSnapshot,
  type TargetAudioLibraryKind,
} from './six-stem-mixer';

export interface SixStemMixerPanelProps {
  stems: readonly SeparatedStemOutput[] | null;
  metadata?: Partial<SeparatedMixerMetadata>;
  controller?: SixStemWebAudioMixerController;
  createController?: () => SixStemWebAudioMixerController;
  isSeparating?: boolean;
  separationError?: string | null;
  onDisposed?: () => void;
  onLoadingChange?: (loading: boolean) => void;
}

function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00.0';
  }
  const mins = Math.floor(seconds / 60);
  const rem = seconds - mins * 60;
  return `${mins}:${rem.toFixed(1).padStart(4, '0')}`;
}

export function SixStemMixerPanel({
  stems,
  metadata,
  controller: externalController,
  createController,
  isSeparating = false,
  separationError = null,
  onDisposed,
  onLoadingChange,
}: SixStemMixerPanelProps) {
  const createControllerRef = useRef(createController);
  createControllerRef.current = createController;
  const onDisposedRef = useRef(onDisposed);
  onDisposedRef.current = onDisposed;
  const onLoadingChangeRef = useRef(onLoadingChange);
  onLoadingChangeRef.current = onLoadingChange;

  const [ownedController, setOwnedController] =
    useState<SixStemWebAudioMixerController | null>(null);
  const activeController = externalController ?? ownedController;

  const [snapshot, setSnapshot] = useState<SixStemMixerSnapshot | null>(() =>
    activeController ? activeController.getSnapshot() : null
  );
  const [, setPlaybackTick] = useState(0);

  useEffect(() => {
    if (externalController) {
      return undefined;
    }
    const created = createControllerRef.current
      ? createControllerRef.current()
      : new SixStemWebAudioMixerController();
    setOwnedController(created);
    return () => {
      created.dispose();
    };
  }, [externalController]);

  useEffect(() => {
    if (!activeController) {
      setSnapshot(null);
      return undefined;
    }
    return activeController.subscribe((next) => {
      setSnapshot(next);
    });
  }, [activeController]);

  useEffect(() => {
    if (!activeController) {
      return;
    }
    if (activeController.getDiagnostics().disposed) {
      return;
    }
    if (!stems || stems.length === 0) {
      activeController.clear();
      return;
    }
    void activeController.loadStems(stems, metadata);
  }, [activeController, stems, metadata]);

  const mountedRef = useRef(false);
  const lastEmittedLoadingRef = useRef<boolean | null>(null);
  const pendingLoadingValue = Boolean(
    stems &&
      stems.length > 0 &&
      (!snapshot || snapshot.state === 'idle' || snapshot.state === 'loading')
  );
  const latestLoadingValueRef = useRef(pendingLoadingValue);
  latestLoadingValueRef.current = pendingLoadingValue;

  const emitLoadingState = (loading: boolean) => {
    if (lastEmittedLoadingRef.current === loading) {
      return;
    }
    lastEmittedLoadingRef.current = loading;
    onLoadingChangeRef.current?.(loading);
  };

  useLayoutEffect(() => {
    mountedRef.current = true;
    emitLoadingState(latestLoadingValueRef.current);
    return () => {
      mountedRef.current = false;
      queueMicrotask(() => {
        if (!mountedRef.current) {
          emitLoadingState(false);
        }
      });
    };
  }, []);

  useLayoutEffect(() => {
    if (!mountedRef.current) {
      return;
    }
    emitLoadingState(pendingLoadingValue);
  }, [pendingLoadingValue]);

  useEffect(() => {
    if (!activeController || snapshot?.state !== 'playing') {
      return undefined;
    }
    const timer = window.setInterval(() => {
      setSnapshot(activeController.getSnapshot());
      setPlaybackTick((t) => t + 1);
    }, 100);
    return () => {
      window.clearInterval(timer);
    };
  }, [activeController, snapshot?.state]);

  if (!snapshot) {
    return null;
  }

  const isDisposed = snapshot.state === 'disposed';
  const hasLoadedAudio =
    snapshot.totalFrames > 0 &&
    (snapshot.state === 'ready' ||
      snapshot.state === 'playing' ||
      snapshot.state === 'paused');
  const activeError = separationError ?? snapshot.error?.message ?? null;

  const handleDisposeClick = () => {
    if (!activeController || isDisposed) {
      return;
    }
    activeController.dispose();
    setSnapshot(activeController.getSnapshot());
    onDisposedRef.current?.();
  };

  return (
    <section
      data-testid="m22b-six-stem-mixer"
      aria-label="Mixer Experimental de 6 Faixas (Web Audio API)"
      style={{
        padding: '16px',
        border: '1px solid var(--border-color, #d4d4d8)',
        borderRadius: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
      }}
    >
      <header
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '10px',
        }}
      >
        <div>
          <h2 style={{ fontSize: '1.1rem', margin: 0 }}>
            Mixer Experimental de 6 Faixas (Web Audio Sincronizado)
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '0.85rem', opacity: 0.85 }}>
            Base de tempo única compartilhada via AudioContext (zero drift entre
            os 6 stems).
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span
            data-testid="m22b-mixer-status"
            data-state={isSeparating ? 'separating' : snapshot.state}
            style={{ fontSize: '0.85rem', fontWeight: 600 }}
          >
            Mixer: {isSeparating ? 'separando...' : snapshot.state}
          </span>
          <span
            data-testid="m22b-mixer-sync-badge"
            data-max-drift-seconds={String(snapshot.maxInterStemStartDriftSeconds)}
            data-schedule-deadline-missed={
              snapshot.scheduleDeadlineMissed ? 'true' : 'false'
            }
            data-schedule-span-seconds={String(snapshot.scheduleSpanSeconds)}
            style={{ fontSize: '0.8rem', opacity: 0.85 }}
          >
            Drift agendado:{' '}
            {(snapshot.maxInterStemStartDriftSeconds * 1000).toFixed(3)} ms (
            {snapshot.activeSourceCount}/6 ativas)
          </span>
        </div>
      </header>

      {activeError && (
        <div
          data-testid="m22b-mixer-error"
          role="alert"
          style={{
            padding: '10px 12px',
            border: '1px solid #dc2626',
            borderRadius: '8px',
            fontSize: '0.88rem',
          }}
        >
          {activeError}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '10px',
        }}
      >
        <button
          type="button"
          data-testid="m22b-mixer-play"
          onClick={() => {
            void activeController?.play();
          }}
          disabled={!hasLoadedAudio || snapshot.state === 'playing' || isDisposed}
          style={{ minHeight: '44px', padding: '0 16px', fontWeight: 600 }}
        >
          Reproduzir (6 faixas)
        </button>

        <button
          type="button"
          data-testid="m22b-mixer-pause"
          onClick={() => {
            activeController?.pause();
          }}
          disabled={!hasLoadedAudio || snapshot.state !== 'playing' || isDisposed}
          style={{ minHeight: '44px', padding: '0 16px' }}
        >
          Pausar
        </button>

        <button
          type="button"
          data-testid="m22b-mixer-stop"
          onClick={() => {
            activeController?.stop();
          }}
          disabled={!hasLoadedAudio || isDisposed}
          style={{ minHeight: '44px', padding: '0 16px' }}
        >
          Parar
        </button>

        <button
          type="button"
          data-testid="m22b-mixer-dispose"
          onClick={handleDisposeClick}
          disabled={!activeController || isDisposed}
          style={{ minHeight: '44px', padding: '0 16px' }}
        >
          Liberar recursos
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '12px',
          alignItems: 'center',
        }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span data-testid="m22b-mixer-position" style={{ fontSize: '0.85rem' }}>
            Posição: {formatSeconds(snapshot.currentTimeSeconds)} /{' '}
            {formatSeconds(snapshot.durationSeconds)} (frame{' '}
            {snapshot.currentFrame}/{snapshot.totalFrames})
          </span>
          <input
            type="range"
            data-testid="m22b-mixer-seek"
            aria-label="Posição da música no mixer"
            min={0}
            max={Math.max(1, snapshot.totalFrames)}
            step={1}
            value={Math.min(snapshot.currentFrame, Math.max(1, snapshot.totalFrames))}
            disabled={!hasLoadedAudio || isDisposed}
            onChange={(e) => {
              activeController?.seekFrame(Number(e.target.value));
            }}
            style={{ minHeight: '44px' }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '0.85rem' }}>
            Volume Master: {Math.round(snapshot.masterVolume * 100)}%
          </span>
          <input
            type="range"
            data-testid="m22b-mixer-master-volume"
            aria-label="Volume master do mixer"
            min={0}
            max={1}
            step={0.01}
            value={snapshot.masterVolume}
            disabled={isDisposed}
            onChange={(e) => {
              activeController?.setMasterVolume(Number(e.target.value));
            }}
            style={{ minHeight: '44px' }}
          />
        </label>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '10px',
        }}
      >
        {CANONICAL_STEM_IDS.map((stemId: CanonicalStemId) => {
          const ch = snapshot.stems[stemId];
          return (
            <article
              key={stemId}
              data-testid={`m22b-stem-channel-${stemId}`}
              style={{
                padding: '12px',
                border: '1px solid var(--border-color, #d4d4d8)',
                borderRadius: '10px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <strong>
                  {ch.labelPtBr} ({ch.id})
                </strong>
                <span
                  data-testid={`m22b-stem-audible-${stemId}`}
                  data-audible={ch.isAudible ? 'true' : 'false'}
                  style={{ fontSize: '0.78rem', opacity: 0.85 }}
                >
                  {ch.isAudible
                    ? `Ativa (${Math.round(ch.effectiveGain * 100)}%)`
                    : 'Silenciada'}
                </span>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  data-testid={`m22b-stem-mute-${stemId}`}
                  aria-pressed={ch.muted}
                  disabled={!hasLoadedAudio || isDisposed}
                  onClick={() => activeController?.toggleStemMute(stemId)}
                  style={{
                    minHeight: '44px',
                    flex: 1,
                    fontWeight: ch.muted ? 700 : 400,
                  }}
                >
                  {ch.muted ? 'Mute (Ativo)' : 'Mute'}
                </button>
                <button
                  type="button"
                  data-testid={`m22b-stem-solo-${stemId}`}
                  aria-pressed={ch.solo}
                  disabled={!hasLoadedAudio || isDisposed}
                  onClick={() => activeController?.toggleStemSolo(stemId)}
                  style={{
                    minHeight: '44px',
                    flex: 1,
                    fontWeight: ch.solo ? 700 : 400,
                  }}
                >
                  {ch.solo ? 'Solo (Ativo)' : 'Solo'}
                </button>
              </div>

              <label
                style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}
              >
                <span style={{ fontSize: '0.8rem' }}>
                  Volume: {Math.round(ch.volume * 100)}%
                </span>
                <input
                  type="range"
                  data-testid={`m22b-stem-volume-${stemId}`}
                  aria-label={`Volume da faixa ${ch.labelPtBr}`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={ch.volume}
                  disabled={!hasLoadedAudio || isDisposed}
                  onChange={(e) => {
                    activeController?.setStemVolume(
                      stemId,
                      Number(e.target.value)
                    );
                  }}
                  style={{ minHeight: '44px' }}
                />
              </label>

              {ch.downloadUrl ? (
                <a
                  data-testid={`m22b-stem-export-${stemId}`}
                  href={ch.downloadUrl}
                  download={`${stemId}.wav`}
                  style={{
                    minHeight: '44px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    fontSize: '0.85rem',
                  }}
                >
                  Exportar {stemId}.wav
                </a>
              ) : (
                <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>
                  Sem arquivo WAV carregado
                </span>
              )}
            </article>
          );
        })}
      </div>

      <div
        style={{
          paddingTop: '10px',
          borderTop: '1px solid var(--border-color, #d4d4d8)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
            Destino preparado para persistência futura (M22-C..F)
          </span>
          <select
            data-testid="m22b-target-library-select"
            value={snapshot.targetLibrary}
            disabled={isDisposed}
            onChange={(e) => {
              activeController?.setTargetLibrary(
                e.target.value as TargetAudioLibraryKind
              );
            }}
            style={{ minHeight: '44px', padding: '0 10px' }}
          >
            <option value="ministry_library">
              Biblioteca Ministerial (compartilhada no ministério)
            </option>
            <option value="louvaio_library">
              Biblioteca LouvAIO (catálogo por assinatura)
            </option>
          </select>
        </label>
        <p style={{ margin: 0, fontSize: '0.78rem', opacity: 0.8 }}>
          Arquitetura M22: somente Biblioteca Ministerial e Biblioteca LouvAIO
          (sem biblioteca pessoal; integração R2/Firestore/assinatura será
          implementada em M22-C..F).
        </p>
      </div>
    </section>
  );
}

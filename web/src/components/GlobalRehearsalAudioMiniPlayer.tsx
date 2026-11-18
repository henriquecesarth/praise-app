import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Disc3,
  ExternalLink,
  Loader2,
  Pause,
  Play,
  Square,
  Volume2,
} from 'lucide-react';
import type {
  GlobalRehearsalAudioSessionController,
  GlobalRehearsalAudioSessionSnapshot,
  LoadedRehearsalMediaIdentity,
} from '../audio/song-version-audio-binding';

export interface GlobalRehearsalAudioMiniPlayerProps {
  sessionController: GlobalRehearsalAudioSessionController;
  onOpenLoadedSong?: (media: LoadedRehearsalMediaIdentity) => void;
}

const RATE_OPTIONS = [
  { value: '0.5', label: '0.5x' },
  { value: '0.75', label: '0.75x' },
  { value: '1', label: '1.0x' },
  { value: '1.25', label: '1.25x' },
  { value: '1.5', label: '1.5x' },
] as const;

function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const whole = Math.floor(seconds);
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function resolveStateLabel(snapshot: GlobalRehearsalAudioSessionSnapshot): string {
  if (snapshot.isLoading) return 'Carregando';
  if (snapshot.lastError || snapshot.transport.state === 'error') return 'Erro';
  switch (snapshot.transport.state) {
    case 'playing':
      return 'Reproduzindo';
    case 'paused':
      return 'Pausado';
    case 'loading':
      return 'Carregando';
    default:
      return 'Pronto';
  }
}

export const GlobalRehearsalAudioMiniPlayer: React.FC<GlobalRehearsalAudioMiniPlayerProps> = ({
  sessionController,
  onOpenLoadedSong,
}) => {
  const [snapshot, setSnapshot] = useState<GlobalRehearsalAudioSessionSnapshot>(() =>
    sessionController.getSnapshot(),
  );

  useEffect(() => {
    setSnapshot(sessionController.getSnapshot());
    return sessionController.subscribe(setSnapshot);
  }, [sessionController]);

  if (!snapshot.loadedMedia && !snapshot.isLoading && !snapshot.lastError) {
    return null;
  }

  const loadedMedia = snapshot.loadedMedia;
  const activeIdentity = loadedMedia ?? snapshot.loadingMedia;
  const songTitle = activeIdentity?.songTitle?.trim() || 'Áudio local de ensaio';
  const versionName = activeIdentity?.versionName?.trim() || 'Original';
  const canonicalVersionId = activeIdentity?.canonicalVersionId || '';
  const packageTitle = loadedMedia?.packageTitle || '';

  const stateLabel = resolveStateLabel(snapshot);
  const isPlaying = snapshot.transport.state === 'playing';
  const totalFrames = Math.max(0, Math.floor(snapshot.transport.totalFrames));
  const currentFrame = Math.min(
    Math.max(0, Math.floor(snapshot.transport.currentFrame)),
    totalFrames,
  );
  const currentTimeFormatted = formatPlaybackTime(snapshot.transport.currentTimeSeconds);
  const durationFormatted = formatPlaybackTime(snapshot.transport.durationSeconds);

  const normalizedRate = RATE_OPTIONS.some((opt) => Number(opt.value) === snapshot.transport.rate)
    ? String(snapshot.transport.rate)
    : '1';

  const statusToneStyle: React.CSSProperties =
    stateLabel === 'Erro'
      ? {
          backgroundColor: 'var(--status-danger-bg)',
          color: 'var(--status-danger-text)',
          borderColor: 'var(--status-danger-border)',
        }
      : stateLabel === 'Reproduzindo'
        ? {
            backgroundColor: 'var(--status-success-bg)',
            color: 'var(--status-success-text)',
            borderColor: 'var(--status-success-border)',
          }
        : stateLabel === 'Carregando'
          ? {
              backgroundColor: 'var(--status-info-bg)',
              color: 'var(--status-info-text)',
              borderColor: 'var(--status-info-border)',
            }
          : {
              backgroundColor: 'var(--bg-surface-subtle)',
              color: 'var(--text-secondary)',
              borderColor: 'var(--border-subtle)',
            };

  return (
    <section
      data-testid="global-rehearsal-mini-player"
      role="region"
      aria-label="Player global de ensaio"
      className="no-print"
      style={{
        position: 'relative',
        zIndex: 15,
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
        backgroundColor: 'var(--bg-surface)',
        color: 'var(--text-primary)',
        borderBottom: '1px solid var(--border-subtle)',
        padding: '8px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px 12px',
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
            flex: '1 1 180px',
            minWidth: 0,
          }}
        >
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              backgroundColor: 'var(--action-primary-subtle)',
              color: 'var(--action-primary-bg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
            aria-hidden="true"
          >
            {snapshot.isLoading ? <Loader2 size={18} className="spin" /> : <Disc3 size={18} />}
          </div>

          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: '6px',
                minWidth: 0,
              }}
            >
              <strong
                data-testid="mini-player-song-title"
                style={{
                  fontSize: '0.9rem',
                  lineHeight: 1.3,
                  overflowWrap: 'anywhere',
                }}
              >
                {songTitle}
              </strong>
              <span
                data-testid="mini-player-state-badge"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '2px 8px',
                  borderRadius: '999px',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  border: '1px solid',
                  ...statusToneStyle,
                }}
              >
                {stateLabel}
              </span>
            </div>

            <div
              data-testid="mini-player-version-info"
              style={{
                fontSize: '0.78rem',
                color: 'var(--text-secondary)',
                overflowWrap: 'anywhere',
                lineHeight: 1.35,
              }}
            >
              <span>
                Versão: <strong>{versionName}</strong>
                {canonicalVersionId ? ` (${canonicalVersionId})` : ''}
              </span>
              {packageTitle && (
                <span>
                  {' · '}Pacote: <strong data-testid="mini-player-package-title">{packageTitle}</strong>
                </span>
              )}
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '6px',
            minWidth: 0,
            maxWidth: '100%',
          }}
        >
          <button
            type="button"
            className="btn btn-primary"
            data-testid="mini-player-play-pause"
            disabled={!loadedMedia || snapshot.isLoading}
            onClick={() => {
              if (isPlaying) {
                sessionController.pause();
              } else {
                void sessionController.play();
              }
            }}
            aria-label={isPlaying ? 'Pausar áudio local' : 'Reproduzir áudio local'}
            style={{
              minHeight: '44px',
              minWidth: '44px',
              padding: '0 12px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            {isPlaying ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
            <span>{isPlaying ? 'Pausar' : 'Reproduzir'}</span>
          </button>

          {loadedMedia && onOpenLoadedSong && (
            <button
              type="button"
              className="btn btn-secondary"
              data-testid="mini-player-open-song-btn"
              onClick={() => onOpenLoadedSong(loadedMedia)}
              style={{
                minHeight: '44px',
                padding: '0 10px',
                fontSize: '0.8rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              <ExternalLink size={14} aria-hidden="true" />
              <span>Abrir música</span>
            </button>
          )}

          <button
            type="button"
            className="btn btn-secondary"
            data-testid="mini-player-stop"
            onClick={() => sessionController.stop()}
            aria-label="Parar e fechar player"
            title="Parar e fechar player"
            style={{
              minHeight: '44px',
              minWidth: '44px',
              padding: '0 10px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '5px',
            }}
          >
            <Square size={15} aria-hidden="true" />
            <span>Parar</span>
          </button>
        </div>
      </div>

      {/* Seek, Time, Volume, Rate */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '8px 12px',
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '6px 8px',
            flex: '1 1 180px',
            minWidth: 0,
          }}
        >
          <input
            type="range"
            data-testid="mini-player-seek"
            aria-label="Posição da faixa em frames"
            min={0}
            max={Math.max(1, totalFrames)}
            step={1}
            value={currentFrame}
            disabled={!loadedMedia || totalFrames <= 0}
            onChange={(e) => sessionController.seekFrame(Number(e.target.value))}
            style={{ flex: '1 1 120px', minWidth: '80px', minHeight: '44px', accentColor: 'var(--action-primary-bg)' }}
          />
          <span
            data-testid="mini-player-time"
            style={{
              fontSize: '0.74rem',
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-secondary)',
              overflowWrap: 'anywhere',
            }}
          >
            {currentTimeFormatted} / {durationFormatted} · {currentFrame}/{totalFrames} frames
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '0.76rem',
              color: 'var(--text-secondary)',
            }}
          >
            <Volume2 size={14} aria-hidden="true" />
            <span className="sr-only">Volume</span>
            <input
              type="range"
              data-testid="mini-player-volume"
              aria-label="Volume do áudio local"
              min={0}
              max={1}
              step={0.05}
              value={snapshot.transport.masterGain}
              onChange={(e) => sessionController.setMasterGain(Number(e.target.value))}
              style={{ width: '72px', minHeight: '44px', accentColor: 'var(--action-primary-bg)' }}
            />
          </label>

          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '0.76rem',
              color: 'var(--text-secondary)',
            }}
          >
            <span>Velocidade</span>
            <select
              data-testid="mini-player-rate"
              aria-label="Velocidade de reprodução"
              value={normalizedRate}
              onChange={(e) =>
                sessionController.setRate(Number(e.target.value), { preservesPitch: true })
              }
              style={{
                minHeight: '44px',
                padding: '4px 8px',
                borderRadius: '8px',
                border: '1px solid var(--border-subtle)',
                backgroundColor: 'var(--bg-surface-subtle)',
                color: 'var(--text-primary)',
                fontSize: '0.8rem',
                fontWeight: 600,
              }}
            >
              {RATE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {snapshot.lastError && (
        <div
          role="alert"
          data-testid="mini-player-error"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 10px',
            borderRadius: '8px',
            border: '1px solid var(--status-danger-border)',
            backgroundColor: 'var(--status-danger-bg)',
            color: 'var(--status-danger-text)',
            fontSize: '0.8rem',
            overflowWrap: 'anywhere',
          }}
        >
          <AlertCircle size={15} aria-hidden="true" style={{ flexShrink: 0 }} />
          <span>{snapshot.lastError}</span>
        </div>
      )}
    </section>
  );
};
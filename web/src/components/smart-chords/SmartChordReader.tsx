import { useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import {
  CHORD_FONT_FAMILIES,
  getFontFamilyCss,
  hasBarProgression,
  isTablatureLine,
  parseBarProgressionLine,
  rawToVisual,
  transposeChord,
} from '../../utils/smart_chord';

export interface SmartChordEditTarget {
  lineIdx: number;
  charIdx?: number;
  barChordIdx?: number;
}

export type AutoScrollState = 'stopped' | 'playing' | 'paused';

const SCROLL_SPEEDS_PX_PER_SEC: Record<number, number> = {
  1: 18,
  2: 30,
  3: 45,
  4: 64,
  5: 88,
};

interface Props {
  title: string;
  selectedArtistName: string;
  originalKey: string;
  currentKeyTransposed: string;
  content: string;
  semitones: number;
  sheetFontFamily: string;
  printFontSize: number;
  /** Existing tablature sizing contract; kept separate from reading zoom. */
  pdfFontSize: number;
  chordLineSpacingPx: number;
  editingCell: SmartChordEditTarget | null;
  setEditingCell: (cell: SmartChordEditTarget | null) => void;
  setEditingChordValue: (value: string) => void;
  setSemitones: Dispatch<SetStateAction<number>>;
  setPrintFontSize: Dispatch<SetStateAction<number>>;
  handleChordLineSpacingChange: (value: number) => Promise<void>;
  handleFontFamilyChange: (value: string) => void;
  renderInlineEditor: (lineIdx: number, charIdx?: number, barChordIdx?: number) => ReactNode;
  isActive?: boolean;
}

/** Controlled reading surface; document edits and preference persistence stay in the workspace. */
export function SmartChordReader({
  title,
  selectedArtistName,
  originalKey,
  currentKeyTransposed,
  content,
  semitones,
  sheetFontFamily,
  printFontSize,
  pdfFontSize,
  chordLineSpacingPx,
  editingCell,
  setEditingCell,
  setEditingChordValue,
  setSemitones,
  setPrintFontSize,
  handleChordLineSpacingChange,
  handleFontFamilyChange,
  renderInlineEditor,
  isActive = true,
}: Props) {
  const rawLines = content ? content.split('\n') : [];
  const activeFontFamilyCss = getFontFamilyCss(sheetFontFamily);

  const readerContainerRef = useRef<HTMLDivElement | null>(null);
  const sheetScrollRef = useRef<HTMLDivElement | null>(null);

  const [autoScrollState, setAutoScrollState] = useState<AutoScrollState>('stopped');
  const [scrollSpeedLevel, setScrollSpeedLevel] = useState<number>(2);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return Boolean(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  });
  const [allowReducedMotionScroll, setAllowReducedMotionScroll] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const scrollAccumulatorRef = useRef<number>(0);
  const lastProgrammaticScrollTopRef = useRef<number>(0);
  const lastTickTimeRef = useRef<number>(0);

  const reducedMotionBlocked = prefersReducedMotion && !allowReducedMotionScroll;

  // Listen to prefers-reduced-motion changes
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleMediaChange = (event: MediaQueryListEvent | MediaQueryList) => {
      const matches = Boolean(event.matches);
      setPrefersReducedMotion(matches);
      if (matches) {
        setAllowReducedMotionScroll(false);
        setAutoScrollState('stopped');
      }
    };
    handleMediaChange(mediaQuery);
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleMediaChange);
      return () => mediaQuery.removeEventListener('change', handleMediaChange);
    }
    return undefined;
  }, []);

  // Pause auto-scroll when screen/mode becomes inactive
  useEffect(() => {
    if (!isActive && autoScrollState === 'playing') {
      setAutoScrollState('paused');
    }
  }, [isActive, autoScrollState]);

  // Pause auto-scroll when document/tab is hidden or window loses focus
  useEffect(() => {
    const handleVisibilityOrBlur = () => {
      if (document.hidden || document.visibilityState === 'hidden') {
        setAutoScrollState((prev) => (prev === 'playing' ? 'paused' : prev));
      }
    };
    const handleWindowBlur = () => {
      setAutoScrollState((prev) => (prev === 'playing' ? 'paused' : prev));
    };

    document.addEventListener('visibilitychange', handleVisibilityOrBlur);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityOrBlur);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, []);

  // Sync fullscreen state with browser Fullscreen API
  useEffect(() => {
    const handleFullscreenChange = () => {
      const fsElement = document.fullscreenElement || (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement;
      if (!fsElement && isFullscreen && document.fullscreenEnabled) {
        setIsFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [isFullscreen]);

  // Auto-scroll loop operating strictly on rendered scroll container
  useEffect(() => {
    if (autoScrollState !== 'playing' || !isActive || reducedMotionBlocked) {
      return undefined;
    }

    const el = sheetScrollRef.current;
    if (el) {
      scrollAccumulatorRef.current = el.scrollTop;
      lastProgrammaticScrollTopRef.current = el.scrollTop;
    }
    lastTickTimeRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();

    const intervalId = window.setInterval(() => {
      const target = sheetScrollRef.current;
      if (!target) return;
      if (document.hidden || document.visibilityState === 'hidden') {
        setAutoScrollState('paused');
        return;
      }

      const maxScrollTop = Math.max(0, target.scrollHeight - target.clientHeight);
      if (maxScrollTop <= 0) {
        setAutoScrollState('stopped');
        return;
      }

      // Respect manual user scroll position if it moved away from our last programmatic position
      if (Math.abs(target.scrollTop - lastProgrammaticScrollTopRef.current) > 1.5) {
        scrollAccumulatorRef.current = target.scrollTop;
      }

      if (target.scrollTop >= maxScrollTop - 1) {
        target.scrollTop = maxScrollTop;
        lastProgrammaticScrollTopRef.current = maxScrollTop;
        setAutoScrollState('stopped');
        return;
      }

      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const rawDeltaSec = (now - lastTickTimeRef.current) / 1000;
      const dtSec = rawDeltaSec > 0 ? Math.min(0.25, rawDeltaSec) : 0.032;
      lastTickTimeRef.current = now;

      const speedPxPerSec = SCROLL_SPEEDS_PX_PER_SEC[scrollSpeedLevel] || SCROLL_SPEEDS_PX_PER_SEC[2];
      const nextPos = Math.min(maxScrollTop, scrollAccumulatorRef.current + speedPxPerSec * dtSec);

      scrollAccumulatorRef.current = nextPos;
      lastProgrammaticScrollTopRef.current = nextPos;
      target.scrollTop = nextPos;

      if (nextPos >= maxScrollTop - 0.5) {
        target.scrollTop = maxScrollTop;
        lastProgrammaticScrollTopRef.current = maxScrollTop;
        setAutoScrollState('stopped');
      }
    }, 32);

    return () => window.clearInterval(intervalId);
  }, [autoScrollState, isActive, reducedMotionBlocked, scrollSpeedLevel]);

  const handleStartScroll = () => {
    if (reducedMotionBlocked) return;
    const target = sheetScrollRef.current;
    if (target) {
      const maxScrollTop = Math.max(0, target.scrollHeight - target.clientHeight);
      if (maxScrollTop > 0 && target.scrollTop >= maxScrollTop - 1) {
        target.scrollTop = 0;
      }
      scrollAccumulatorRef.current = target.scrollTop;
      lastProgrammaticScrollTopRef.current = target.scrollTop;
    }
    setAutoScrollState('playing');
  };

  const handlePauseScroll = () => {
    setAutoScrollState('paused');
  };

  const handleResumeScroll = () => {
    if (reducedMotionBlocked) return;
    const target = sheetScrollRef.current;
    if (target) {
      scrollAccumulatorRef.current = target.scrollTop;
      lastProgrammaticScrollTopRef.current = target.scrollTop;
    }
    setAutoScrollState('playing');
  };

  const handleStopScroll = () => {
    setAutoScrollState('stopped');
  };

  const syncManualScrollPosition = () => {
    const target = sheetScrollRef.current;
    if (!target) return;
    if (Math.abs(target.scrollTop - lastProgrammaticScrollTopRef.current) > 1.5) {
      scrollAccumulatorRef.current = target.scrollTop;
      lastProgrammaticScrollTopRef.current = target.scrollTop;
    }
    const maxScrollTop = Math.max(0, target.scrollHeight - target.clientHeight);
    if (autoScrollState === 'playing' && maxScrollTop > 0 && target.scrollTop >= maxScrollTop - 1) {
      setAutoScrollState('stopped');
    }
  };

  const handleToggleFullscreen = async () => {
    const container = readerContainerRef.current;
    const nextState = !isFullscreen;

    if (nextState) {
      setIsFullscreen(true);
      if (container && typeof container.requestFullscreen === 'function') {
        try {
          await container.requestFullscreen();
        } catch {
          // Safe CSS fullscreen fallback remains active
        }
      }
    } else {
      setIsFullscreen(false);
      if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
        try {
          await document.exitFullscreen();
        } catch {
          // Ignore exit errors
        }
      }
    }
  };

  return (
    <div
      ref={readerContainerRef}
      data-testid="dedicated-chord-reader"
      data-reader-fullscreen={isFullscreen ? 'true' : 'false'}
      data-autoscroll-state={autoScrollState}
      className="glass-panel printable-area-container"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          if (autoScrollState !== 'stopped') {
            event.stopPropagation();
            handleStopScroll();
          } else if (isFullscreen) {
            event.stopPropagation();
            void handleToggleFullscreen();
          }
        }
      }}
      style={{
        flex: 1.2,
        minWidth: '300px',
        padding: isFullscreen ? '16px 24px' : '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        overflowY: 'auto',
        backgroundColor: isFullscreen ? 'var(--bg-app)' : 'transparent',
      }}
    >
      {/* Dedicated Reader Control Bar (Transposition, Auto-Scroll, Typography, Spacing, Fullscreen) */}
      <div
        className="no-print smart-chords-reading-tools"
        aria-label="Ferramentas de leitura"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '12px',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 16px',
          borderRadius: '12px',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        {/* Group 1: Key & Transposition (-1 / Reset / +1) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>Tom Original:</span>
            <strong
              style={{
                color: 'var(--chord-text)',
                fontSize: '0.9rem',
                fontFamily: 'var(--font-mono, monospace)',
                backgroundColor: 'var(--chord-badge-bg)',
                border: '1px solid var(--chord-badge-border)',
                padding: '2px 7px',
                borderRadius: '6px',
              }}
            >
              {originalKey}
            </strong>
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginLeft: '6px' }}>Tom Atual:</span>
            <strong
              style={{
                color: 'var(--structural-accent)',
                fontSize: '0.9rem',
                fontFamily: 'var(--font-mono, monospace)',
                backgroundColor: 'var(--structural-subtle)',
                padding: '2px 7px',
                borderRadius: '6px',
              }}
            >
              {currentKeyTransposed}
            </strong>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              aria-label="Transpor um semitom abaixo"
              className="btn btn-secondary smart-chords-touch-btn"
              style={{
                width: '44px',
                height: '44px',
                minWidth: '44px',
                minHeight: '44px',
                padding: 0,
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                fontSize: '1.1rem',
                fontWeight: 700,
                borderRadius: '8px',
              }}
              onClick={() => setSemitones((prev) => prev - 1)}
            >
              -
            </button>
            <span style={{ fontSize: '0.9rem', minWidth: '30px', textAlign: 'center', fontWeight: 700, fontFamily: 'var(--font-mono, monospace)' }}>
              {semitones > 0 ? `+${semitones}` : semitones}
            </span>
            <button
              type="button"
              aria-label="Transpor um semitom acima"
              className="btn btn-secondary smart-chords-touch-btn"
              style={{
                width: '44px',
                height: '44px',
                minWidth: '44px',
                minHeight: '44px',
                padding: 0,
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                fontSize: '1.1rem',
                fontWeight: 700,
                borderRadius: '8px',
              }}
              onClick={() => setSemitones((prev) => prev + 1)}
            >
              +
            </button>
            {semitones !== 0 && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ minHeight: '44px', fontSize: '0.8rem', padding: '0 10px' }}
                onClick={() => setSemitones(0)}
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Group 2: Auto-Scroll Controls (Iniciar, Pausar, Retomar, Parar + Velocidade) */}
        <div
          role="group"
          aria-label="Rolagem automática"
          data-testid="auto-scroll-controls"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
            padding: '4px 10px',
            borderRadius: '10px',
            backgroundColor: 'var(--bg-surface-subtle)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Rolagem:</span>

          {autoScrollState === 'stopped' && (
            <button
              type="button"
              data-testid="auto-scroll-start"
              aria-label="Iniciar rolagem"
              className="btn btn-primary"
              disabled={reducedMotionBlocked}
              onClick={handleStartScroll}
              style={{ minHeight: '44px', padding: '6px 12px', fontSize: '0.82rem' }}
            >
              Iniciar
            </button>
          )}

          {autoScrollState === 'playing' && (
            <button
              type="button"
              data-testid="auto-scroll-pause"
              aria-label="Pausar rolagem"
              className="btn btn-secondary"
              onClick={handlePauseScroll}
              style={{ minHeight: '44px', padding: '6px 12px', fontSize: '0.82rem', borderColor: 'var(--action-primary-bg)' }}
            >
              Pausar
            </button>
          )}

          {autoScrollState === 'paused' && (
            <button
              type="button"
              data-testid="auto-scroll-resume"
              aria-label="Retomar rolagem"
              className="btn btn-primary"
              disabled={reducedMotionBlocked}
              onClick={handleResumeScroll}
              style={{ minHeight: '44px', padding: '6px 12px', fontSize: '0.82rem' }}
            >
              Retomar
            </button>
          )}

          <button
            type="button"
            data-testid="auto-scroll-stop"
            aria-label="Parar rolagem"
            className="btn btn-secondary"
            disabled={autoScrollState === 'stopped'}
            onClick={handleStopScroll}
            style={{ minHeight: '44px', padding: '6px 12px', fontSize: '0.82rem' }}
          >
            Parar
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button
              type="button"
              data-testid="auto-scroll-speed-down"
              aria-label="Diminuir velocidade de rolagem"
              className="btn btn-secondary smart-chords-touch-btn"
              disabled={scrollSpeedLevel <= 1}
              onClick={() => setScrollSpeedLevel((prev) => Math.max(1, prev - 1))}
              style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', padding: 0 }}
            >
              −
            </button>
            <input
              type="range"
              data-testid="auto-scroll-speed-range"
              aria-label="Velocidade da rolagem"
              min="1"
              max="5"
              step="1"
              value={scrollSpeedLevel}
              onChange={(e) => setScrollSpeedLevel(Number(e.target.value))}
              style={{ width: '68px', accentColor: 'var(--action-primary-bg)' }}
            />
            <span
              data-testid="auto-scroll-speed-value"
              style={{ fontSize: '0.82rem', fontWeight: 700, minWidth: '28px', textAlign: 'center', fontFamily: 'var(--font-mono, monospace)' }}
            >
              {scrollSpeedLevel}x
            </span>
            <button
              type="button"
              data-testid="auto-scroll-speed-up"
              aria-label="Aumentar velocidade de rolagem"
              className="btn btn-secondary smart-chords-touch-btn"
              disabled={scrollSpeedLevel >= 5}
              onClick={() => setScrollSpeedLevel((prev) => Math.min(5, prev + 1))}
              style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', padding: 0 }}
            >
              +
            </button>
          </div>

          {prefersReducedMotion && (
            <div data-testid="reduced-motion-notice" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--status-warning-text)', fontWeight: 600 }}>
                Movimento reduzido ativo
              </span>
              <button
                type="button"
                data-testid="reduced-motion-toggle"
                className="btn btn-secondary"
                style={{ minHeight: '36px', padding: '4px 8px', fontSize: '0.75rem' }}
                onClick={() => {
                  if (allowReducedMotionScroll) {
                    setAllowReducedMotionScroll(false);
                    setAutoScrollState('stopped');
                  } else {
                    setAllowReducedMotionScroll(true);
                  }
                }}
              >
                {allowReducedMotionScroll ? 'Desativar rolagem' : 'Permitir rolagem'}
              </button>
            </div>
          )}
        </div>

        {/* Group 3: Fullscreen & Typography/Spacing Options */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginLeft: 'auto' }}>
          <button
            type="button"
            data-testid="reader-fullscreen-toggle"
            aria-label={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
            aria-pressed={isFullscreen}
            className="btn btn-secondary"
            onClick={() => void handleToggleFullscreen()}
            style={{ minHeight: '44px', padding: '8px 12px', fontSize: '0.82rem' }}
          >
            {isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
          </button>

          <details className="smart-chords-reading-options">
            <summary className="btn btn-secondary" style={{ minHeight: '44px', fontSize: '0.82rem' }}>
              Aparência da leitura
            </summary>
            <div className="smart-chords-reading-options-body">
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(140px, 1fr) auto auto',
                  alignItems: 'center',
                  gap: '8px',
                  flex: '1 1 240px',
                  minWidth: 0,
                }}
              >
                <label htmlFor="reading-line-spacing" style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                  Espaçamento entre linhas
                </label>
                <button
                  type="button"
                  aria-label="Diminuir espaçamento entre linhas"
                  className="btn btn-secondary smart-chords-touch-btn"
                  disabled={chordLineSpacingPx <= 0}
                  style={{ width: '44px', height: '44px', minWidth: '44px', padding: 0 }}
                  onClick={() => void handleChordLineSpacingChange(chordLineSpacingPx - 2)}
                >
                  −
                </button>
                <strong data-testid="reading-line-spacing-value" style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '0.85rem' }}>
                  {chordLineSpacingPx}px
                </strong>
                <input
                  id="reading-line-spacing"
                  data-testid="reading-line-spacing"
                  aria-label="Espaçamento entre linhas"
                  type="range"
                  min="0"
                  max="24"
                  step="2"
                  value={chordLineSpacingPx}
                  onChange={(event) => void handleChordLineSpacingChange(Number(event.target.value))}
                  style={{ gridColumn: '1 / 2', width: '100%', accentColor: 'var(--action-primary-bg)' }}
                />
                <button
                  type="button"
                  aria-label="Aumentar espaçamento entre linhas"
                  className="btn btn-secondary smart-chords-touch-btn"
                  disabled={chordLineSpacingPx >= 24}
                  style={{ width: '44px', height: '44px', minWidth: '44px', padding: 0 }}
                  onClick={() => void handleChordLineSpacingChange(chordLineSpacingPx + 2)}
                >
                  +
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  aria-label="Restaurar espaçamento padrão"
                  onClick={() => void handleChordLineSpacingChange(0)}
                  disabled={chordLineSpacingPx === 0}
                  style={{ minHeight: '44px', padding: '0 10px', fontSize: '0.8rem' }}
                >
                  Padrão
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Fonte:</span>
                <select
                  aria-label="Selecionar fonte da cifra"
                  data-testid="font-family-select"
                  className="form-control"
                  value={sheetFontFamily}
                  onChange={(e) => handleFontFamilyChange(e.target.value)}
                  style={{
                    minHeight: '44px',
                    padding: '6px 12px',
                    fontSize: '0.85rem',
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: '8px',
                    cursor: 'pointer',
                  }}
                >
                  {CHORD_FONT_FAMILIES.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Tamanho da Fonte:</span>
                <button
                  type="button"
                  aria-label="Diminuir tamanho da fonte"
                  className="btn btn-secondary smart-chords-touch-btn"
                  style={{
                    width: '44px',
                    height: '44px',
                    minWidth: '44px',
                    minHeight: '44px',
                    padding: 0,
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    fontSize: '1.1rem',
                    fontWeight: 700,
                    borderRadius: '8px',
                  }}
                  onClick={() => setPrintFontSize((prev) => Math.max(10, prev - 1))}
                >
                  -
                </button>
                <span style={{ fontSize: '0.875rem', minWidth: '40px', textAlign: 'center', fontWeight: 700, fontFamily: 'var(--font-mono, monospace)' }}>
                  {printFontSize}px
                </span>
                <button
                  type="button"
                  aria-label="Aumentar tamanho da fonte"
                  className="btn btn-secondary smart-chords-touch-btn"
                  style={{
                    width: '44px',
                    height: '44px',
                    minWidth: '44px',
                    minHeight: '44px',
                    padding: 0,
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    fontSize: '1.1rem',
                    fontWeight: 700,
                    borderRadius: '8px',
                  }}
                  onClick={() => setPrintFontSize((prev) => Math.min(24, prev + 1))}
                >
                  +
                </button>
              </div>
            </div>
          </details>
        </div>
      </div>

      {/* Rendered sheet box (scrollable reading surface + printable sheet) */}
      <div
        ref={sheetScrollRef}
        data-testid="reading-sheet-scroll"
        onScroll={syncManualScrollPosition}
        onWheel={syncManualScrollPosition}
        onTouchMove={syncManualScrollPosition}
        className="print-sheet-box smart-chords-reading-sheet"
        style={{
          flex: 1,
          padding: 'clamp(16px, 3vw, 28px)',
          borderRadius: '12px',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          overflowX: 'auto',
          overflowY: 'auto',
          maxHeight: isFullscreen ? 'calc(100dvh - 110px)' : 'calc(100dvh - 220px)',
          minHeight: '340px',
          fontFamily: activeFontFamilyCss,
        }}
      >
        {/* Print/Visual header inside the sheet container */}
        <div
          style={{
            borderBottom: '1px solid var(--border-subtle)',
            paddingBottom: '12px',
            marginBottom: '20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div>
            <h2 style={{ fontSize: '1.45rem', fontWeight: 700, margin: '0 0 4px 0', color: 'var(--text-primary)', fontFamily: activeFontFamilyCss }}>
              {title || 'Nova Cifra'}
            </h2>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', gap: '20px', flexWrap: 'wrap', fontFamily: activeFontFamilyCss }}>
              <span>
                <strong>Artista:</strong> {selectedArtistName}
              </span>
              <span>
                <strong>Tom:</strong> <strong style={{ color: 'var(--chord-text)' }}>{currentKeyTransposed}</strong>
              </span>
            </div>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Toque na sílaba ou acorde para ajuste rápido
          </span>
        </div>

        {/* Sheet segments */}
        <div data-testid="reading-lines" style={{ display: 'flex', flexDirection: 'column', gap: `${chordLineSpacingPx}px` }}>
          {rawLines.map((lineText, lineIdx) => {
            if (isTablatureLine(lineText)) {
              return (
                <div
                  key={lineIdx}
                  role="group"
                  data-musical-tablature
                  aria-label={lineText}
                  style={{
                    display: 'flex',
                    flexWrap: 'nowrap',
                    whiteSpace: 'pre',
                    overflowX: 'auto',
                    fontFamily: 'monospace, "Courier New", Courier',
                    fontSize: `${pdfFontSize}px`,
                    lineHeight: '1.4',
                    color: 'var(--text-primary)',
                    minHeight: '1.4em',
                    userSelect: 'text',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    backgroundColor: 'var(--bg-surface-subtle)',
                  }}
                >
                  {lineText}
                </div>
              );
            }
            if (hasBarProgression(lineText)) {
              const tokens = parseBarProgressionLine(lineText);
              return (
                <div
                  key={lineIdx}
                  role="group"
                  data-musical-progression
                  aria-label={lineText || 'Linha de compassos'}
                  style={{
                    display: 'flex',
                    flexWrap: 'nowrap',
                    whiteSpace: 'pre',
                    overflowX: 'auto',
                    alignItems: 'baseline',
                    rowGap: `${printFontSize + 7}px`,
                    fontFamily: activeFontFamilyCss,
                    fontSize: `${printFontSize}px`,
                    lineHeight: '1.4',
                    paddingTop: `${printFontSize + 3}px`,
                  }}
                >
                  {tokens.map((token, tokenIdx) => {
                    if (token.type === 'chord') {
                      const isEditing = editingCell && editingCell.lineIdx === lineIdx && editingCell.barChordIdx === token.chordIndex;
                      const transposedChord = transposeChord(token.value, semitones);
                      return (
                        <div
                          key={tokenIdx}
                          role="button"
                          tabIndex={0}
                          aria-label={`Editar acorde ${transposedChord}`}
                          onKeyDown={(event) => {
                            if (event.target !== event.currentTarget) return;
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setEditingCell({ lineIdx, barChordIdx: token.chordIndex });
                              setEditingChordValue(token.value);
                            }
                          }}
                          onClick={() => {
                            if (!isEditing && token.chordIndex !== undefined) {
                              setEditingCell({ lineIdx, barChordIdx: token.chordIndex });
                              setEditingChordValue(token.value);
                            }
                          }}
                          style={{
                            position: 'relative',
                            cursor: 'pointer',
                            userSelect: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            minHeight: '28px',
                          }}
                        >
                          {isEditing ? (
                            renderInlineEditor(lineIdx, undefined, token.chordIndex)
                          ) : (
                            <span
                              className="has-chord"
                              data-bar-chord-idx={token.chordIndex}
                              style={{
                                color: 'var(--chord-text)',
                                fontWeight: 'bold',
                                textDecoration: 'underline 2px solid var(--chord-text)',
                                padding: '0 1px',
                              }}
                            >
                              {transposedChord}
                            </span>
                          )}
                        </div>
                      );
                    }

                    if (token.type === 'delimiter') {
                      return (
                        <span
                          key={tokenIdx}
                          style={{
                            color: token.value === '%' ? 'var(--chord-text)' : 'var(--text-secondary)',
                            fontWeight: 'bold',
                            userSelect: 'none',
                          }}
                        >
                          {token.value}
                        </span>
                      );
                    }

                    if (token.type === 'whitespace') {
                      return (
                        <span key={tokenIdx} style={{ whiteSpace: 'pre' }}>
                          {token.value}
                        </span>
                      );
                    }

                    if (token.type === 'bracket_open' || token.type === 'bracket_close') {
                      return null;
                    }

                    return (
                      <span key={tokenIdx} style={{ color: 'var(--text-primary)' }}>
                        {token.value}
                      </span>
                    );
                  })}
                </div>
              );
            }

            const visual = rawToVisual(lineText);
            const text = visual.cleanText;

            if (!text && Object.keys(visual.chords).length === 0) {
              const isEditingEmpty = editingCell && editingCell.lineIdx === lineIdx && editingCell.charIdx === 0;
              return (
                <div
                  key={lineIdx}
                  className="smart-chords-empty-line"
                  role="button"
                  tabIndex={0}
                  aria-label={`Inserir acorde na linha vazia ${lineIdx + 1}`}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setEditingCell({ lineIdx, charIdx: 0 });
                      setEditingChordValue('');
                    }
                  }}
                  onClick={() => {
                    if (!isEditingEmpty) {
                      setEditingCell({ lineIdx, charIdx: 0 });
                      setEditingChordValue('');
                    }
                  }}
                  style={{
                    height: '36px',
                    margin: '4px 0',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    border: '1px dashed var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    opacity: 0.65,
                    position: 'relative',
                  }}
                >
                  {isEditingEmpty ? (
                    renderInlineEditor(lineIdx, 0)
                  ) : (
                    <span className="smart-chords-insert-hint">Linha vazia — toque para inserir acorde</span>
                  )}
                </div>
              );
            }

            return (
              <div
                key={lineIdx}
                role="group"
                data-musical-progression
                aria-label={lineText || 'Linha vazia'}
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  rowGap: `${printFontSize + 7 + chordLineSpacingPx}px`,
                  fontFamily: activeFontFamilyCss,
                  fontSize: `${printFontSize}px`,
                  lineHeight: '1.4',
                  paddingTop: `${printFontSize + 3}px`,
                }}
              >
                {text.split('').map((char, charIdx) => {
                  const isEditing = editingCell && editingCell.lineIdx === lineIdx && editingCell.charIdx === charIdx;
                  const hasChord = visual.chords[charIdx] !== undefined;
                  const chord = visual.chords[charIdx] || '';
                  const transposedChord = hasChord ? transposeChord(chord, semitones) : '';

                  return (
                    <div
                      key={charIdx}
                      role="button"
                      tabIndex={0}
                      aria-label={`Editar acorde na linha ${lineIdx + 1}, posição ${charIdx + 1}`}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setEditingCell({ lineIdx, charIdx });
                          setEditingChordValue(chord);
                        }
                      }}
                      onClick={() => {
                        if (!isEditing) {
                          setEditingCell({ lineIdx, charIdx });
                          setEditingChordValue(chord);
                        }
                      }}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        position: 'relative',
                        cursor: 'pointer',
                        userSelect: 'none',
                      }}
                    >
                      {/* Inline Input Editor */}
                      {isEditing ? (
                        renderInlineEditor(lineIdx, charIdx)
                      ) : (
                        /* Chord absolute positioned above the syllable character */
                        hasChord && (
                          <span
                            aria-hidden="true"
                            className="print-chord-span"
                            style={{
                              position: 'absolute',
                              bottom: '100%',
                              left: 0,
                              color: 'var(--chord-text)',
                              fontWeight: 'bold',
                              fontSize: `${Math.round(printFontSize * 0.9)}px`,
                              whiteSpace: 'nowrap',
                              padding: '0 1px',
                            }}
                          >
                            {transposedChord}
                          </span>
                        )
                      )}
                      {/* Character */}
                      <span
                        aria-hidden="true"
                        className={hasChord ? 'has-chord' : ''}
                        style={{
                          textDecoration: hasChord ? 'underline 2px solid var(--chord-text)' : 'none',
                          color: 'var(--text-primary)',
                        }}
                      >
                        {char === ' ' ? '\u00A0' : char}
                      </span>
                    </div>
                  );
                })}

                {/* Extra cell tap "+" at the end */}
                {(() => {
                  const isEditingExtra = editingCell && editingCell.lineIdx === lineIdx && editingCell.charIdx === text.length;
                  const hasExtraChord = visual.chords[text.length] !== undefined;
                  const extraChord = visual.chords[text.length] || '';

                  return (
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={`Inserir acorde ao final da linha ${lineIdx + 1}`}
                      onKeyDown={(event) => {
                        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                          event.preventDefault();
                          event.currentTarget.click();
                        }
                      }}
                      onClick={() => {
                        if (!isEditingExtra) {
                          setEditingCell({ lineIdx, charIdx: text.length });
                          setEditingChordValue(extraChord);
                        }
                      }}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        position: 'relative',
                        cursor: 'pointer',
                        userSelect: 'none',
                        marginLeft: '4px',
                      }}
                    >
                      {isEditingExtra ? (
                        renderInlineEditor(lineIdx, text.length)
                      ) : (
                        hasExtraChord && (
                          <span
                            aria-hidden="true"
                            className="print-chord-span"
                            style={{
                              position: 'absolute',
                              bottom: '100%',
                              left: 0,
                              color: 'var(--chord-text)',
                              fontWeight: 'bold',
                              fontSize: `${Math.round(printFontSize * 0.9)}px`,
                              whiteSpace: 'nowrap',
                              padding: '0 1px',
                            }}
                          >
                            {transposeChord(extraChord, semitones)}
                          </span>
                        )
                      )}
                      <span
                        className="smart-chords-insert-hint"
                        aria-hidden="true"
                        style={{ fontSize: `${Math.round(printFontSize * 0.8)}px`, color: 'var(--text-muted)', opacity: 0.6 }}
                      >
                        ➕
                      </span>
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import {
  analyzeDegree,
  analyzeHarmony,
  chordTones,
  HarmonyAnalysisResult,
  HarmonyNeighbours,
  KeyContext,
  Result,
  ChordNormalized,
  Interval,
  Parsed,
} from '../../music/theory';
import { findGuitarVoicings } from '../../music/guitarCatalog';
import {
  ChordGuitarDiagram,
  describeGuitarAriaSummary,
} from './ChordGuitarDiagram';

export interface ActiveKeyInfo {
  pos: number;
  spelling: string;
  isRoot: boolean;
  isBass: boolean;
  isChordTone: boolean;
  role: 'root' | 'bass' | 'root-bass' | 'chord-tone';
  intervalName: string;
}

const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11];
export const isWhitePitch = (p: number): boolean => WHITE_PCS.includes(((p % 12) + 12) % 12);

export function describeInterval(interval: Interval, isRoot = false): string {
  if (isRoot || (interval.diatonicSteps === 0 && interval.semitones === 0)) {
    return 'Fundamental (1ª)';
  }
  const steps = interval.diatonicSteps;
  const semitones = interval.semitones;

  if (steps === 1) {
    if (semitones === 1) return '2ª menor';
    if (semitones === 2) return '2ª maior';
    if (semitones === 3) return '2ª aumentada';
    return '2ª';
  }
  if (steps === 2) {
    if (semitones === 2) return '3ª diminuta';
    if (semitones === 3) return '3ª menor';
    if (semitones === 4) return '3ª maior';
    return '3ª';
  }
  if (steps === 3) {
    if (semitones === 4) return '4ª diminuta';
    if (semitones === 5) return '4ª justa';
    if (semitones === 6) return '4ª aumentada';
    return '4ª';
  }
  if (steps === 4) {
    if (semitones === 6) return '5ª diminuta';
    if (semitones === 7) return '5ª justa';
    if (semitones === 8) return '5ª aumentada';
    return '5ª';
  }
  if (steps === 5) {
    if (semitones === 8) return '6ª menor';
    if (semitones === 9) return '6ª maior';
    if (semitones === 10) return '6ª aumentada';
    return '6ª';
  }
  if (steps === 6) {
    if (semitones === 9) return '7ª diminuta';
    if (semitones === 10) return '7ª menor';
    if (semitones === 11) return '7ª maior';
    return '7ª';
  }
  if (steps === 8) {
    if (semitones === 13) return '9ª menor';
    if (semitones === 14) return '9ª maior';
    if (semitones === 15) return '9ª aumentada';
    return '9ª';
  }
  if (steps === 10) {
    if (semitones === 17) return '11ª justa';
    if (semitones === 18) return '11ª aumentada';
    return '11ª';
  }
  if (steps === 12) {
    if (semitones === 20) return '13ª menor';
    if (semitones === 21) return '13ª maior';
    return '13ª';
  }
  return `${steps + 1}ª`;
}

export function translateQuality(quality: ChordNormalized['quality'], seventh: ChordNormalized['seventh']): string {
  if (quality === 'diminished' && seventh === 'minor') {
    return 'Meio-diminuto';
  }
  switch (quality) {
    case 'major': return 'Maior';
    case 'minor': return 'Menor';
    case 'diminished': return 'Diminuto';
    case 'augmented': return 'Aumentado';
    case 'suspended2': return 'Suspenso (sus2)';
    case 'suspended4': return 'Suspenso (sus4)';
    default: return quality;
  }
}

export function translateSeventh(seventh: ChordNormalized['seventh']): string | null {
  if (!seventh) return null;
  switch (seventh) {
    case 'major': return '7ª Maior';
    case 'minor': return '7ª Menor';
    case 'diminished': return '7ª Diminuta';
    default: return seventh;
  }
}

export function translateUnsupportedReason(reason: string, preservedText: string): string {
  switch (reason) {
    case 'unspecifiedAlteredToneSet':
      return 'Acordes alterados ("alt") possuem múltiplas escolhas harmônicas de extensões e não possuem uma digitação ou formação única na v1.';
    case 'powerChordOutsideV1':
      return 'Power chords ("5" ou acordes sem terça) estão fora do modelo harmônico da versão 1.';
    case 'notationMarkerNotChord':
      return '"N.C." (No Chord) indica pausa ou ausência de harmonia, não sendo um acorde.';
    case 'moreThanDoubleAccidental':
    case 'targetRequiresTripleAccidental':
      return 'A grafia requer acidentes triplos, fora do limite suportado.';
    case 'emptyInput':
      return 'Nenhum símbolo de acorde fornecido.';
    default:
      return `O símbolo "${preservedText}" não é suportado pelo motor harmônico v1.`;
  }
}

export interface ChordPianoDiagramProps {
  parsed: Parsed<ChordNormalized>;
  className?: string;
}

const WHITE_KEY_WIDTH = 42;
const WHITE_KEY_HEIGHT = 160;
const BLACK_KEY_WIDTH = 26;
const BLACK_KEY_HEIGHT = 98;

export function ChordPianoDiagram({ parsed, className }: ChordPianoDiagramProps) {
  const { normalized, notes } = parsed;
  const { root, bass } = normalized;

  const [octaveOffset, setOctaveOffset] = useState<number>(0);

  useEffect(() => {
    setOctaveOffset(0);
  }, [parsed.originalText]);

  const shiftSemitones = octaveOffset * 12;
  const baseBassPos = bass ? bass.pitchClass : null;
  const baseRootPos = bass
    ? (root.pitchClass > baseBassPos! ? root.pitchClass : root.pitchClass + 12)
    : root.pitchClass;

  const bassPos = baseBassPos !== null ? baseBassPos + shiftSemitones : null;
  const rootPos = baseRootPos + shiftSemitones;

  const activeMap = new Map<number, ActiveKeyInfo>();
  const activePositions: number[] = [];

  normalized.intervals.forEach((interval, idx) => {
    const note = notes[idx];
    const pos = rootPos + interval.semitones;
    const isRoot = (idx === 0);
    activePositions.push(pos);
    activeMap.set(pos, {
      pos,
      spelling: note ? note.spelling : (isRoot ? root.spelling : ''),
      isRoot,
      isBass: false,
      isChordTone: !isRoot,
      role: isRoot ? 'root' : 'chord-tone',
      intervalName: describeInterval(interval, isRoot),
    });
  });

  if (bass && bassPos !== null) {
    activePositions.push(bassPos);
    const existing = activeMap.get(bassPos);
    const isChordTone = normalized.bassRole === 'chordTone';
    const bassDesc = isChordTone
      ? (normalized.inversion === 0 ? 'Fundamental' : `${normalized.inversion}ª inversão`)
      : 'Baixo externo';

    if (existing) {
      activeMap.set(bassPos, {
        ...existing,
        isBass: true,
        role: existing.isRoot ? 'root-bass' : 'chord-tone',
        intervalName: `${existing.intervalName} / Baixo (${bassDesc})`,
      });
    } else {
      activeMap.set(bassPos, {
        pos: bassPos,
        spelling: bass.spelling,
        isRoot: false,
        isBass: true,
        isChordTone,
        role: 'bass',
        intervalName: `Baixo (${bassDesc})`,
      });
    }
  }

  const minShifted = activePositions.length > 0 ? Math.min(...activePositions) : shiftSemitones;
  const maxShifted = activePositions.length > 0 ? Math.max(...activePositions) : 23 + shiftSemitones;

  const baseMinPos = minShifted - shiftSemitones;
  const baseMaxPos = maxShifted - shiftSemitones;
  const autoAdjusted = !(baseMinPos >= 0 && baseMaxPos <= 23);

  const minOct = Math.floor(minShifted / 12);
  const maxOct = Math.floor(maxShifted / 12);
  const startOct =
    minShifted >= 0 && maxShifted <= 23
      ? 0
      : octaveOffset === 0 && minShifted >= 0 && maxShifted <= 35
        ? 0
        : minOct;
  const numOctaves = Math.max(2, maxOct - startOct + 1);
  const startKey = startOct * 12;
  const endKey = (startOct + numOctaves) * 12 - 1;

  const whiteKeys: number[] = [];
  const blackKeys: number[] = [];
  for (let k = startKey; k <= endKey; k++) {
    if (isWhitePitch(k)) {
      whiteKeys.push(k);
    } else {
      blackKeys.push(k);
    }
  }

  const totalWidth = whiteKeys.length * WHITE_KEY_WIDTH;
  const totalHeight = WHITE_KEY_HEIGHT + 10;

  return (
    <div className={className || 'chord-piano-diagram'}>
      <div className="chord-piano-legend" data-testid="chord-piano-didactic-legend">
        Visualização didática das notas e classes de altura (sem voicing fixo)
      </div>

      <div className="chord-piano-controls" data-testid="chord-piano-controls" style={{ margin: '10px 0' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            data-testid="piano-octave-down"
            aria-label="Deslocar -1 oitava"
            className="chord-piano-ctrl-btn"
            disabled={octaveOffset <= -1}
            onClick={() => {
              setOctaveOffset(prev => Math.max(-1, prev - 1));
            }}
          >
            −1 oitava
          </button>
          <button
            type="button"
            data-testid="piano-octave-auto"
            aria-label="Faixa automática"
            className="chord-piano-ctrl-btn"
            disabled={octaveOffset === 0}
            onClick={() => {
              setOctaveOffset(0);
            }}
          >
            Automático
          </button>
          <button
            type="button"
            data-testid="piano-octave-up"
            aria-label="Deslocar +1 oitava"
            className="chord-piano-ctrl-btn"
            disabled={octaveOffset >= 1}
            onClick={() => {
              setOctaveOffset(prev => Math.min(1, prev + 1));
            }}
          >
            +1 oitava
          </button>
        </div>
        {octaveOffset !== 0 && (
          <div
            data-testid="octave-offset-notice"
            role="status"
            className="chord-piano-notice"
            style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}
          >
            Registro visual: {octaveOffset > 0 ? '+1 oitava' : '-1 oitava'}
          </div>
        )}
        {autoAdjusted && octaveOffset === 0 && (
          <div
            data-testid="adjusted-range-notice"
            role="status"
            className="chord-piano-notice"
            style={{ fontSize: '0.8rem', color: 'var(--status-warning-text)', fontWeight: 600 }}
          >
            Faixa ajustada para {numOctaves} oitavas para visualização completa do acorde
          </div>
        )}
      </div>

      <div className="chord-piano-svg-wrap">
        <svg
          viewBox={`0 0 ${totalWidth} ${totalHeight}`}
          style={{
            width: '100%',
            minWidth: numOctaves > 2 ? `${whiteKeys.length * 22}px` : undefined,
            height: 'auto',
            display: 'block',
            maxHeight: '200px',
          }}
          role="img"
          aria-label={`Teclado de piano para o acorde ${parsed.originalText}`}
        >
          {/* White keys first */}
          <g className="white-keys">
            {whiteKeys.map((k, wIndex) => {
              const x = wIndex * WHITE_KEY_WIDTH;
              const y = 0;
              const activeInfo = activeMap.get(k);
              const isActive = activeInfo !== undefined;
              return (
                <g
                  key={`white-${k}`}
                  data-key-pos={k}
                  data-key-active={isActive ? 'true' : 'false'}
                  data-key-role={activeInfo ? activeInfo.role : undefined}
                  data-key-spelling={activeInfo ? activeInfo.spelling : undefined}
                  className={`piano-key-group white-key-group ${isActive ? 'active ' + activeInfo!.role : ''}`}
                >
                  <rect
                    x={x}
                    y={y}
                    width={WHITE_KEY_WIDTH}
                    height={WHITE_KEY_HEIGHT}
                    rx={4}
                    ry={4}
                    className={`chord-key-white ${isActive ? `active-${activeInfo!.role}` : ''}`}
                    aria-label={
                      isActive
                        ? `Tecla ${activeInfo!.spelling}, ${activeInfo!.role === 'root' ? 'Fundamental' : activeInfo!.role === 'bass' ? 'Baixo' : 'Nota do acorde'}`
                        : undefined
                    }
                  />
                  {isActive && (
                    <>
                      <circle
                        cx={x + WHITE_KEY_WIDTH / 2}
                        cy={WHITE_KEY_HEIGHT - 38}
                        r={10}
                        className={`key-badge-circle ${activeInfo!.role}`}
                      />
                      <text
                        x={x + WHITE_KEY_WIDTH / 2}
                        y={WHITE_KEY_HEIGHT - 34}
                        textAnchor="middle"
                        className="key-badge-text"
                        fontSize="10"
                        fontWeight="bold"
                      >
                        {activeInfo!.isRoot ? 'F' : activeInfo!.isBass ? 'B' : ''}
                      </text>
                      <text
                        x={x + WHITE_KEY_WIDTH / 2}
                        y={WHITE_KEY_HEIGHT - 12}
                        textAnchor="middle"
                        className="key-spelling-text"
                        fontSize="12"
                        fontWeight="bold"
                      >
                        {activeInfo!.spelling}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </g>

          {/* Black keys second */}
          <g className="black-keys">
            {blackKeys.map((k) => {
              const wIndex = whiteKeys.indexOf(k - 1);
              const x = (wIndex + 1) * WHITE_KEY_WIDTH - (BLACK_KEY_WIDTH / 2);
              const y = 0;
              const activeInfo = activeMap.get(k);
              const isActive = activeInfo !== undefined;
              return (
                <g
                  key={`black-${k}`}
                  data-key-pos={k}
                  data-key-active={isActive ? 'true' : 'false'}
                  data-key-role={activeInfo ? activeInfo.role : undefined}
                  data-key-spelling={activeInfo ? activeInfo.spelling : undefined}
                  className={`piano-key-group black-key-group ${isActive ? 'active ' + activeInfo!.role : ''}`}
                >
                  <rect
                    x={x}
                    y={y}
                    width={BLACK_KEY_WIDTH}
                    height={BLACK_KEY_HEIGHT}
                    rx={3}
                    ry={3}
                    className={`chord-key-black ${isActive ? `active-${activeInfo!.role}` : ''}`}
                    aria-label={
                      isActive
                        ? `Tecla ${activeInfo!.spelling}, ${activeInfo!.role === 'root' ? 'Fundamental' : activeInfo!.role === 'bass' ? 'Baixo' : 'Nota do acorde'}`
                        : undefined
                    }
                  />
                  {isActive && (
                    <>
                      <circle
                        cx={x + BLACK_KEY_WIDTH / 2}
                        cy={BLACK_KEY_HEIGHT - 28}
                        r={8}
                        className={`key-badge-circle ${activeInfo!.role}`}
                      />
                      <text
                        x={x + BLACK_KEY_WIDTH / 2}
                        y={BLACK_KEY_HEIGHT - 25}
                        textAnchor="middle"
                        className="key-badge-text"
                        fontSize="9"
                        fontWeight="bold"
                      >
                        {activeInfo!.isRoot ? 'F' : activeInfo!.isBass ? 'B' : ''}
                      </text>
                      <text
                        x={x + BLACK_KEY_WIDTH / 2}
                        y={BLACK_KEY_HEIGHT - 8}
                        textAnchor="middle"
                        className="key-spelling-text black-key-spelling"
                        fontSize="11"
                        fontWeight="bold"
                      >
                        {activeInfo!.spelling}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}

export type DiagramInstrument = 'piano' | 'guitar';

const ANALYSIS_KEY_OPTIONS = [
  'C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B',
  'Am', 'Bm', 'Cm', 'C#m', 'Dm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m',
] as const;

export interface ChordPianoDiagramPanelProps {
  chordSymbol: string | null;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
  initialInstrument?: DiagramInstrument;
  keyContext?: string | KeyContext | null;
  /** Chords around this one on the same line, used to read passing basses. */
  neighbours?: HarmonyNeighbours;
}

export function ChordPianoDiagramPanel({
  chordSymbol,
  onClose,
  triggerRef,
  initialInstrument = 'piano',
  keyContext,
  neighbours,
}: ChordPianoDiagramPanelProps) {
  const [position, setPosition] = useState<{ chord: string | null; index: number }>({ chord: null, index: 0 });
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [instrument, setInstrument] = useState<DiagramInstrument>(initialInstrument);
  const [selectedKey, setSelectedKey] = useState<string | KeyContext | null>(keyContext ?? null);
  const [isKeyPickerOpen, setIsKeyPickerOpen] = useState<boolean>(false);

  useEffect(() => {
    setSelectedKey(keyContext ?? null);
  }, [keyContext]);

  useEffect(() => {
    if (!chordSymbol) {
      setInstrument(initialInstrument);
      setSelectedKey(keyContext ?? null);
      setIsKeyPickerOpen(false);
      setPosition({ chord: null, index: 0 });
    }
  }, [chordSymbol, initialInstrument, keyContext]);

  useEffect(() => {
    if (chordSymbol) {
      previousFocusRef.current = (triggerRef?.current || document.activeElement) as HTMLElement | null;
      const frame = requestAnimationFrame(() => {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable && focusable.length > 0) {
          focusable[0].focus();
        }
      });
      return () => {
        cancelAnimationFrame(frame);
      };
    }
  }, [chordSymbol, triggerRef]);

  if (!chordSymbol) {
    return null;
  }

  const result: Result<ChordNormalized> = chordTones(chordSymbol.trim());
  const foundVoicings = result.status === 'parsed'
    ? findGuitarVoicings(result.originalText)
    : null;
  const positionCount = foundVoicings?.status === 'available' ? foundVoicings.voicings.length : 0;
  const positionIndex = position.chord === chordSymbol && position.index < positionCount ? position.index : 0;
  const guitarLookup = foundVoicings?.status === 'available'
    ? { ...foundVoicings, primaryVoicing: foundVoicings.voicings[positionIndex] }
    : foundVoicings;
  const stepPosition = (step: number) =>
    setPosition({ chord: chordSymbol, index: (positionIndex + step + positionCount) % positionCount });
  const harmonyResult: HarmonyAnalysisResult | null = result.status === 'parsed'
    ? analyzeDegree(result.originalText, selectedKey)
    : null;
  const harmonyReadings = result.status === 'parsed'
    ? analyzeHarmony(result.originalText, selectedKey, neighbours)
    : null;
  const readings = harmonyReadings?.status === 'analyzed' ? harmonyReadings.readings : [];
  // A single diatonic reading is already what the degree badge says.
  const showReadings = readings.length > 1 || (readings.length === 1 && readings[0].kind !== 'diatonic');

  const baseLiveSummary = result.status === 'unsupported'
    ? `Diagrama indisponível para ${result.preservedText || chordSymbol}. ${translateUnsupportedReason(result.reason, result.preservedText || chordSymbol)}`
    : instrument === 'guitar' && guitarLookup
      ? describeGuitarAriaSummary(result.originalText, guitarLookup)
      : `Acorde ${result.originalText}. Qualidade: ${translateQuality(result.normalized.quality, result.normalized.seventh)}.${result.normalized.bass ? ` Baixo: ${result.normalized.bass.spelling}.` : ''} Notas: ${result.notes.map(n => n.spelling).join(', ')}.`;

  const degreeSummary = harmonyResult?.status === 'analysis'
    ? ` Grau harmônico: ${harmonyResult.analysis.degree} em ${harmonyResult.key.canonicalKey}.`
    : '';
  const readingsSummary = showReadings
    ? ` Leituras harmônicas: ${readings.map(reading => reading.label).join('; ')}.`
    : '';
  const liveSummary = `${baseLiveSummary}${degreeSummary}${readingsSummary}`;

  const handleClose = () => {
    onClose();
    requestAnimationFrame(() => {
      const target = triggerRef?.current || previousFocusRef.current;
      if (target && typeof target.focus === 'function') {
        target.focus();
      }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      handleClose();
      return;
    }
    if (e.key === 'Tab') {
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  };

  return (
    <div
      className="chord-piano-backdrop"
      data-testid="chord-piano-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="chord-piano-title"
        className="chord-piano-dialog"
        data-testid="chord-piano-dialog"
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div aria-live="polite" className="sr-only" data-testid="chord-piano-live-region">
          {liveSummary}
        </div>

        {result.status === 'unsupported' ? (
          <div className="chord-piano-unsupported" data-testid="chord-piano-unsupported">
            <div className="chord-piano-header">
              <div className="chord-piano-header-title">
                <h2 id="chord-piano-title" style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700 }}>
                  Diagrama indisponível para {result.preservedText || chordSymbol}
                </h2>
              </div>
              <button
                type="button"
                data-testid="chord-piano-close-btn"
                aria-label="Fechar diagrama de piano"
                className="chord-piano-close-btn"
                onClick={handleClose}
              >
                ✕
              </button>
            </div>
            <p
              data-testid="chord-unsupported-reason"
              style={{ color: 'var(--text-secondary)', margin: '16px 0 24px', lineHeight: 1.5 }}
            >
              {translateUnsupportedReason(result.reason, result.preservedText || chordSymbol)}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                data-testid="chord-unsupported-close-action"
                className="btn btn-secondary"
                style={{ minHeight: '44px', minWidth: '44px', padding: '0 16px' }}
                onClick={handleClose}
              >
                Fechar
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="chord-piano-header">
              <div className="chord-piano-header-title">
                <h2 id="chord-piano-title" style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700 }}>
                  {result.originalText}
                </h2>
                {result.normalized.canonicalSymbol !== result.originalText && (
                  <span
                    data-testid="chord-canonical-symbol"
                    style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}
                  >
                    Canônico: {result.normalized.canonicalSymbol}
                  </span>
                )}
              </div>
              <button
                type="button"
                data-testid="chord-piano-close-btn"
                aria-label="Fechar diagrama de piano"
                className="chord-piano-close-btn"
                onClick={handleClose}
              >
                ✕
              </button>
            </div>

            <div
              className="chord-diagram-instrument-switcher"
              role="group"
              aria-label="Selecionar instrumento do diagrama"
              data-testid="diagram-instrument-switcher"
            >
              <button
                type="button"
                data-testid="diagram-instrument-piano"
                aria-pressed={instrument === 'piano'}
                className={`chord-piano-ctrl-btn ${instrument === 'piano' ? 'is-active' : ''}`}
                onClick={() => setInstrument('piano')}
              >
                Piano
              </button>
              <button
                type="button"
                data-testid="diagram-instrument-guitar"
                aria-pressed={instrument === 'guitar'}
                className={`chord-piano-ctrl-btn ${instrument === 'guitar' ? 'is-active' : ''}`}
                onClick={() => setInstrument('guitar')}
              >
                Violão
              </button>
            </div>

            {instrument === 'piano' ? (
              <ChordPianoDiagram parsed={result} />
            ) : (
              <>
                {positionCount > 1 && (
                  <div
                    role="group"
                    aria-label="Posições no violão"
                    data-testid="guitar-position-selector"
                    style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px' }}
                  >
                    <button
                      type="button"
                      className="chord-piano-ctrl-btn"
                      data-testid="guitar-position-prev"
                      aria-label="Posição anterior"
                      onClick={() => stepPosition(-1)}
                    >
                      ‹
                    </button>
                    <span data-testid="guitar-position-count" aria-live="polite">
                      {positionIndex + 1}/{positionCount}
                    </span>
                    <button
                      type="button"
                      className="chord-piano-ctrl-btn"
                      data-testid="guitar-position-next"
                      aria-label="Próxima posição"
                      onClick={() => stepPosition(1)}
                    >
                      ›
                    </button>
                  </div>
                )}
                <ChordGuitarDiagram
                  chordSymbol={result.originalText}
                  parsed={result}
                  lookup={guitarLookup ?? undefined}
                />
              </>
            )}

            <div className="chord-piano-metadata" data-testid="chord-piano-metadata">
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="chord-piano-pill is-root" data-testid="chord-quality-pill">
                  Qualidade: {translateQuality(result.normalized.quality, result.normalized.seventh)}
                </span>
                {result.normalized.seventh && translateQuality(result.normalized.quality, result.normalized.seventh) !== 'Meio-diminuto' && (
                  <span className="chord-piano-pill" data-testid="chord-seventh-pill">
                    Sétima: {translateSeventh(result.normalized.seventh)}
                  </span>
                )}
                {result.normalized.bass && (
                  <span className="chord-piano-pill is-bass" data-testid="chord-bass-pill">
                    {result.normalized.bassRole === 'chordTone'
                      ? `Baixo: ${result.normalized.bass.spelling} — nota do acorde, ${result.normalized.inversion === 0 ? 'fundamental' : `${result.normalized.inversion}ª inversão`}`
                      : `Baixo: ${result.normalized.bass.spelling} — baixo externo / slash bass`}
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <strong style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Notas e Intervalos:
                </strong>
                <ul
                  data-testid="chord-tones-list"
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '8px',
                    listStyle: 'none',
                    margin: 0,
                    padding: 0,
                  }}
                >
                  {result.notes.map((note, idx) => {
                    const interval = result.normalized.intervals[idx];
                    const desc = describeInterval(interval, idx === 0);
                    return (
                      <li
                        key={idx}
                        className="chord-piano-pill"
                        data-testid={`chord-tone-item-${idx}`}
                        style={{ fontSize: '0.8rem' }}
                      >
                        <strong>{note.spelling}</strong>{' '}
                        <span style={{ color: 'var(--text-secondary)', marginLeft: '4px' }}>
                          ({desc})
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {harmonyResult && harmonyResult.status !== 'unsupported' && (
                <section
                  className="chord-harmony-analysis"
                  data-testid="chord-harmony-analysis"
                  aria-label="Análise Harmônica Contextual"
                >
                  <div className="chord-harmony-header">
                    <strong className="chord-harmony-title">
                      Análise Harmônica Contextual
                    </strong>
                    <button
                      type="button"
                      data-testid="harmony-key-picker-btn"
                      aria-expanded={isKeyPickerOpen}
                      className="chord-piano-ctrl-btn"
                      onClick={() => setIsKeyPickerOpen(prev => !prev)}
                    >
                      Tom de análise: {harmonyResult.key ? harmonyResult.key.canonicalKey : 'Não definido'}
                    </button>
                  </div>

                  {isKeyPickerOpen && (
                    <div
                      className="chord-harmony-key-options"
                      role="group"
                      aria-label="Selecionar tonalidade de análise"
                      data-testid="harmony-key-options"
                    >
                      <button
                        type="button"
                        data-testid="harmony-key-option-none"
                        aria-pressed={!selectedKey}
                        className={`chord-piano-ctrl-btn ${!selectedKey ? 'is-active' : ''}`}
                        onClick={() => {
                          setSelectedKey(null);
                          setIsKeyPickerOpen(false);
                        }}
                      >
                        Sem tom
                      </button>
                      {ANALYSIS_KEY_OPTIONS.map((keyOption) => {
                        const isActive = harmonyResult.key?.canonicalKey === keyOption;
                        return (
                          <button
                            key={keyOption}
                            type="button"
                            data-testid={`harmony-key-option-${keyOption}`}
                            aria-pressed={isActive}
                            className={`chord-piano-ctrl-btn ${isActive ? 'is-active' : ''}`}
                            onClick={() => {
                              setSelectedKey(keyOption);
                              setIsKeyPickerOpen(false);
                            }}
                          >
                            {keyOption}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="chord-harmony-badges">
                    <span
                      className={`chord-piano-pill ${harmonyResult.status === 'analysis' ? 'is-root' : ''}`}
                      data-testid="harmony-degree-value"
                    >
                      {harmonyResult.status === 'analysis'
                        ? `Grau harmônico: ${harmonyResult.analysis.degree} (${harmonyResult.analysis.degreeNumber}º grau em ${harmonyResult.key.canonicalKey})`
                        : showReadings
                          ? 'Grau harmônico: veja as leituras possíveis'
                          : 'Grau harmônico: Grau não determinado'}
                    </span>
                    <span
                      className="chord-piano-pill"
                      data-testid="harmony-quality-value"
                    >
                      Qualidade harmônica: {harmonyResult.status === 'analysis'
                        ? harmonyResult.analysis.qualityLabel
                        : translateQuality(result.normalized.quality, result.normalized.seventh)}
                    </span>
                    <span
                      className={`chord-piano-pill ${harmonyResult.bassAnalysis.isInversion || harmonyResult.bassAnalysis.isExternalBass ? 'is-bass' : ''}`}
                      data-testid="harmony-bass-value"
                    >
                      Baixo / Inversão: {harmonyResult.bassAnalysis.label}
                    </span>
                  </div>

                  {(harmonyResult.status === 'analysis' || !showReadings) && (
                    <p className="chord-harmony-explanation" data-testid="harmony-explanation">
                      {harmonyResult.status === 'analysis'
                        ? harmonyResult.analysis.explanation
                        : harmonyResult.explanation}
                    </p>
                  )}

                  {showReadings && (
                    <ul className="chord-harmony-explanation" data-testid="harmony-readings" aria-label="Leituras possíveis">
                      {readings.map(reading => (
                        <li key={`${reading.kind}-${reading.label}`}>
                          <strong>{reading.label}</strong> — {reading.explanation}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ChordPianoDiagramPanel;

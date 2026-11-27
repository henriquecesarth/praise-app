import {
  ChordNormalized,
  Parsed,
} from '../../music/theory';
import {
  GuitarLookupResult,
  GuitarStringState,
  GuitarVoicing,
} from '../../music/guitarVoicings';
import { findGuitarVoicings } from '../../music/guitarCatalog';

export interface ChordGuitarDiagramProps {
  chordSymbol: string;
  parsed: Parsed<ChordNormalized>;
  lookup?: GuitarLookupResult;
  className?: string;
}

const FRET_COUNT = 5;
const LEFT_PAD = 44;
const RIGHT_PAD = 24;
const TOP_PAD = 42;
const BOTTOM_PAD = 44;
const STRING_SPACING = 38;
const FRET_HEIGHT = 36;
const GRID_WIDTH = 5 * STRING_SPACING;
const GRID_HEIGHT = FRET_COUNT * FRET_HEIGHT;
const TOTAL_WIDTH = LEFT_PAD + GRID_WIDTH + RIGHT_PAD;
const TOTAL_HEIGHT = TOP_PAD + GRID_HEIGHT + BOTTOM_PAD;

const STANDARD_OPEN_LABELS: Record<number, string> = {
  6: 'E2',
  5: 'A2',
  4: 'D3',
  3: 'G3',
  2: 'B3',
  1: 'E4',
};

function describeStringRole(
  s: GuitarStringState,
  voicing: GuitarVoicing,
  parsed: Parsed<ChordNormalized>,
): { role: 'root' | 'bass' | 'root-bass' | 'chord-tone' | 'muted'; roleDesc: string } {
  if (s.status === 'muted' || !s.spelling) {
    return { role: 'muted', roleDesc: 'Abafada (X)' };
  }
  const isLowest = s.stringNumber === voicing.lowestNote.stringNumber;
  // Inversion 0 covers a root spelled enharmonically in the bass (C/B#).
  const isRoot = s.spelling === parsed.normalized.root.spelling || (isLowest && parsed.normalized.inversion === 0);
  const hasExplicitBass = parsed.normalized.bass !== null;
  if (isRoot && isLowest) {
    return { role: 'root-bass', roleDesc: 'Fundamental / Baixo' };
  }
  if (isRoot) {
    return { role: 'root', roleDesc: 'Fundamental' };
  }
  if (isLowest && hasExplicitBass) {
    return {
      role: 'bass',
      roleDesc: parsed.normalized.bassRole === 'chordTone' ? 'Baixo (inversão)' : 'Baixo externo',
    };
  }
  if (isLowest) {
    return { role: 'bass', roleDesc: 'Nota mais grave' };
  }
  return { role: 'chord-tone', roleDesc: 'Nota do acorde' };
}

export function describeGuitarStringLegend(
  s: GuitarStringState,
  voicing: GuitarVoicing,
  parsed: Parsed<ChordNormalized>,
): string {
  const openName = STANDARD_OPEN_LABELS[s.stringNumber] ?? `${s.stringNumber}ª`;
  if (s.status === 'muted') {
    return `${s.stringNumber}ª corda (${openName}): Abafada (X)`;
  }
  const { roleDesc } = describeStringRole(s, voicing, parsed);
  if (s.status === 'open') {
    return `${s.stringNumber}ª corda (${openName}): Solta (O) — ${s.note} (${roleDesc})`;
  }
  const hasBarre = voicing.barres.some(
    b => b.fret === s.fret && b.finger === s.finger && s.stringNumber <= b.fromString && s.stringNumber >= b.toString,
  );
  const barreNote = hasBarre ? ', com pestana' : '';
  return `${s.stringNumber}ª corda (${openName}): ${s.fret}ª casa, dedo ${s.finger}${barreNote} — ${s.note} (${roleDesc})`;
}

export function describeGuitarAriaSummary(
  chordSymbol: string,
  lookup: GuitarLookupResult,
): string {
  if (lookup.status === 'unavailable') {
    return `Diagrama indisponível para ${lookup.preservedText || chordSymbol} no violão. ${lookup.message}`;
  }
  const v = lookup.primaryVoicing;
  const barreText = v.barres.length > 0
    ? ` Pestana na ${v.barres[0].fret}ª casa, dedo ${v.barres[0].finger}.`
    : '';
  const omitText = v.omits?.length ? ' Omite a 5ª justa.' : '';
  return `Violão para ${v.chordSymbol}. Posição: ${v.positionName}. Afinação padrão E2 A2 D3 G3 B3 E4.${barreText} Nota mais grave: ${v.lowestNote.note} na ${v.lowestNote.stringNumber}ª corda. Notas produzidas: ${v.soundingNotes.join(', ')}.${omitText} ${guitarOriginLabel(v)}.`;
}

export function guitarOriginLabel(voicing: GuitarVoicing): string {
  const { origin } = voicing.provenance;
  if (origin.startsWith('chords-db')) return 'Forma do chords-db (MIT © 2016 David Rubert)';
  if (origin.startsWith('Gerador')) return 'Forma gerada';
  if (origin.startsWith('Forma comum')) return 'Forma comum';
  return 'Forma curada';
}

export function ChordGuitarDiagram({
  chordSymbol,
  parsed,
  lookup: providedLookup,
  className,
}: ChordGuitarDiagramProps) {
  const lookup = providedLookup ?? findGuitarVoicings(chordSymbol);

  if (lookup.status === 'unavailable') {
    return (
      <div
        className={className || 'chord-guitar-unavailable'}
        data-testid="chord-guitar-unavailable"
        role="status"
      >
        <p className="chord-guitar-unavailable-title">
          Diagrama indisponível para {parsed.originalText} no violão
        </p>
        <p className="chord-guitar-unavailable-desc" data-testid="chord-guitar-unavailable-reason">
          Não há posição de violão tocável para este acorde. As notas teóricas e o diagrama de piano continuam disponíveis.
        </p>
      </div>
    );
  }

  const voicing = lookup.primaryVoicing;
  const baseFret = voicing.baseFret;
  const barreCoveredKeys = new Set<string>();
  voicing.barres.forEach(b => {
    for (let strNum = b.toString; strNum <= b.fromString; strNum++) {
      const st = voicing.strings.find(item => item.stringNumber === strNum);
      if (st && st.status === 'fretted' && st.fret === b.fret && st.finger === b.finger) {
        barreCoveredKeys.add(`${st.stringNumber}:${st.fret}:${st.finger}`);
      }
    }
  });

  const stringX = (stringNumber: number) => LEFT_PAD + (6 - stringNumber) * STRING_SPACING;
  const fretCenterY = (fret: number) => TOP_PAD + (fret - baseFret + 0.5) * FRET_HEIGHT;

  return (
    <div className={className || 'chord-guitar-diagram'} data-testid="chord-guitar-diagram">
      <div className="chord-piano-legend" data-testid="chord-guitar-position-header">
        <strong data-testid="chord-guitar-position-name">
          Posição: {voicing.positionName}
        </strong>
        {' · '}
        <span data-testid="chord-guitar-tuning">Afinação: E2 A2 D3 G3 B3 E4</span>
        {' · '}
        <span data-testid="chord-guitar-origin">
          {guitarOriginLabel(voicing)}{voicing.omits?.length ? ' · Omite a 5ª justa' : ''}
        </span>
      </div>

      <div className="chord-guitar-highlights">
        <span className="chord-piano-pill is-bass" data-testid="chord-guitar-lowest-note">
          Baixo efetivo: {voicing.lowestNote.note} ({voicing.lowestNote.stringNumber}ª corda)
        </span>
        {voicing.barres.map((b, idx) => (
          <span
            key={idx}
            className="chord-piano-pill is-root"
            data-testid="chord-guitar-barre-info"
          >
            Pestana: {b.fret}ª casa (cordas {b.fromString} a {b.toString}, dedo {b.finger})
          </span>
        ))}
      </div>

      <div className="chord-guitar-svg-wrap">
        <svg
          viewBox={`0 0 ${TOTAL_WIDTH} ${TOTAL_HEIGHT}`}
          style={{ width: '100%', maxWidth: '320px', height: 'auto', display: 'block', margin: '0 auto' }}
          role="img"
          aria-label={`Diagrama de violão para o acorde ${parsed.originalText}, ${voicing.positionName}`}
          data-testid="chord-guitar-svg"
        >
          {/* Nut / Top border */}
          <line
            x1={LEFT_PAD}
            y1={TOP_PAD}
            x2={LEFT_PAD + GRID_WIDTH}
            y2={TOP_PAD}
            className={baseFret === 1 ? 'guitar-nut-line' : 'guitar-fret-line'}
          />

          {/* Horizontal fret lines & fret numbers */}
          {Array.from({ length: FRET_COUNT }, (_, idx) => {
            const fretNum = baseFret + idx;
            const yLine = TOP_PAD + (idx + 1) * FRET_HEIGHT;
            const yText = TOP_PAD + (idx + 0.5) * FRET_HEIGHT + 4;
            return (
              <g key={`fret-${fretNum}`}>
                <line
                  x1={LEFT_PAD}
                  y1={yLine}
                  x2={LEFT_PAD + GRID_WIDTH}
                  y2={yLine}
                  className="guitar-fret-line"
                />
                <text
                  x={LEFT_PAD - 14}
                  y={yText}
                  textAnchor="end"
                  fontSize="11"
                  fontWeight="600"
                  className="guitar-fret-label"
                >
                  {fretNum}ª
                </text>
              </g>
            );
          })}

          {/* Vertical string lines */}
          {voicing.strings.map(s => {
            const x = stringX(s.stringNumber);
            return (
              <line
                key={`line-${s.stringNumber}`}
                x1={x}
                y1={TOP_PAD}
                x2={x}
                y2={TOP_PAD + GRID_HEIGHT}
                className={`guitar-string-line ${s.status === 'muted' ? 'is-muted' : ''}`}
              />
            );
          })}

          {/* Barres (Pestanas) */}
          {voicing.barres.map((barre, idx) => {
            const xFrom = stringX(barre.fromString);
            const xTo = stringX(barre.toString);
            const minX = Math.min(xFrom, xTo) - 12;
            const width = Math.abs(xTo - xFrom) + 24;
            const y = fretCenterY(barre.fret) - 11;
            return (
              <g
                key={`barre-${idx}`}
                data-testid={`chord-guitar-barre-${barre.fret}`}
                data-barre-fret={barre.fret}
                data-barre-from={barre.fromString}
                data-barre-to={barre.toString}
                data-barre-finger={barre.finger}
              >
                <rect
                  x={minX}
                  y={y}
                  width={width}
                  height={22}
                  rx={11}
                  ry={11}
                  className="guitar-barre-pill"
                />
                <text
                  x={(xFrom + xTo) / 2}
                  y={y + 15}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="bold"
                  className="guitar-barre-text"
                >
                  Pestana • {barre.finger}
                </text>
              </g>
            );
          })}

          {/* Strings markers, fretted dots, and bottom labels */}
          {voicing.strings.map(s => {
            const x = stringX(s.stringNumber);
            const openLabel = STANDARD_OPEN_LABELS[s.stringNumber] ?? `${s.stringNumber}ª`;
            const { role } = describeStringRole(s, voicing, parsed);
            const isBarreCovered =
              s.status === 'fretted' &&
              s.fret !== null &&
              s.finger !== null &&
              barreCoveredKeys.has(`${s.stringNumber}:${s.fret}:${s.finger}`);

            return (
              <g
                key={`string-${s.stringNumber}`}
                data-string-number={s.stringNumber}
                data-string-status={s.status}
                data-string-fret={s.fret !== null ? String(s.fret) : ''}
                data-string-finger={s.finger !== null ? String(s.finger) : ''}
                data-string-note={s.note ?? ''}
                data-string-spelling={s.spelling ?? ''}
                data-string-role={role}
              >
                {/* Open string number at very top */}
                <text
                  x={x}
                  y={14}
                  textAnchor="middle"
                  fontSize="10"
                  fontWeight="600"
                  className="guitar-tuning-label"
                >
                  {openLabel}
                </text>

                {/* Muted X or Open O indicator above nut */}
                {s.status === 'muted' && (
                  <text
                    x={x}
                    y={TOP_PAD - 10}
                    textAnchor="middle"
                    fontSize="14"
                    fontWeight="bold"
                    className="guitar-muted-marker"
                  >
                    X
                  </text>
                )}
                {s.status === 'open' && (
                  <circle
                    cx={x}
                    cy={TOP_PAD - 14}
                    r={6}
                    className={`guitar-open-circle ${role}`}
                  />
                )}

                {/* Fretted dot (skip individual circle if covered by barre pill) */}
                {s.status === 'fretted' && s.fret !== null && !isBarreCovered && (
                  <>
                    <circle
                      cx={x}
                      cy={fretCenterY(s.fret)}
                      r={12}
                      className={`guitar-fretted-dot ${role}`}
                    />
                    <text
                      x={x}
                      y={fretCenterY(s.fret) + 4}
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight="bold"
                      className="guitar-finger-text"
                    >
                      {s.finger}
                    </text>
                  </>
                )}

                {/* Produced note label at bottom */}
                <text
                  x={x}
                  y={TOP_PAD + GRID_HEIGHT + 22}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight={s.status === 'muted' ? '400' : '700'}
                  className={`guitar-note-label ${role}`}
                >
                  {s.note ?? '—'}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="chord-guitar-legend-block">
        <strong style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          Legenda corda a corda (6ª para 1ª):
        </strong>
        <ul className="chord-guitar-legend-list" data-testid="chord-guitar-accessible-legend">
          {voicing.strings.map(s => (
            <li
              key={s.stringNumber}
              data-testid={`guitar-legend-string-${s.stringNumber}`}
            >
              {describeGuitarStringLegend(s, voicing, parsed)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default ChordGuitarDiagram;

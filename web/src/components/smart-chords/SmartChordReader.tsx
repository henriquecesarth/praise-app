import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { CHORD_FONT_FAMILIES, getFontFamilyCss, hasBarProgression, isTablatureLine, parseBarProgressionLine, rawToVisual, transposeChord } from '../../utils/smart_chord';

export interface SmartChordEditTarget {
  lineIdx: number;
  charIdx?: number;
  barChordIdx?: number;
}

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
}

/** Controlled reading surface; document edits and preference persistence stay in the workspace. */
export function SmartChordReader({ title, selectedArtistName, originalKey, currentKeyTransposed, content, semitones, sheetFontFamily, printFontSize, pdfFontSize, chordLineSpacingPx, editingCell, setEditingCell, setEditingChordValue, setSemitones, setPrintFontSize, handleChordLineSpacingChange, handleFontFamilyChange, renderInlineEditor }: Props) {
  const rawLines = content ? content.split('\n') : [];
  const activeFontFamilyCss = getFontFamilyCss(sheetFontFamily);
  return (
    <div className="glass-panel printable-area-container" style={{ flex: 1.2, minWidth: '300px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto' }}>
      {/* Pitch shifter & Font Size control panel com Touch Targets 44x44px */}
      <div className="no-print smart-chords-reading-tools" aria-label="Ferramentas de leitura" style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderRadius: '12px', backgroundColor: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.85rem', opacity: 0.7 }}>Tom Original:</span>
            <strong style={{ color: 'var(--primary-light)', fontSize: '0.95rem' }}>{originalKey}</strong>
            <span style={{ fontSize: '0.85rem', opacity: 0.7, marginLeft: '12px' }}>Tom Atual:</span>
            <strong style={{ color: 'var(--secondary-light)', fontSize: '0.95rem' }}>{currentKeyTransposed}</strong>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button type="button" aria-label="Transpor um semitom abaixo" className="btn btn-secondary smart-chords-touch-btn" style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', padding: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '1.1rem', fontWeight: 700, borderRadius: '8px' }} onClick={() => setSemitones(prev => prev - 1)}>
              -
            </button>
            <span style={{ fontSize: '0.95rem', width: '32px', textAlign: 'center', fontWeight: 700 }}>
              {semitones > 0 ? `+${semitones}` : semitones}
            </span>
            <button type="button" aria-label="Transpor um semitom acima" className="btn btn-secondary smart-chords-touch-btn" style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', padding: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '1.1rem', fontWeight: 700, borderRadius: '8px' }} onClick={() => setSemitones(prev => prev + 1)}>
              +
            </button>
            {semitones !== 0 && (
              <button className="btn btn-link" style={{ minHeight: '44px', fontSize: '0.8rem', color: 'var(--text-secondary)', padding: '0 8px' }} onClick={() => setSemitones(0)}>
                Reset
              </button>
            )}
          </div>
        </div>

        <details className="smart-chords-reading-options"><summary>Aparência da leitura</summary><div className="smart-chords-reading-options-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 1fr) auto auto', alignItems: 'center', gap: '8px', flex: '1 1 260px', minWidth: 0 }}>
          <label htmlFor="reading-line-spacing" style={{ fontSize: '0.85rem', opacity: 0.85 }}>Espaçamento entre linhas</label>
          <button type="button" aria-label="Diminuir espaçamento entre linhas" className="btn btn-secondary smart-chords-touch-btn" disabled={chordLineSpacingPx <= 0} style={{ width: '44px', height: '44px', minWidth: '44px', padding: 0 }} onClick={() => void handleChordLineSpacingChange(chordLineSpacingPx - 2)}>−</button>
          <strong data-testid="reading-line-spacing-value">{chordLineSpacingPx}px</strong>
          <input id="reading-line-spacing" data-testid="reading-line-spacing" aria-label="Espaçamento entre linhas" type="range" min="0" max="24" step="2" value={chordLineSpacingPx} onChange={event => void handleChordLineSpacingChange(Number(event.target.value))} style={{ gridColumn: '1 / 2', width: '100%' }} />
          <button type="button" aria-label="Aumentar espaçamento entre linhas" className="btn btn-secondary smart-chords-touch-btn" disabled={chordLineSpacingPx >= 24} style={{ width: '44px', height: '44px', minWidth: '44px', padding: 0 }} onClick={() => void handleChordLineSpacingChange(chordLineSpacingPx + 2)}>+</button>
          <button type="button" className="btn btn-link" aria-label="Restaurar espaçamento padrão" onClick={() => void handleChordLineSpacingChange(0)} disabled={chordLineSpacingPx === 0} style={{ minHeight: '44px' }}>Padrão</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.85rem', opacity: 0.7 }}>Fonte:</span>
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
              backgroundColor: 'var(--surface-variant)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              cursor: 'pointer'
            }}
          >
            {CHORD_FONT_FAMILIES.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.85rem', opacity: 0.7 }}>Tamanho da Fonte:</span>
          <button type="button" aria-label="Diminuir tamanho da fonte" className="btn btn-secondary smart-chords-touch-btn" style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', padding: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '1.1rem', fontWeight: 700, borderRadius: '8px' }} onClick={() => setPrintFontSize(prev => Math.max(10, prev - 1))}>
            -
          </button>
          <span style={{ fontSize: '0.9rem', width: '40px', textAlign: 'center', fontWeight: 'bold' }}>
            {printFontSize}px
          </span>
          <button type="button" aria-label="Aumentar tamanho da fonte" className="btn btn-secondary smart-chords-touch-btn" style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', padding: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '1.1rem', fontWeight: 700, borderRadius: '8px' }} onClick={() => setPrintFontSize(prev => Math.min(24, prev + 1))}>
            +
          </button>
        </div>
        </div></details>
      </div>


      {/* Rendered sheet box (will be fully printable and contain header) */}
      <div className="print-sheet-box smart-chords-reading-sheet" style={{ flex: 1, padding: '20px', borderRadius: '12px', backgroundColor: 'var(--surface-variant)', border: '1px solid var(--border)', overflowX: 'auto', fontFamily: activeFontFamilyCss }}>

        {/* Print/Visual header inside the sheet container */}
        <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '12px', marginBottom: '20px' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 4px 0', fontFamily: activeFontFamilyCss }}>{title || 'Nova Cifra'}</h2>
          <div style={{ fontSize: '0.85rem', opacity: 0.7, display: 'flex', gap: '20px', flexWrap: 'wrap', fontFamily: activeFontFamilyCss }}>
            <span><strong>Artista:</strong> {selectedArtistName}</span>
            <span><strong>Tom:</strong> {currentKeyTransposed}</span>
          </div>
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
                    paddingTop: `${printFontSize + 3}px`
                  }}
                >
                  {tokens.map((token, tokenIdx) => {
                    if (token.type === 'chord') {
                      const isEditing = editingCell && editingCell.lineIdx === lineIdx && editingCell.barChordIdx === token.chordIndex;
                      const transposedChord = transposeChord(token.value, semitones);
                      return (
                        <div
                          key={tokenIdx}
                          role="button" tabIndex={0} aria-label={`Editar acorde ${transposedChord}`}
                          onKeyDown={event => { if (event.target !== event.currentTarget) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setEditingCell({ lineIdx, barChordIdx: token.chordIndex }); setEditingChordValue(token.value); } }}
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
                            minHeight: '28px'
                          }}
                        >
                          {isEditing ? (
                            renderInlineEditor(lineIdx, undefined, token.chordIndex)
                          ) : (
                            <span
                              className="has-chord"
                              data-bar-chord-idx={token.chordIndex}
                              style={{
                                color: 'var(--primary-light)',
                                fontWeight: 'bold',
                                textDecoration: 'underline 2px solid var(--primary-light)',
                                padding: '0 1px'
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
                            color: token.value === '%' ? 'var(--primary-light)' : 'var(--text-secondary)',
                            fontWeight: 'bold',
                            userSelect: 'none'
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
                  role="button" tabIndex={0} aria-label={`Inserir acorde na linha vazia ${lineIdx + 1}`}
                  onKeyDown={event => { if (event.target !== event.currentTarget) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setEditingCell({ lineIdx, charIdx: 0 }); setEditingChordValue(''); } }}
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
                    border: '1px dashed var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    opacity: 0.5,
                    position: 'relative'
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
                  paddingTop: `${printFontSize + 3}px` // Space for absolute chords
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
                      role="button" tabIndex={0} aria-label={`Editar acorde na linha ${lineIdx + 1}, posição ${charIdx + 1}`}
                      onKeyDown={event => { if (event.target !== event.currentTarget) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setEditingCell({ lineIdx, charIdx }); setEditingChordValue(chord); } }}
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
                        userSelect: 'none'
                      }}
                    >
                      {/* Inline Input Editor */}
                      {isEditing ? (
                        renderInlineEditor(lineIdx, charIdx)
                      ) : (
                        /* Chord absolute positioned */
                        hasChord && (
                          <span
                            aria-hidden="true"
                            className="print-chord-span"
                            style={{
                              position: 'absolute',
                              bottom: '100%',
                              left: 0,
                              color: 'var(--primary-light)',
                              fontWeight: 'bold',
                              fontSize: `${Math.round(printFontSize * 0.9)}px`,
                              whiteSpace: 'nowrap',
                              padding: '0 1px'
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
                          textDecoration: hasChord ? 'underline 2px solid var(--primary-light)' : 'none',
                          color: 'var(--text-primary)'
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
                      role="button" tabIndex={0} aria-label={`Inserir acorde ao final da linha ${lineIdx + 1}`}
                      onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.currentTarget.click(); } }}
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
                        marginLeft: '4px'
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
                              color: 'var(--primary-light)',
                              fontWeight: 'bold',
                              fontSize: `${Math.round(printFontSize * 0.9)}px`,
                              whiteSpace: 'nowrap',
                              padding: '0 1px'
                            }}
                          >
                            {transposeChord(extraChord, semitones)}
                          </span>
                        )
                      )}
                      <span className="smart-chords-insert-hint" aria-hidden="true" style={{ fontSize: `${Math.round(printFontSize * 0.8)}px`, color: 'var(--text-tertiary)', opacity: 0.6 }}>
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

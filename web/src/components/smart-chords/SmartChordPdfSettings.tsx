import React, { useEffect, useRef } from 'react';
import { CHORD_FONT_FAMILIES } from '../../utils/smart_chord';
interface Props {
 open: boolean; dirty: boolean; onClose: () => void; onGenerate: () => void;
 pdfFontFamily: string; handlePdfFontFamilyChange: (value: string) => void;
 pdfFontSize: number; setPdfFontSize: React.Dispatch<React.SetStateAction<number>>;
 chordLineSpacingPx: number; handleChordLineSpacingChange: (value: number) => Promise<void>;
 pdfCustomMarker: string; handlePdfCustomMarkerChange: (value: string) => void;
}

export function SmartChordPdfSettings({ open, dirty, onClose, onGenerate, pdfFontFamily, handlePdfFontFamilyChange, pdfFontSize, setPdfFontSize, chordLineSpacingPx, handleChordLineSpacingChange, pdfCustomMarker, handlePdfCustomMarkerChange }: Props) {
 const dialog = useRef<HTMLDivElement>(null);
 useEffect(() => {
   if (!open) return;
   const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
   dialog.current?.querySelector<HTMLElement>('select')?.focus();
   return () => { if (opener?.isConnected) opener.focus(); };
 }, [open]);
 return <div hidden={!open} className="smart-chords-settings-backdrop" onKeyDown={event => {
   if (event.key === 'Escape') { event.preventDefault(); onClose(); }
   if (event.key === 'Tab') {
     const nodes = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select, input') || []);
     const first = nodes[0]; const last = nodes[nodes.length - 1];
     if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
     else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
   }
 }}><div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="pdf-settings-title" className="smart-chords-settings-dialog">
 <h2 id="pdf-settings-title">Exportar PDF</h2>
 <p>{dirty ? 'O PDF usa as altera\u00e7\u00f5es atuais do editor, mesmo sem salvar a cifra.' : 'Configure a exporta\u00e7\u00e3o antes de gerar o documento.'}</p>
 <p>O espaçamento é compartilhado com a leitura. Fonte, tamanho e marcador são exclusivos do PDF.</p>
                <div
                  hidden={!open}
                  id="pdf-settings-panel"
                  data-testid="pdf-settings-panel"
                  className="no-print"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    padding: '14px 16px',
                    borderRadius: '12px',
                    backgroundColor: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid var(--border-color)'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>Configurações do PDF</strong>
                    <span style={{ fontSize: '0.8rem', opacity: 0.65 }}>Fonte, tamanho e marcador exclusivos do PDF. Espaçamento compartilhado com a leitura.</span>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center' }}>
                    {/* Fonte do PDF */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <label htmlFor="modal-font-family-select" style={{ fontSize: '0.85rem', opacity: 0.7, whiteSpace: 'nowrap' }}>
                        Fonte do PDF:
                      </label>
                      <select
                        id="modal-font-family-select"
                        data-testid="modal-font-family-select"
                        aria-label="Selecionar fonte do PDF"
                        className="form-control"
                        value={pdfFontFamily}
                        onChange={(e) => handlePdfFontFamilyChange(e.target.value)}
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

                    {/* Tamanho da letra no PDF */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '0.85rem', opacity: 0.7, whiteSpace: 'nowrap' }}>Tamanho no PDF:</span>
                      <button
                        type="button"
                        aria-label="Diminuir tamanho da letra no PDF"
                        data-testid="modal-font-size-decrease"
                        className="btn btn-secondary smart-chords-touch-btn"
                        disabled={pdfFontSize <= 10}
                        style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', padding: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '1.1rem', fontWeight: 700, borderRadius: '8px' }}
                        onClick={() => setPdfFontSize(prev => Math.max(10, prev - 1))}
                      >
                        -
                      </button>
                      <span data-testid="modal-font-size-value" style={{ fontSize: '0.85rem', width: '36px', textAlign: 'center', fontWeight: 'bold' }}>
                        {pdfFontSize}px
                      </span>
                      <button
                        type="button"
                        aria-label="Aumentar tamanho da letra no PDF"
                        data-testid="modal-font-size-increase"
                        className="btn btn-secondary smart-chords-touch-btn"
                        disabled={pdfFontSize >= 24}
                        style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', padding: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '1.1rem', fontWeight: 700, borderRadius: '8px' }}
                        onClick={() => setPdfFontSize(prev => Math.min(24, prev + 1))}
                      >
                        +
                      </button>
                    </div>

                    {/* Espaçamento entre linhas */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '0.85rem', opacity: 0.7, whiteSpace: 'nowrap' }}>Espaçamento:</span>
                      <button
                        type="button"
                        aria-label="Diminuir espaçamento entre linhas no PDF"
                        data-testid="modal-spacing-decrease"
                        className="btn btn-secondary smart-chords-touch-btn"
                        disabled={chordLineSpacingPx <= 0}
                        style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', padding: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '1.1rem', fontWeight: 700, borderRadius: '8px' }}
                        onClick={() => void handleChordLineSpacingChange(chordLineSpacingPx - 2)}
                      >
                        -
                      </button>
                      <span data-testid="modal-line-spacing-value" style={{ fontSize: '0.85rem', width: '36px', textAlign: 'center', fontWeight: 'bold' }}>
                        {chordLineSpacingPx}px
                      </span>
                      <button
                        type="button"
                        aria-label="Aumentar espaçamento entre linhas no PDF"
                        data-testid="modal-spacing-increase"
                        className="btn btn-secondary smart-chords-touch-btn"
                        disabled={chordLineSpacingPx >= 24}
                        style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', padding: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '1.1rem', fontWeight: 700, borderRadius: '8px' }}
                        onClick={() => void handleChordLineSpacingChange(chordLineSpacingPx + 2)}
                      >
                        +
                      </button>
                    </div>

                    {/* Marcador do PDF */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1 1 240px', minWidth: '220px' }}>
                      <label htmlFor="modal-pdf-marker-input" style={{ fontSize: '0.85rem', opacity: 0.7, whiteSpace: 'nowrap' }}>
                        Marcador (opcional):
                      </label>
                      <input
                        id="modal-pdf-marker-input"
                        data-testid="modal-pdf-marker-input"
                        type="text"
                        placeholder="Ex.: Min. Infantil IBBP"
                        aria-label="Marcador do PDF"
                        value={pdfCustomMarker}
                        onChange={(e) => handlePdfCustomMarkerChange(e.target.value)}
                        style={{
                          minHeight: '44px',
                          padding: '6px 12px',
                          fontSize: '0.85rem',
                          backgroundColor: 'var(--surface-variant)',
                          color: 'var(--text-primary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '8px',
                          flex: 1,
                          minWidth: '140px',
                          width: '100%'
                        }}
                      />
                    </div>
                  </div>
                </div>
 <footer><button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button><button type="button" className="btn btn-primary" onClick={onGenerate}>Gerar e visualizar PDF</button></footer>
 </div></div>;
}

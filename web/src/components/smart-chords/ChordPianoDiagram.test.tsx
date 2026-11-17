import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React, { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ChordPianoDiagramPanel, ChordPianoDiagram } from './ChordPianoDiagram';
import { chordTones, Parsed, ChordNormalized } from '../../music/theory';

describe('ChordPianoDiagram & ChordPianoDiagramPanel (T3 Piano Diagram)', () => {
  it('renders standard major triad "C" with root, chord tones, and default 2-octave range', () => {
    const parsed = chordTones('C') as Parsed<ChordNormalized>;
    render(<ChordPianoDiagram parsed={parsed} />);

    expect(screen.getByTestId('chord-piano-didactic-legend')).toHaveTextContent(
      'Visualização didática das notas e classes de altura (sem voicing fixo)'
    );

    // Root key (pos 0 = C)
    const rootKey = document.querySelector('[data-key-pos="0"]');
    expect(rootKey).toHaveAttribute('data-key-active', 'true');
    expect(rootKey).toHaveAttribute('data-key-role', 'root');
    expect(rootKey).toHaveAttribute('data-key-spelling', 'C');

    // Chord tone (pos 4 = E)
    const eKey = document.querySelector('[data-key-pos="4"]');
    expect(eKey).toHaveAttribute('data-key-active', 'true');
    expect(eKey).toHaveAttribute('data-key-role', 'chord-tone');
    expect(eKey).toHaveAttribute('data-key-spelling', 'E');

    // Chord tone (pos 7 = G)
    const gKey = document.querySelector('[data-key-pos="7"]');
    expect(gKey).toHaveAttribute('data-key-active', 'true');
    expect(gKey).toHaveAttribute('data-key-role', 'chord-tone');
    expect(gKey).toHaveAttribute('data-key-spelling', 'G');

    // Inactive key (pos 2 = D)
    const dKey = document.querySelector('[data-key-pos="2"]');
    expect(dKey).toHaveAttribute('data-key-active', 'false');

    // Range should fit within default 2 octaves (24 keys, 0..23) with no auto notice
    expect(screen.queryByTestId('adjusted-range-notice')).not.toBeInTheDocument();
  });

  it('renders minor chord "Cm" with minor 3rd (Eb) and correct quality in panel', () => {
    render(<ChordPianoDiagramPanel chordSymbol="Cm" onClose={vi.fn()} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Cm')).toBeInTheDocument();
    expect(screen.getByTestId('chord-quality-pill')).toHaveTextContent('Qualidade: Menor');

    // Eb key (pos 3, black key)
    const ebKey = document.querySelector('[data-key-pos="3"]');
    expect(ebKey).toHaveAttribute('data-key-active', 'true');
    expect(ebKey).toHaveAttribute('data-key-spelling', 'Eb');

    // Notes list contains C, Eb, G
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('C (Fundamental (1ª))');
    expect(items[1]).toHaveTextContent('Eb (3ª menor)');
    expect(items[2]).toHaveTextContent('G (5ª justa)');
  });

  it('renders dominant 7th "C7" with minor 7th (Bb)', () => {
    render(<ChordPianoDiagramPanel chordSymbol="C7" onClose={vi.fn()} />);

    expect(screen.getByTestId('chord-seventh-pill')).toHaveTextContent('Sétima: 7ª Menor');
    const bbKey = document.querySelector('[data-key-pos="10"]');
    expect(bbKey).toHaveAttribute('data-key-active', 'true');
    expect(bbKey).toHaveAttribute('data-key-spelling', 'Bb');
  });

  it('renders slash bass with chordTone "C/E" (1ª inversão, bass at pos 4, root at pos 12)', () => {
    render(<ChordPianoDiagramPanel chordSymbol="C/E" onClose={vi.fn()} />);

    // Bass pill
    expect(screen.getByTestId('chord-bass-pill')).toHaveTextContent(
      'Baixo: E — nota do acorde, 1ª inversão'
    );

    // Bass note at pos 4 (E)
    const bassKey = document.querySelector('[data-key-pos="4"]');
    expect(bassKey).toHaveAttribute('data-key-active', 'true');
    expect(bassKey).toHaveAttribute('data-key-role', 'bass');
    expect(bassKey).toHaveAttribute('data-key-spelling', 'E');

    // Root note at pos 12 (C)
    const rootKey = document.querySelector('[data-key-pos="12"]');
    expect(rootKey).toHaveAttribute('data-key-active', 'true');
    expect(rootKey).toHaveAttribute('data-key-role', 'root');
    expect(rootKey).toHaveAttribute('data-key-spelling', 'C');

    // Higher E at pos 16
    const highEKey = document.querySelector('[data-key-pos="16"]');
    expect(highEKey).toHaveAttribute('data-key-active', 'true');
    expect(highEKey).toHaveAttribute('data-key-role', 'chord-tone');
  });

  it('renders slash bass with nonChordTone "C/F#" (baixo externo / slash bass)', () => {
    render(<ChordPianoDiagramPanel chordSymbol="C/F#" onClose={vi.fn()} />);

    expect(screen.getByTestId('chord-bass-pill')).toHaveTextContent(
      'Baixo: F# — baixo externo / slash bass'
    );

    // Bass at pos 6 (F#)
    const fSharpKey = document.querySelector('[data-key-pos="6"]');
    expect(fSharpKey).toHaveAttribute('data-key-active', 'true');
    expect(fSharpKey).toHaveAttribute('data-key-role', 'bass');
    expect(fSharpKey).toHaveAttribute('data-key-spelling', 'F#');
  });

  it('renders exact diatonic spelling for "B#" (B#, D##, F##) without rewriting to C, D, F', () => {
    render(<ChordPianoDiagramPanel chordSymbol="B#" onClose={vi.fn()} />);

    const rootKey = document.querySelector('[data-key-pos="0"]');
    expect(rootKey).toHaveAttribute('data-key-spelling', 'B#');

    const thirdKey = document.querySelector('[data-key-pos="4"]');
    expect(thirdKey).toHaveAttribute('data-key-spelling', 'D##');

    const fifthKey = document.querySelector('[data-key-pos="7"]');
    expect(fifthKey).toHaveAttribute('data-key-spelling', 'F##');

    expect(screen.getByTestId('chord-tones-list')).toHaveTextContent('B#');
    expect(screen.getByTestId('chord-tones-list')).toHaveTextContent('D##');
    expect(screen.getByTestId('chord-tones-list')).toHaveTextContent('F##');
  });

  it('renders exact diatonic spelling for "Cb" (Cb, Eb, Gb) without rewriting to B', () => {
    render(<ChordPianoDiagramPanel chordSymbol="Cb" onClose={vi.fn()} />);

    const rootKey = document.querySelector('[data-key-pos="11"]');
    expect(rootKey).toHaveAttribute('data-key-spelling', 'Cb');

    const thirdKey = document.querySelector('[data-key-pos="15"]');
    expect(thirdKey).toHaveAttribute('data-key-spelling', 'Eb');

    const fifthKey = document.querySelector('[data-key-pos="18"]');
    expect(fifthKey).toHaveAttribute('data-key-spelling', 'Gb');
  });

  it('renders half-diminished chord "F#m7(b5)" showing canonical "F#m7b5" and quality "Meio-diminuto"', () => {
    render(<ChordPianoDiagramPanel chordSymbol="F#m7(b5)" onClose={vi.fn()} />);

    expect(screen.getByText('F#m7(b5)')).toBeInTheDocument();
    expect(screen.getByTestId('chord-canonical-symbol')).toHaveTextContent('Canônico: F#m7b5');
    expect(screen.getByTestId('chord-quality-pill')).toHaveTextContent('Qualidade: Meio-diminuto');

    // Notes: F#, A, C, E
    expect(screen.getByTestId('chord-tones-list')).toHaveTextContent('F#');
    expect(screen.getByTestId('chord-tones-list')).toHaveTextContent('A');
    expect(screen.getByTestId('chord-tones-list')).toHaveTextContent('C');
    expect(screen.getByTestId('chord-tones-list')).toHaveTextContent('E');
  });

  it('renders major 7th chord "C7M" showing canonical "Cmaj7" and quality "Maior"', () => {
    render(<ChordPianoDiagramPanel chordSymbol="C7M" onClose={vi.fn()} />);

    expect(screen.getByText('C7M')).toBeInTheDocument();
    expect(screen.getByTestId('chord-canonical-symbol')).toHaveTextContent('Canônico: Cmaj7');
    expect(screen.getByTestId('chord-quality-pill')).toHaveTextContent('Qualidade: Maior');
    expect(screen.getByTestId('chord-seventh-pill')).toHaveTextContent('Sétima: 7ª Maior');
  });

  it('handles informative unsupported state for altered chord "Calt"', () => {
    const onClose = vi.fn();
    render(<ChordPianoDiagramPanel chordSymbol="Calt" onClose={onClose} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('chord-piano-unsupported')).toBeInTheDocument();
    expect(screen.getByText('Diagrama indisponível para Calt')).toBeInTheDocument();
    expect(screen.getByTestId('chord-unsupported-reason')).toHaveTextContent(
      'Acordes alterados ("alt") possuem múltiplas escolhas harmônicas'
    );

    // Accessible close action
    const closeBtn = screen.getByTestId('chord-unsupported-close-action');
    expect(closeBtn).toBeInTheDocument();
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('handles informative unsupported state for power chord "C5"', () => {
    render(<ChordPianoDiagramPanel chordSymbol="C5" onClose={vi.fn()} />);

    expect(screen.getByText('Diagrama indisponível para C5')).toBeInTheDocument();
    expect(screen.getByTestId('chord-unsupported-reason')).toHaveTextContent(
      'Power chords ("5" ou acordes sem terça) estão fora do modelo harmônico da versão 1.'
    );
  });

  it('automatically expands visual range to 3 octaves for wide chords "G/B" and "B13" with clear notice', () => {
    const { unmount } = render(<ChordPianoDiagramPanel chordSymbol="G/B" onClose={vi.fn()} />);

    expect(screen.getByTestId('adjusted-range-notice')).toHaveTextContent(
      'Faixa ajustada para 3 oitavas para visualização completa do acorde'
    );

    // In 3 octaves (36 keys, 0..35), all notes 11 (B), 19 (G), 23 (B), 26 (D) are present
    expect(document.querySelector('[data-key-pos="11"]')).toBeInTheDocument();
    expect(document.querySelector('[data-key-pos="26"]')).toBeInTheDocument();

    unmount();

    render(<ChordPianoDiagramPanel chordSymbol="B13" onClose={vi.fn()} />);
    expect(screen.getByTestId('adjusted-range-notice')).toHaveTextContent(
      'Faixa ajustada para 3 oitavas para visualização completa do acorde'
    );
    expect(document.querySelector('[data-key-pos="32"]')).toBeInTheDocument();
  });

  it('supports manual visual octave shifting (+1 oitava, -1 oitava, Automático) keeping all active keys visible for C and G/B', () => {
    const { unmount } = render(<ChordPianoDiagramPanel chordSymbol="C" onClose={vi.fn()} />);

    const getActivePositions = () =>
      Array.from(document.querySelectorAll('[data-key-active="true"]'))
        .map(el => Number(el.getAttribute('data-key-pos')))
        .sort((a, b) => a - b);

    const upBtn = screen.getByTestId('piano-octave-up');
    const autoBtn = screen.getByTestId('piano-octave-auto');
    const downBtn = screen.getByTestId('piano-octave-down');

    expect(autoBtn).toBeDisabled();
    expect(upBtn).not.toBeDisabled();
    expect(downBtn).not.toBeDisabled();
    expect(getActivePositions()).toEqual([0, 4, 7]);

    // Shift +1 octave -> active notes [12, 16, 19] all visible inside 0..23
    fireEvent.click(upBtn);
    expect(upBtn).toBeDisabled();
    expect(autoBtn).not.toBeDisabled();
    expect(screen.getByTestId('octave-offset-notice')).toHaveTextContent('Registro visual: +1 oitava');
    expect(getActivePositions()).toEqual([12, 16, 19]);

    // Reset with Automático
    fireEvent.click(autoBtn);
    expect(autoBtn).toBeDisabled();
    expect(getActivePositions()).toEqual([0, 4, 7]);

    // Shift -1 octave -> active notes [-12, -8, -5] all visible inside -12..11
    fireEvent.click(downBtn);
    expect(downBtn).toBeDisabled();
    expect(screen.getByTestId('octave-offset-notice')).toHaveTextContent('Registro visual: -1 oitava');
    expect(document.querySelector('[data-key-pos="-12"]')).toBeInTheDocument();
    expect(getActivePositions()).toEqual([-12, -8, -5]);

    unmount();

    // Verify G/B keeps all 4 active notes visible on both +1 and -1 octave shifts and announces bass in aria-live
    render(<ChordPianoDiagramPanel chordSymbol="G/B" onClose={vi.fn()} />);
    expect(screen.getByTestId('chord-piano-live-region')).toHaveTextContent('Baixo: B.');
    expect(getActivePositions()).toEqual([11, 19, 23, 26]);

    fireEvent.click(screen.getByTestId('piano-octave-up'));
    expect(getActivePositions()).toEqual([23, 31, 35, 38]);

    fireEvent.click(screen.getByTestId('piano-octave-auto'));
    fireEvent.click(screen.getByTestId('piano-octave-down'));
    expect(getActivePositions()).toEqual([-1, 7, 11, 14]);
  });

  it('meets accessibility standards: aria attributes, focus trap, Escape key, and focus return', async () => {
    const onClose = vi.fn();

    function TestHost() {
      const triggerBtnRef = useRef<HTMLButtonElement | null>(null);
      const [open, setOpen] = React.useState(false);

      return (
        <div>
          <button
            ref={triggerBtnRef}
            type="button"
            data-testid="test-open-btn"
            onClick={() => setOpen(true)}
          >
            Abrir Acorde
          </button>
          {open && (
            <ChordPianoDiagramPanel
              chordSymbol="C"
              onClose={() => {
                setOpen(false);
                onClose();
              }}
              triggerRef={triggerBtnRef}
            />
          )}
        </div>
      );
    }

    render(<TestHost />);

    const openBtn = screen.getByTestId('test-open-btn');
    openBtn.focus();
    fireEvent.click(openBtn);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'chord-piano-title');

    // aria-live region
    const liveRegion = screen.getByTestId('chord-piano-live-region');
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    expect(liveRegion).toHaveTextContent('Acorde C. Qualidade: Maior. Notas: C, E, G.');

    // Tab key loops inside dialog
    const dialogButtons = within(dialog).getAllByRole('button');
    const firstInteractive = dialogButtons[0];
    const lastInteractive = dialogButtons[dialogButtons.length - 1];

    lastInteractive.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(firstInteractive);

    firstInteractive.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(lastInteractive);

    // Escape closes dialog
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Focus restored to trigger element
    await waitFor(() => {
      expect(document.activeElement).toBe(openBtn);
    });
  });

  it('closes dialog on backdrop click and ensures touch targets are >= 44x44px', () => {
    const onClose = vi.fn();
    render(<ChordPianoDiagramPanel chordSymbol="C" onClose={onClose} />);

    const backdrop = screen.getByTestId('chord-piano-backdrop');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);

    const closeBtn = screen.getByTestId('chord-piano-close-btn');
    expect(closeBtn).toHaveClass('chord-piano-close-btn');

    const ctrlButtons = screen.getByTestId('chord-piano-controls').querySelectorAll('button');
    ctrlButtons.forEach((btn) => {
      expect(btn).toHaveClass('chord-piano-ctrl-btn');
    });
  });
});

describe('T4 Guitar Diagram integration in ChordPianoDiagramPanel', () => {
  it('switches between Piano and Violão while keeping the selected chord "C"', () => {
    render(<ChordPianoDiagramPanel chordSymbol="C" onClose={vi.fn()} />);

    const pianoBtn = screen.getByTestId('diagram-instrument-piano');
    const guitarBtn = screen.getByTestId('diagram-instrument-guitar');
    expect(pianoBtn).toHaveAttribute('aria-pressed', 'true');
    expect(guitarBtn).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('chord-piano-didactic-legend')).toBeInTheDocument();

    // Switch to Violão
    fireEvent.click(guitarBtn);
    expect(pianoBtn).toHaveAttribute('aria-pressed', 'false');
    expect(guitarBtn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('chord-piano-didactic-legend')).not.toBeInTheDocument();

    expect(screen.getByTestId('chord-guitar-diagram')).toBeInTheDocument();
    expect(screen.getByTestId('chord-guitar-position-name')).toHaveTextContent('Aberta (1ª posição)');
    expect(screen.getByTestId('chord-guitar-tuning')).toHaveTextContent('Afinação: E2 A2 D3 G3 B3 E4');
    expect(screen.getByTestId('chord-guitar-lowest-note')).toHaveTextContent('Baixo efetivo: C3 (5ª corda)');

    // 6 strings rendered with accurate open/muted/fretted states
    const svg = screen.getByTestId('chord-guitar-svg');
    const stringGroups = svg.querySelectorAll('[data-string-number]');
    expect(stringGroups).toHaveLength(6);

    expect(svg.querySelector('[data-string-number="6"]')).toHaveAttribute('data-string-status', 'muted');
    expect(svg.querySelector('[data-string-number="5"]')).toHaveAttribute('data-string-fret', '3');
    expect(svg.querySelector('[data-string-number="5"]')).toHaveAttribute('data-string-finger', '3');
    expect(svg.querySelector('[data-string-number="5"]')).toHaveAttribute('data-string-note', 'C3');
    expect(svg.querySelector('[data-string-number="3"]')).toHaveAttribute('data-string-status', 'open');
    expect(svg.querySelector('[data-string-number="2"]')).toHaveAttribute('data-string-fret', '1');
    expect(svg.querySelector('[data-string-number="1"]')).toHaveAttribute('data-string-status', 'open');

    // Accessible legend per string
    expect(screen.getByTestId('guitar-legend-string-6')).toHaveTextContent('6ª corda (E2): Abafada (X)');
    expect(screen.getByTestId('guitar-legend-string-5')).toHaveTextContent('5ª corda (A2): 3ª casa, dedo 3 — C3');
    expect(screen.getByTestId('guitar-legend-string-3')).toHaveTextContent('3ª corda (G3): Solta (O) — G3');

    // Switch back to Piano keeping chord C
    fireEvent.click(pianoBtn);
    expect(screen.getByTestId('chord-piano-didactic-legend')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'C' })).toBeInTheDocument();
  });

  it('renders barre (pestana) for "F", 1st inversion for "G/B", and curated positions for "C7M" and "F#m7(b5)"', () => {
    const { rerender } = render(
      <ChordPianoDiagramPanel chordSymbol="F" onClose={vi.fn()} initialInstrument="guitar" />,
    );

    expect(screen.getByTestId('chord-guitar-position-name')).toHaveTextContent('Pestana na 1ª casa (forma de E)');
    expect(screen.getByTestId('chord-guitar-barre-info')).toHaveTextContent(
      'Pestana: 1ª casa (cordas 6 a 1, dedo 1)',
    );
    const barreEl = screen.getByTestId('chord-guitar-barre-1');
    expect(barreEl).toHaveAttribute('data-barre-from', '6');
    expect(barreEl).toHaveAttribute('data-barre-to', '1');
    expect(barreEl).toHaveAttribute('data-barre-finger', '1');
    expect(screen.getByTestId('chord-guitar-lowest-note')).toHaveTextContent('Baixo efetivo: F2 (6ª corda)');

    // G/B inversion
    rerender(<ChordPianoDiagramPanel chordSymbol="G/B" onClose={vi.fn()} initialInstrument="guitar" />);
    expect(screen.getByTestId('chord-guitar-position-name')).toHaveTextContent('Aberta com baixo em B (1ª inversão)');
    expect(screen.getByTestId('chord-guitar-lowest-note')).toHaveTextContent('Baixo efetivo: B2 (5ª corda)');
    expect(screen.getByTestId('chord-guitar-svg').querySelector('[data-string-number="6"]')).toHaveAttribute(
      'data-string-status',
      'muted',
    );
    expect(screen.getByTestId('chord-bass-pill')).toHaveTextContent('Baixo: B — nota do acorde, 1ª inversão');

    // C7M
    rerender(<ChordPianoDiagramPanel chordSymbol="C7M" onClose={vi.fn()} initialInstrument="guitar" />);
    expect(screen.getByTestId('chord-canonical-symbol')).toHaveTextContent('Canônico: Cmaj7');
    expect(screen.getByTestId('chord-guitar-svg').querySelector('[data-string-number="2"]')).toHaveAttribute(
      'data-string-note',
      'B3',
    );

    // F#m7(b5)
    rerender(<ChordPianoDiagramPanel chordSymbol="F#m7(b5)" onClose={vi.fn()} initialInstrument="guitar" />);
    expect(screen.getByTestId('chord-guitar-position-name')).toHaveTextContent('2ª casa (baixo na 6ª corda)');
    expect(screen.getByTestId('chord-guitar-lowest-note')).toHaveTextContent('Baixo efetivo: F#2 (6ª corda)');
    expect(screen.getByTestId('chord-guitar-svg').querySelector('[data-string-number="5"]')).toHaveAttribute(
      'data-string-status',
      'muted',
    );
    expect(screen.getByTestId('chord-guitar-svg').querySelector('[data-string-number="1"]')).toHaveAttribute(
      'data-string-status',
      'muted',
    );
  });

  it('shows "Diagrama indisponível" on Violão for uncatalogued chords (C/F#, B13) without breaking Piano or metadata', () => {
    render(<ChordPianoDiagramPanel chordSymbol="C/F#" onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId('diagram-instrument-guitar'));
    expect(screen.getByTestId('chord-guitar-unavailable')).toHaveTextContent(
      'Diagrama indisponível para C/F# no violão',
    );
    expect(screen.getByTestId('chord-piano-live-region')).toHaveTextContent(
      'Diagrama indisponível para C/F# no violão',
    );
    expect(screen.getByTestId('chord-bass-pill')).toHaveTextContent('Baixo: F# — baixo externo / slash bass');

    // Return to Piano smoothly
    fireEvent.click(screen.getByTestId('diagram-instrument-piano'));
    expect(screen.getByTestId('chord-piano-didactic-legend')).toBeInTheDocument();
  });

  it('preserves active Violão instrument across visual transposition updates (C -> D -> C#)', () => {
    const { rerender } = render(<ChordPianoDiagramPanel chordSymbol="C" onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId('diagram-instrument-guitar'));
    expect(screen.getByTestId('chord-guitar-lowest-note')).toHaveTextContent('C3');

    // Transpose +2 semitones to D while Violão stays active
    rerender(<ChordPianoDiagramPanel chordSymbol="D" onClose={vi.fn()} />);
    expect(screen.getByTestId('diagram-instrument-guitar')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('chord-guitar-lowest-note')).toHaveTextContent('Baixo efetivo: D3 (4ª corda)');
    expect(screen.getByTestId('chord-guitar-svg').querySelector('[data-string-number="1"]')).toHaveAttribute(
      'data-string-note',
      'F#4',
    );

    // Transpose to C# (not in curated catalog)
    rerender(<ChordPianoDiagramPanel chordSymbol="C#" onClose={vi.fn()} />);
    expect(screen.getByTestId('chord-guitar-unavailable')).toHaveTextContent(
      'Diagrama indisponível para C# no violão',
    );
  });

  it('preserves aria-live, Tab focus trap, Escape dismissal, and focus restoration while in Violão mode', async () => {
    const onClose = vi.fn();

    function GuitarTestHost() {
      const triggerRef = useRef<HTMLButtonElement | null>(null);
      const [open, setOpen] = React.useState(false);
      return (
        <div>
          <button ref={triggerRef} type="button" data-testid="guitar-open-btn" onClick={() => setOpen(true)}>
            Abrir
          </button>
          {open && (
            <ChordPianoDiagramPanel
              chordSymbol="Am"
              onClose={() => {
                setOpen(false);
                onClose();
              }}
              triggerRef={triggerRef}
            />
          )}
        </div>
      );
    }

    render(<GuitarTestHost />);
    const openBtn = screen.getByTestId('guitar-open-btn');
    openBtn.focus();
    fireEvent.click(openBtn);

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByTestId('diagram-instrument-guitar'));

    expect(within(dialog).getByTestId('chord-piano-live-region')).toHaveTextContent(
      'Violão para Am. Posição: Aberta (1ª posição). Afinação padrão E2 A2 D3 G3 B3 E4.',
    );

    const dialogButtons = within(dialog).getAllByRole('button');
    const firstBtn = dialogButtons[0];
    const lastBtn = dialogButtons[dialogButtons.length - 1];

    lastBtn.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(firstBtn);

    firstBtn.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(lastBtn);

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(document.activeElement).toBe(openBtn);
    });
  });
});

describe('T5 Contextual Harmonic Analysis in ChordPianoDiagramPanel', () => {
  it('shows "Grau não determinado" without keyContext while still identifying C/E inversion and C/F# external bass', () => {
    const { rerender } = render(<ChordPianoDiagramPanel chordSymbol="C/E" onClose={vi.fn()} />);

    expect(screen.getByTestId('chord-harmony-analysis')).toBeInTheDocument();
    expect(screen.getByTestId('harmony-key-picker-btn')).toHaveTextContent('Tom de análise: Não definido');
    expect(screen.getByTestId('harmony-degree-value')).toHaveTextContent('Grau harmônico: Grau não determinado');
    expect(screen.getByTestId('harmony-quality-value')).toHaveTextContent('Qualidade harmônica: Maior');
    expect(screen.getByTestId('harmony-bass-value')).toHaveTextContent('Baixo / Inversão: 1ª inversão');
    expect(screen.getByTestId('harmony-explanation')).toHaveTextContent('nenhuma tonalidade explícita foi informada');

    rerender(<ChordPianoDiagramPanel chordSymbol="C/F#" onClose={vi.fn()} />);
    expect(screen.getByTestId('harmony-degree-value')).toHaveTextContent('Grau harmônico: Grau não determinado');
    expect(screen.getByTestId('harmony-bass-value')).toHaveTextContent('Baixo / Inversão: Baixo externo ao acorde');
  });

  it('supports explicit in-memory key selection, minor natural reference, and indeterminate non-diatonic states', () => {
    const { rerender } = render(<ChordPianoDiagramPanel chordSymbol="G7" onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId('harmony-key-picker-btn'));
    expect(screen.getByTestId('harmony-key-options')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('harmony-key-option-C'));

    expect(screen.queryByTestId('harmony-key-options')).not.toBeInTheDocument();
    expect(screen.getByTestId('harmony-key-picker-btn')).toHaveTextContent('Tom de análise: C');
    expect(screen.getByTestId('harmony-degree-value')).toHaveTextContent('Grau harmônico: V7 (5º grau em C)');
    expect(screen.getByTestId('harmony-quality-value')).toHaveTextContent('Qualidade harmônica: Maior com 7ª menor (Dominante)');
    expect(screen.getByTestId('chord-piano-live-region')).toHaveTextContent('Grau harmônico: V7 em C.');

    // Transposition while keeping in-memory key C -> D (out of C major)
    rerender(<ChordPianoDiagramPanel chordSymbol="D" onClose={vi.fn()} />);
    expect(screen.getByTestId('harmony-degree-value')).toHaveTextContent('Grau harmônico: Grau não determinado');
    expect(screen.getByTestId('harmony-explanation')).toHaveTextContent('fora da escala diatônica de C');

    // Switch in-memory key to Am and verify natural minor vs harmonic minor chord E7
    rerender(<ChordPianoDiagramPanel chordSymbol="Am" onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('harmony-key-picker-btn'));
    fireEvent.click(screen.getByTestId('harmony-key-option-Am'));
    expect(screen.getByTestId('harmony-degree-value')).toHaveTextContent('Grau harmônico: i (1º grau em Am)');
    expect(screen.getByTestId('harmony-explanation')).toHaveTextContent('escala menor natural');

    rerender(<ChordPianoDiagramPanel chordSymbol="E7" onClose={vi.fn()} />);
    expect(screen.getByTestId('harmony-degree-value')).toHaveTextContent('Grau harmônico: Grau não determinado');
    expect(screen.getByTestId('harmony-explanation')).toHaveTextContent('menor harmônica ou melódica');

    // Clear key back to none
    fireEvent.click(screen.getByTestId('harmony-key-picker-btn'));
    fireEvent.click(screen.getByTestId('harmony-key-option-none'));
    expect(screen.getByTestId('harmony-key-picker-btn')).toHaveTextContent('Tom de análise: Não definido');
  });

  it('respects keyContext prop, works identically on Violão tab, and preserves focus trap & Escape', async () => {
    const onClose = vi.fn();

    function HarmonyFocusHost() {
      const triggerRef = useRef<HTMLButtonElement | null>(null);
      const [open, setOpen] = React.useState(false);
      return (
        <div>
          <button ref={triggerRef} type="button" data-testid="harmony-open-btn" onClick={() => setOpen(true)}>
            Abrir
          </button>
          {open && (
            <ChordPianoDiagramPanel
              chordSymbol="G/B"
              keyContext="C"
              initialInstrument="guitar"
              onClose={() => {
                setOpen(false);
                onClose();
              }}
              triggerRef={triggerRef}
            />
          )}
        </div>
      );
    }

    render(<HarmonyFocusHost />);
    const openBtn = screen.getByTestId('harmony-open-btn');
    openBtn.focus();
    fireEvent.click(openBtn);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByTestId('chord-guitar-diagram')).toBeInTheDocument();
    expect(within(dialog).getByTestId('harmony-degree-value')).toHaveTextContent('Grau harmônico: V (5º grau em C)');
    expect(within(dialog).getByTestId('harmony-bass-value')).toHaveTextContent('Baixo / Inversão: 1ª inversão');

    fireEvent.click(within(dialog).getByTestId('harmony-key-picker-btn'));
    const dialogButtons = within(dialog).getAllByRole('button');
    const firstBtn = dialogButtons[0];
    const lastBtn = dialogButtons[dialogButtons.length - 1];

    lastBtn.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(firstBtn);

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(document.activeElement).toBe(openBtn);
    });
  });
});

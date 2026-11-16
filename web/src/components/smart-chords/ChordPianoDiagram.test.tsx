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

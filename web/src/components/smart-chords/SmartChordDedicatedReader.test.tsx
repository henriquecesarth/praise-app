import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SmartChordReader } from './SmartChordReader';
import { SmartChordsWorkspace } from '../SmartChordsWorkspace';

const {
  getSmartChords,
  getArtists,
  getSongs,
  getSmartChordRepertoireLink,
  getMe,
  updateUserPreferences,
} = vi.hoisted(() => ({
  getSmartChords: vi.fn(),
  getArtists: vi.fn(),
  getSongs: vi.fn(),
  getSmartChordRepertoireLink: vi.fn(),
  getMe: vi.fn(),
  updateUserPreferences: vi.fn(),
}));

vi.mock('../../api', () => ({
  api: {
    getSmartChords,
    getArtists,
    getSongs,
    getSmartChordRepertoireLink,
    getMe,
    updateUserPreferences,
  },
}));

vi.mock('html2pdf.js', () => ({
  default: vi.fn(() => ({
    set: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    toPdf: vi.fn().mockReturnThis(),
    get: vi.fn().mockResolvedValue({
      internal: { getNumberOfPages: () => 1 },
      output: () => new Blob(['pdf'], { type: 'application/pdf' }),
    }),
    save: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('D2-A Dedicated Musical Reader & Auto-Scroll Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    getArtists.mockResolvedValue([{ id: 'art-1', name: 'Gabriela Rocha' }]);
    getSongs.mockResolvedValue({ songs: [] });
    getSmartChordRepertoireLink.mockResolvedValue({ link: null });
    getMe.mockResolvedValue({ id: 'user-1', preferences: { chordFontFamily: 'monospace', chordLineSpacingPx: 0 } });
    updateUserPreferences.mockResolvedValue({ preferences: { chordLineSpacingPx: 4 } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens an existing chord in Dedicated Reader mode (read) and new chords in Editor mode (edit)', async () => {
    getSmartChords.mockResolvedValue([
      {
        id: 'chord-1',
        userId: 'user-1',
        title: 'Lugar Secreto',
        artistId: 'art-1',
        artistName: 'Gabriela Rocha',
        originalKey: 'C',
        content: '[C]Tu és tudo o que eu [G]mais quero\n[Am]Meu fôlego, Tu és meu [F]pão',
        createdAt: '',
        updatedAt: '',
      },
    ]);

    const { container } = render(<SmartChordsWorkspace ministryId="min-1" currentUserId="user-1" />);

    const chordBtn = await screen.findByText('Lugar Secreto');
    fireEvent.click(chordBtn);

    const workspaceRoot = container.querySelector('.smart-chords-workspace');
    expect(workspaceRoot).toHaveAttribute('data-workspace-mode', 'read');
    expect(screen.getByRole('button', { name: 'Visualizar' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Editar' })).toHaveAttribute('aria-pressed', 'false');

    // Switch to Editar and return to Visualizar without losing edits
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    expect(workspaceRoot).toHaveAttribute('data-workspace-mode', 'edit');

    const titleInput = screen.getByLabelText(/Título/i);
    fireEvent.change(titleInput, { target: { value: 'Lugar Secreto (Ao Vivo)' } });

    fireEvent.click(screen.getByRole('button', { name: 'Visualizar' }));
    expect(workspaceRoot).toHaveAttribute('data-workspace-mode', 'read');
    expect(screen.getAllByText('Lugar Secreto (Ao Vivo)').length).toBeGreaterThanOrEqual(1);
  });

  it('operates auto-scroll over the rendered container, respects manual scroll, adjusts speed, and stops at bottom', () => {
    vi.useFakeTimers();

    render(
      <SmartChordReader
        title="Bondade de Deus"
        selectedArtistName="Isaías Saad"
        originalKey="G"
        currentKeyTransposed="G"
        content={'[G]Te amo Deus, Tua [C]graça nunca falha\n'.repeat(25)}
        semitones={0}
        sheetFontFamily="monospace"
        printFontSize={14}
        pdfFontSize={12}
        chordLineSpacingPx={0}
        editingCell={null}
        setEditingCell={vi.fn()}
        setEditingChordValue={vi.fn()}
        setSemitones={vi.fn()}
        setPrintFontSize={vi.fn()}
        handleChordLineSpacingChange={vi.fn().mockResolvedValue(undefined)}
        handleFontFamilyChange={vi.fn()}
        renderInlineEditor={() => null}
        isActive={true}
      />
    );

    const scrollSheet = screen.getByTestId('reading-sheet-scroll');
    Object.defineProperty(scrollSheet, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(scrollSheet, 'clientHeight', { configurable: true, value: 300 });
    scrollSheet.scrollTop = 0;

    // Start auto-scroll
    fireEvent.click(screen.getByTestId('auto-scroll-start'));
    expect(screen.getByTestId('dedicated-chord-reader')).toHaveAttribute('data-autoscroll-state', 'playing');

    act(() => {
      vi.advanceTimersByTime(320);
    });
    const posAfterFirstAdvance = scrollSheet.scrollTop;
    expect(posAfterFirstAdvance).toBeGreaterThan(0);

    // Pause and verify scrollTop stops advancing
    fireEvent.click(screen.getByTestId('auto-scroll-pause'));
    expect(screen.getByTestId('dedicated-chord-reader')).toHaveAttribute('data-autoscroll-state', 'paused');
    act(() => {
      vi.advanceTimersByTime(320);
    });
    expect(scrollSheet.scrollTop).toBe(posAfterFirstAdvance);

    // Resume and increase speed
    fireEvent.click(screen.getByTestId('auto-scroll-speed-up'));
    expect(screen.getByTestId('auto-scroll-speed-value').textContent).toBe('3x');
    fireEvent.click(screen.getByTestId('auto-scroll-resume'));
    expect(screen.getByTestId('dedicated-chord-reader')).toHaveAttribute('data-autoscroll-state', 'playing');

    // Manual scroll jump should be respected without snapping back
    scrollSheet.scrollTop = 500;
    fireEvent.scroll(scrollSheet);
    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(scrollSheet.scrollTop).toBeGreaterThan(500);

    // Advance until bottom (maxScrollTop = 1000 - 300 = 700) and verify predictable stop
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(scrollSheet.scrollTop).toBe(700);
    expect(screen.getByTestId('dedicated-chord-reader')).toHaveAttribute('data-autoscroll-state', 'stopped');
  });

  it('automatically pauses auto-scroll when the screen or document becomes inactive', () => {
    vi.useFakeTimers();

    const { rerender } = render(
      <SmartChordReader
        title="Santo Espírito"
        selectedArtistName="Laura Souguellis"
        originalKey="E"
        currentKeyTransposed="E"
        content="[E]Não há nada igual\n[A]Não há nada melhor"
        semitones={0}
        sheetFontFamily="monospace"
        printFontSize={14}
        pdfFontSize={12}
        chordLineSpacingPx={0}
        editingCell={null}
        setEditingCell={vi.fn()}
        setEditingChordValue={vi.fn()}
        setSemitones={vi.fn()}
        setPrintFontSize={vi.fn()}
        handleChordLineSpacingChange={vi.fn().mockResolvedValue(undefined)}
        handleFontFamilyChange={vi.fn()}
        renderInlineEditor={() => null}
        isActive={true}
      />
    );

    const scrollSheet = screen.getByTestId('reading-sheet-scroll');
    Object.defineProperty(scrollSheet, 'scrollHeight', { configurable: true, value: 900 });
    Object.defineProperty(scrollSheet, 'clientHeight', { configurable: true, value: 300 });

    fireEvent.click(screen.getByTestId('auto-scroll-start'));
    expect(screen.getByTestId('dedicated-chord-reader')).toHaveAttribute('data-autoscroll-state', 'playing');

    // Deactivate reader (e.g. switched to edit mode or modal opened)
    rerender(
      <SmartChordReader
        title="Santo Espírito"
        selectedArtistName="Laura Souguellis"
        originalKey="E"
        currentKeyTransposed="E"
        content="[E]Não há nada igual\n[A]Não há nada melhor"
        semitones={0}
        sheetFontFamily="monospace"
        printFontSize={14}
        pdfFontSize={12}
        chordLineSpacingPx={0}
        editingCell={null}
        setEditingCell={vi.fn()}
        setEditingChordValue={vi.fn()}
        setSemitones={vi.fn()}
        setPrintFontSize={vi.fn()}
        handleChordLineSpacingChange={vi.fn().mockResolvedValue(undefined)}
        handleFontFamilyChange={vi.fn()}
        renderInlineEditor={() => null}
        isActive={false}
      />
    );

    expect(screen.getByTestId('dedicated-chord-reader')).toHaveAttribute('data-autoscroll-state', 'paused');
  });

  it('respects prefers-reduced-motion and allows toggling fullscreen mode', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    try {
      render(
        <SmartChordReader
          title="Hosana"
          selectedArtistName="Gabriela Rocha"
          originalKey="Bm"
          currentKeyTransposed="Bm"
          content="[Bm]Eu vejo o Rei da [D]glória"
          semitones={0}
          sheetFontFamily="monospace"
          printFontSize={14}
          pdfFontSize={12}
          chordLineSpacingPx={0}
          editingCell={null}
          setEditingCell={vi.fn()}
          setEditingChordValue={vi.fn()}
          setSemitones={vi.fn()}
          setPrintFontSize={vi.fn()}
          handleChordLineSpacingChange={vi.fn().mockResolvedValue(undefined)}
          handleFontFamilyChange={vi.fn()}
          renderInlineEditor={() => null}
          isActive={true}
        />
      );

      expect(screen.getByTestId('reduced-motion-notice')).toBeInTheDocument();
      expect(screen.getByTestId('auto-scroll-start')).toBeDisabled();

      // Explicit user opt-in enables start, and opt-out immediately stops it
      fireEvent.click(screen.getByTestId('reduced-motion-toggle'));
      expect(screen.getByTestId('auto-scroll-start')).not.toBeDisabled();

      // Fullscreen toggle
      const fsBtn = screen.getByTestId('reader-fullscreen-toggle');
      expect(fsBtn).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(fsBtn);
      expect(fsBtn).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('dedicated-chord-reader')).toHaveAttribute('data-reader-fullscreen', 'true');
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('preserves offline reading for previously cached chords when navigator.onLine is false', async () => {
    const cachedChords = [
      {
        id: 'offline-1',
        userId: 'user-1',
        title: 'A Casa É Sua (Offline)',
        artistId: 'art-1',
        artistName: 'Casa Worship',
        originalKey: 'C',
        content: '[C]Essa casa é [G]sua casa',
        createdAt: '',
        updatedAt: '',
      },
    ];
    localStorage.setItem('louvaio_offline_smart_chords:user-1:min-1', JSON.stringify(cachedChords));
    getSmartChords.mockRejectedValue(new Error('Network offline'));

    const originalOnLine = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });

    try {
      render(<SmartChordsWorkspace ministryId="min-1" currentUserId="user-1" />);
      await waitFor(() => {
        expect(screen.getByText('A Casa É Sua (Offline)')).toBeInTheDocument();
      });
    } finally {
      if (originalOnLine) {
        Object.defineProperty(window.navigator, 'onLine', originalOnLine);
      } else {
        Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
      }
    }
  });
});

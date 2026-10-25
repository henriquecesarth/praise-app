import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SmartChordsWorkspace } from './SmartChordsWorkspace';

const {
  getArtists,
  getSongs,
  getSmartChords,
  createSmartChord,
  updateSmartChord,
  deleteSmartChord,
  getSmartChordRepertoireLink,
  setSmartChordRepertoireLink,
  removeSmartChordRepertoireLink,
  getMe,
  updateUserPreferences,
} = vi.hoisted(() => ({
  getArtists: vi.fn(),
  getSongs: vi.fn(),
  getSmartChords: vi.fn(),
  createSmartChord: vi.fn(),
  updateSmartChord: vi.fn(),
  deleteSmartChord: vi.fn(),
  getSmartChordRepertoireLink: vi.fn(),
  setSmartChordRepertoireLink: vi.fn(),
  removeSmartChordRepertoireLink: vi.fn(),
  getMe: vi.fn(),
  updateUserPreferences: vi.fn(),
}));

vi.mock('../api', () => ({
  api: {
    getArtists,
    getSongs,
    getSmartChords,
    createSmartChord,
    updateSmartChord,
    deleteSmartChord,
    getSmartChordRepertoireLink,
    setSmartChordRepertoireLink,
    removeSmartChordRepertoireLink,
    getMe,
    updateUserPreferences,
  },
}));

describe('SmartChordsWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    getArtists.mockResolvedValue([]);
    getSongs.mockResolvedValue({ songs: [], totalCount: 0 });
    getSmartChords.mockResolvedValue([]);
    createSmartChord.mockResolvedValue({ id: 'new-1', title: 'Nova Cifra' });
    updateSmartChord.mockResolvedValue({ id: 'c-1', title: 'Atualizada' });
    deleteSmartChord.mockResolvedValue(undefined);
    getSmartChordRepertoireLink.mockResolvedValue({ link: null, song: null });
    setSmartChordRepertoireLink.mockResolvedValue({ link: null, song: null });
    removeSmartChordRepertoireLink.mockResolvedValue(undefined);
    getMe.mockResolvedValue({
      id: 'user-default',
      email: 'user@example.com',
      name: 'Default User',
      preferences: { chordFontFamily: 'monospace' },
    });
    updateUserPreferences.mockImplementation(async (prefs: any) => ({
      preferences: { chordFontFamily: prefs?.chordFontFamily || 'monospace' },
    }));
  });

  describe('Ministry loading & abortion', () => {
    it('loads relations for the selected ministry and aborts the previous selection', async () => {
      const { rerender } = render(<SmartChordsWorkspace ministryId="ministry-a" />);

      await waitFor(() => expect(getSongs).toHaveBeenCalledWith('ministry-a', undefined, expect.any(AbortSignal)));
      const firstSignal = getSongs.mock.calls[0][2] as AbortSignal;

      rerender(<SmartChordsWorkspace ministryId="ministry-b" />);

      await waitFor(() => expect(getSongs).toHaveBeenCalledWith('ministry-b', undefined, expect.any(AbortSignal)));
      expect(firstSignal.aborted).toBe(true);
      expect(getArtists).toHaveBeenCalledWith('ministry-b', undefined, expect.any(AbortSignal));
      expect(getSmartChords).toHaveBeenCalledWith('ministry-b', undefined, expect.any(AbortSignal));
    });
  });

  describe('List, Empty and Error States', () => {
    it('renders chord items when data is available', async () => {
      getSmartChords.mockResolvedValue([
        {
          id: 'sc-1',
          title: 'Porque Ele Vive',
          originalKey: 'G',
          artistId: 'art-1',
          content: '[G]Deus enviou',
        },
      ]);
      getArtists.mockResolvedValue([{ id: 'art-1', name: 'Harpa Cristã' }]);

      render(<SmartChordsWorkspace ministryId="min-1" />);

      await waitFor(() => {
        expect(screen.getByText('Porque Ele Vive')).toBeInTheDocument();
        expect(screen.getByText('Harpa Cristã')).toBeInTheDocument();
        expect(screen.getByText('G')).toBeInTheDocument();
      });
    });

    it('renders true empty state when there are no chords and no error', async () => {
      getSmartChords.mockResolvedValue([]);

      render(<SmartChordsWorkspace ministryId="min-1" />);

      await waitFor(() => {
        expect(screen.getByText('Nenhuma cifra encontrada.')).toBeInTheDocument();
      });
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('prevents empty vs error state collision: renders error alert and does NOT render empty text', async () => {
      getSmartChords.mockRejectedValue(new Error('Falha de rede ao consultar cifras.'));

      render(<SmartChordsWorkspace ministryId="min-1" />);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByText('Falha de rede ao consultar cifras.')).toBeInTheDocument();
      });

      // Crucial: empty state text MUST NOT be visible when error occurred
      expect(screen.queryByText('Nenhuma cifra encontrada.')).toBeNull();
      expect(screen.getByRole('button', { name: /Tentar novamente/i })).toBeInTheDocument();
    });

    it('allows retrying after error when user clicks retry button', async () => {
      getSmartChords.mockRejectedValueOnce(new Error('Erro passageiro.'));

      render(<SmartChordsWorkspace ministryId="min-1" />);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      getSmartChords.mockResolvedValueOnce([
        { id: 'sc-success', title: 'Cifra Recuperada', originalKey: 'C', content: '[C]' },
      ]);

      const retryBtn = screen.getByRole('button', { name: /Tentar novamente/i });
      fireEvent.click(retryBtn);

      await waitFor(() => {
        expect(screen.getByText('Cifra Recuperada')).toBeInTheDocument();
      });
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.queryByText('Nenhuma cifra encontrada.')).toBeNull();
    });
  });

  describe('Chord Selection and Actions', () => {
    it('opens editor with empty template when clicking Criar Cifra', async () => {
      render(<SmartChordsWorkspace ministryId="min-1" />);

      const newBtn = screen.getByRole('button', { name: /Criar Cifra/i });
      fireEvent.click(newBtn);

      await waitFor(() => {
        expect(screen.getByDisplayValue('Nova Cifra')).toBeInTheDocument();
      });
    });

    it('selects chord and allows deleting via canonical api.deleteSmartChord', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      vi.spyOn(window, 'alert').mockImplementation(() => {});

      getSmartChords.mockResolvedValue([
        {
          id: 'sc-del-1',
          title: 'Cifra Para Excluir',
          originalKey: 'D',
          content: '[D]Letra',
        },
      ]);

      render(<SmartChordsWorkspace ministryId="min-1" />);

      await waitFor(() => {
        expect(screen.getByText('Cifra Para Excluir')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Cifra Para Excluir'));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^Excluir$/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /^Excluir$/i }));

      await waitFor(() => {
        expect(deleteSmartChord).toHaveBeenCalledWith('sc-del-1');
      });
    });
  });

  describe('Stale Relation Request Fencing (F-M19-05)', () => {
    it('WEB_CHORD_SWITCH_LATE_RESPONSE_TEST: discards late relation response from previous chord when user switches chords', async () => {
      getSmartChords.mockResolvedValue([
        { id: 'sc-1', title: 'Cifra Um', originalKey: 'C', content: '[C]' },
        { id: 'sc-2', title: 'Cifra Dois', originalKey: 'D', content: '[D]' },
      ]);
      getSongs.mockResolvedValue({
        songs: [
          { id: 'song-1', title: 'Música 1' },
          { id: 'song-2', title: 'Música 2' },
        ],
        totalCount: 2,
      });

      let resolveChord1Link!: (val: any) => void;
      const chord1Promise = new Promise((resolve) => {
        resolveChord1Link = resolve;
      });

      getSmartChordRepertoireLink.mockImplementation((_minId: string, chordId: string) => {
        if (chordId === 'sc-1') {
          return chord1Promise;
        }
        if (chordId === 'sc-2') {
          return Promise.resolve({
            link: { id: 'link-2', songId: 'song-2' },
            song: { id: 'song-2', title: 'Música 2' },
          });
        }
        return Promise.resolve({ link: null, song: null });
      });

      render(<SmartChordsWorkspace ministryId="min-1" />);

      await waitFor(() => {
        expect(screen.getByText('Cifra Um')).toBeInTheDocument();
        expect(screen.getByText('Cifra Dois')).toBeInTheDocument();
      });

      // 1. Click Cifra Um (triggers pending request)
      fireEvent.click(screen.getByText('Cifra Um'));

      // 2. Click Cifra Dois immediately (resolves fast with song-2)
      fireEvent.click(screen.getByText('Cifra Dois'));

      const comboboxes = await screen.findAllByRole('combobox');
      const songSelect = comboboxes[1] as HTMLSelectElement;
      await waitFor(() => {
        expect(songSelect.value).toBe('song-2');
      });

      // 3. Late response for Cifra Um arrives
      resolveChord1Link({
        link: { id: 'link-1', songId: 'song-1' },
        song: { id: 'song-1', title: 'Música 1' },
      });

      // 4. Assert that songSelect remains song-2 and was NOT overwritten by late response from sc-1
      await new Promise((r) => setTimeout(r, 50));
      expect(songSelect.value).toBe('song-2');
    });

    it('WEB_MINISTRY_SWITCH_LATE_RESPONSE_TEST: discards late relation response when active ministry changes', async () => {
      getSmartChords.mockResolvedValue([
        { id: 'sc-alpha', title: 'Cifra Alpha', originalKey: 'E', content: '[E]' },
      ]);
      getSongs.mockResolvedValue({
        songs: [{ id: 'song-alpha', title: 'Música Alpha' }],
        totalCount: 1,
      });

      let resolveAlphaLink!: (val: any) => void;
      const alphaPromise = new Promise((resolve) => {
        resolveAlphaLink = resolve;
      });

      getSmartChordRepertoireLink.mockImplementation((minId: string) => {
        if (minId === 'min-alpha') {
          return alphaPromise;
        }
        return Promise.resolve({ link: null, song: null });
      });

      const { rerender } = render(<SmartChordsWorkspace ministryId="min-alpha" />);

      await waitFor(() => {
        expect(screen.getByText('Cifra Alpha')).toBeInTheDocument();
      });

      // Select chord in Ministry Alpha
      fireEvent.click(screen.getByText('Cifra Alpha'));

      // Switch active ministry to Beta
      rerender(<SmartChordsWorkspace ministryId="min-beta" />);

      // Late response for Alpha arrives
      resolveAlphaLink({
        link: { id: 'link-alpha', songId: 'song-alpha' },
        song: { id: 'song-alpha', title: 'Música Alpha' },
      });

      await new Promise((r) => setTimeout(r, 50));
      // In Beta, editor should not display Cifra Alpha or its song-alpha link
      expect(screen.queryByDisplayValue('Cifra Alpha')).toBeNull();
    });
  });

  describe('Instrumental Bar Progression UI Safety (Hotfix R1.2)', () => {
    it('renders bracketed bar progressions with independently clickable chords and preserved delimiters', async () => {
      getSmartChords.mockResolvedValue([
        {
          id: 'sc-bars',
          title: 'Instrumental Track',
          originalKey: 'A',
          content: '[||: A9 | A7M/9 | D9 | % :||]',
        },
      ]);

      render(<SmartChordsWorkspace ministryId="min-1" />);

      await waitFor(() => {
        expect(screen.getByText('Instrumental Track')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Instrumental Track'));

      await waitFor(() => {
        expect(screen.getByText('||:')).toBeInTheDocument();
        expect(screen.getByText(':||')).toBeInTheDocument();
        expect(screen.getByText('%')).toBeInTheDocument();
        expect(screen.getByText('A9')).toBeInTheDocument();
        expect(screen.getByText('A7M/9')).toBeInTheDocument();
        expect(screen.getByText('D9')).toBeInTheDocument();
      });
    });

    it('safely edits only the third chord D9 -> E9 preserving all delimiters, spaces and other chords', async () => {
      getSmartChords.mockResolvedValue([
        {
          id: 'sc-bars-edit',
          title: 'Instrumental Edit Track',
          originalKey: 'A',
          content: '[||: A9 | A7M/9 | D9 | % :||]',
        },
      ]);

      render(<SmartChordsWorkspace ministryId="min-1" />);

      await waitFor(() => {
        expect(screen.getByText('Instrumental Edit Track')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Instrumental Edit Track'));

      // Wait for sheet to display the chords
      const d9Span = await screen.findByText('D9');
      expect(d9Span).toBeInTheDocument();

      // Click D9 (chordIndex 2)
      fireEvent.click(d9Span);

      // Input appears with prefilled value D9
      const input = await screen.findByDisplayValue('D9');
      expect(input).toBeInTheDocument();

      // Edit D9 -> E9 and press Enter
      fireEvent.change(input, { target: { value: 'E9' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

      // Verify sheet and textarea content
      await waitFor(() => {
        expect(screen.getByText('E9')).toBeInTheDocument();
        expect(screen.queryByText('D9')).toBeNull();
        expect(screen.getByText('A9')).toBeInTheDocument();
        expect(screen.getByText('A7M/9')).toBeInTheDocument();
        expect(screen.getByText('||:')).toBeInTheDocument();
        expect(screen.getByText(':||')).toBeInTheDocument();
        expect(screen.getByText('%')).toBeInTheDocument();
      });

      const textarea = screen.getByDisplayValue('[||: A9 | A7M/9 | E9 | % :||]');
      expect(textarea).toBeInTheDocument();
    });

    it('cancels inline editing on Escape key without mutating progression', async () => {
      getSmartChords.mockResolvedValue([
        {
          id: 'sc-bars-esc',
          title: 'Escape Track',
          originalKey: 'A',
          content: '[||: A9 | A7M/9 | D9 | % :||]',
        },
      ]);

      render(<SmartChordsWorkspace ministryId="min-1" />);

      await waitFor(() => {
        expect(screen.getByText('Escape Track')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Escape Track'));

      const a9Span = await screen.findByText('A9');
      fireEvent.click(a9Span);

      const input = await screen.findByTestId('inline-chord-input');
      expect(input).toHaveValue('A9');
      fireEvent.change(input, { target: { value: 'B9' } });
      fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });

      await waitFor(() => {
        expect(screen.queryByTestId('inline-chord-input')).toBeNull();
        expect(screen.getByText('A9')).toBeInTheDocument();
      });

      const textarea = screen.getByDisplayValue('[||: A9 | A7M/9 | D9 | % :||]');
      expect(textarea).toBeInTheDocument();
    });

    it('edits repeated chord instances independently in [| A | F#m | A | E |]', async () => {
      getSmartChords.mockResolvedValue([
        {
          id: 'sc-bars-repeat',
          title: 'Repeat Chords Track',
          originalKey: 'A',
          content: '[| A | F#m | A | E |]',
        },
      ]);

      render(<SmartChordsWorkspace ministryId="min-1" />);

      await waitFor(() => {
        expect(screen.getByText('Repeat Chords Track')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Repeat Chords Track'));

      // Find chord tokens with data-bar-chord-idx="2" (second A)
      const secondA = await waitFor(() => {
        const el = document.querySelector('[data-bar-chord-idx="2"]');
        expect(el).not.toBeNull();
        expect(el?.textContent).toBe('A');
        return el!;
      });

      fireEvent.click(secondA);

      const input = await screen.findByTestId('inline-chord-input');
      expect(input).toHaveValue('A');
      fireEvent.change(input, { target: { value: 'D' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

      await waitFor(() => {
        const textarea = screen.getByDisplayValue('[| A | F#m | D | E |]');
        expect(textarea).toBeInTheDocument();
      });

      // Assert first A is still present at chordIndex 0
      const firstA = document.querySelector('[data-bar-chord-idx="0"]');
      expect(firstA?.textContent).toBe('A');
      const editedD = document.querySelector('[data-bar-chord-idx="2"]');
      expect(editedD?.textContent).toBe('D');
    });

    it('renders empty measures [| | | | | |] and section barlines [||] without fake chords', async () => {
      getSmartChords.mockResolvedValue([
        {
          id: 'sc-empty-bars',
          title: 'Empty Measures Track',
          originalKey: 'C',
          content: '[| | | | | |]\n[||]',
        },
      ]);

      render(<SmartChordsWorkspace ministryId="min-1" />);

      await waitFor(() => {
        expect(screen.getByText('Empty Measures Track')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Empty Measures Track'));

      await waitFor(() => {
        const groupLines = screen.getAllByRole('group');
        expect(groupLines.length).toBeGreaterThanOrEqual(2);
      });

      // No chord spans with data-bar-chord-idx should exist
      const chordSpans = document.querySelectorAll('[data-bar-chord-idx]');
      expect(chordSpans.length).toBe(0);
    });
  });

  describe('R1.3 Visual Cleanup & Typography', () => {
    it('hides structural opening and closing brackets in the rendered sheet view while preserving tokens and raw content', async () => {
      getSmartChords.mockResolvedValue([
        {
          id: 'sc-clean-bars',
          title: 'Clean Progression Track',
          originalKey: 'A',
          content: '[||: A9 | A7M/9 | D9 | % :||]',
        },
      ]);

      render(<SmartChordsWorkspace ministryId="min-1" />);

      await waitFor(() => {
        expect(screen.getByText('Clean Progression Track')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Clean Progression Track'));

      await waitFor(() => {
        expect(screen.getByText('A9')).toBeInTheDocument();
        expect(screen.getByText('A7M/9')).toBeInTheDocument();
        expect(screen.getByText('D9')).toBeInTheDocument();
        expect(screen.getByText('||:')).toBeInTheDocument();
        expect(screen.getByText(':||')).toBeInTheDocument();
        expect(screen.getByText('%')).toBeInTheDocument();
      });

      const sheetBox = document.querySelector('.print-sheet-box');
      expect(sheetBox).not.toBeNull();
      expect(sheetBox?.textContent).not.toContain('[');
      expect(sheetBox?.textContent).not.toContain(']');

      const textarea = screen.getByDisplayValue('[||: A9 | A7M/9 | D9 | % :||]');
      expect(textarea).toBeInTheDocument();
    });

    it('hides structural brackets in the printable PDF preview modal', async () => {
      getSmartChords.mockResolvedValue([
        {
          id: 'sc-modal-brackets',
          title: 'Modal Progression Track',
          originalKey: 'A',
          content: '[||: A9 | A7M/9 | D9 | % :||]',
        },
      ]);

      render(<SmartChordsWorkspace ministryId="min-1" />);

      await waitFor(() => {
        expect(screen.getByText('Modal Progression Track')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Modal Progression Track'));

      const printBtn = screen.getByRole('button', { name: /Exportar PDF/i });
      fireEvent.click(printBtn);

      await waitFor(() => {
        expect(screen.getByTestId('modal-font-family-select')).toBeInTheDocument();
      });

      const pdfContainer = document.querySelector('#printable-sheet-pdf');
      expect(pdfContainer).not.toBeNull();
      expect(pdfContainer?.textContent).toContain('A9');
      expect(pdfContainer?.textContent).toContain('||:');
      expect(pdfContainer?.textContent).not.toContain('[');
      expect(pdfContainer?.textContent).not.toContain(']');
    });

    it('renders font family selector with default monospace and persists selection in localStorage', async () => {
      localStorage.clear();
      getSmartChords.mockResolvedValue([
        {
          id: 'sc-font-test',
          title: 'Typography Track',
          originalKey: 'C',
          content: '[C]Aleluia [G]ao Senhor',
        },
      ]);

      render(<SmartChordsWorkspace ministryId="min-1" />);

      await waitFor(() => {
        expect(screen.getByText('Typography Track')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Typography Track'));

      const fontSelect = screen.getByTestId('font-family-select') as HTMLSelectElement;
      expect(fontSelect).toBeInTheDocument();
      expect(fontSelect.value).toBe('monospace');

      fireEvent.change(fontSelect, { target: { value: 'Arial' } });
      expect(fontSelect.value).toBe('Arial');
      expect(localStorage.getItem('louvaio_smart_chord_font_family')).toBe('Arial');

      const sheetBox = document.querySelector('.print-sheet-box') as HTMLElement;
      expect(sheetBox.style.fontFamily).toContain('Arial');
    });

    it('synchronizes font family changes made in the PDF preview modal', async () => {
      getSmartChords.mockResolvedValue([
        {
          id: 'sc-modal-font',
          title: 'Modal Font Track',
          originalKey: 'D',
          content: '[D]Gloria [A]a Deus',
        },
      ]);

      render(<SmartChordsWorkspace ministryId="min-1" />);

      await waitFor(() => {
        expect(screen.getByText('Modal Font Track')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Modal Font Track'));

      fireEvent.click(screen.getByRole('button', { name: /Exportar PDF/i }));

      await waitFor(() => {
        expect(screen.getByTestId('modal-font-family-select')).toBeInTheDocument();
      });

      const modalFontSelect = screen.getByTestId('modal-font-family-select') as HTMLSelectElement;
      fireEvent.change(modalFontSelect, { target: { value: 'Georgia' } });

      const pdfContainer = document.querySelector('#printable-sheet-pdf') as HTMLElement;
      expect(pdfContainer.style.fontFamily).toContain('Georgia');

      const closeBtn = screen.getByRole('button', { name: /Fechar/i });
      fireEvent.click(closeBtn);

      const toolbarSelect = screen.getByTestId('font-family-select') as HTMLSelectElement;
      expect(toolbarSelect.value).toBe('Georgia');
    });

    it('resets inline editing cell state when switching chords or creating a new chord (Finding LOW-01)', async () => {
      getSmartChords.mockResolvedValue([
        {
          id: 'sc-low-1',
          title: 'Chord Track One',
          originalKey: 'A',
          content: '[||: A9 | D9 :||]',
        },
        {
          id: 'sc-low-2',
          title: 'Chord Track Two',
          originalKey: 'C',
          content: '[C]Santo',
        },
      ]);

      render(<SmartChordsWorkspace ministryId="min-1" />);

      await waitFor(() => {
        expect(screen.getByText('Chord Track One')).toBeInTheDocument();
        expect(screen.getByText('Chord Track Two')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Chord Track One'));
      const a9Span = await screen.findByText('A9');
      fireEvent.click(a9Span);

      const input = await screen.findByTestId('inline-chord-input');
      expect(input).toBeInTheDocument();

      fireEvent.click(screen.getByText('Chord Track Two'));

      await waitFor(() => {
        expect(screen.queryByTestId('inline-chord-input')).toBeNull();
      });

      fireEvent.click(screen.getByText('Chord Track One'));
      const a9SpanAgain = await screen.findByText('A9');
      fireEvent.click(a9SpanAgain);

      expect(await screen.findByTestId('inline-chord-input')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Criar Cifra/i }));

      await waitFor(() => {
        expect(screen.queryByTestId('inline-chord-input')).toBeNull();
      });
    });

    it('ensures printable-sheet-pdf avoids forced 297mm minHeight and configures pagebreak safety (Hotfix R1.3.1)', async () => {
      getSmartChords.mockResolvedValue([
        {
          id: 'sc-pdf-pagination',
          title: 'Compact PDF Track',
          originalKey: 'G',
          content: 'Intro: [||: G | D | Em | C :||]\n[G]Gracas [D]Te dou [Em]pelo Teu [C]amor',
        },
      ]);

      const mockSave = vi.fn();
      const mockFrom = vi.fn().mockReturnValue({ save: mockSave });
      const mockSet = vi.fn().mockReturnValue({ from: mockFrom });
      const mockHtml2pdf = vi.fn().mockReturnValue({ set: mockSet });
      (window as any).html2pdf = mockHtml2pdf;

      render(<SmartChordsWorkspace ministryId="min-1" />);

      await waitFor(() => {
        expect(screen.getByText('Compact PDF Track')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Compact PDF Track'));
      fireEvent.click(screen.getByRole('button', { name: /Exportar PDF/i }));

      await waitFor(() => {
        expect(screen.getByTestId('modal-font-family-select')).toBeInTheDocument();
      });

      const pdfContainer = document.querySelector('#printable-sheet-pdf') as HTMLElement;
      expect(pdfContainer).not.toBeNull();

      // R1.3.1: Must NOT force minHeight: 297mm which pushes empty 20mm onto blank page 2
      expect(pdfContainer.style.minHeight).not.toBe('297mm');
      expect(pdfContainer.style.boxShadow).not.toContain('0 4px 8px');

      // R1.3.1: Style block must declare break-inside: avoid for line rows and header
      const styleTag = document.querySelector('style[data-pdf-styles], .glass-panel style, #printable-sheet-pdf style') ||
        Array.from(document.querySelectorAll('style')).find((s) => s.textContent?.includes('pdf-line-row'));
      expect(styleTag?.textContent).toContain('break-inside: avoid !important');
      expect(styleTag?.textContent).toContain('page-break-inside: avoid !important');

      // Test generatePDF options
      const downloadBtn = screen.getByRole('button', { name: /Baixar PDF/i });
      fireEvent.click(downloadBtn);

      expect(mockHtml2pdf).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          margin: 10,
          jsPDF: expect.objectContaining({ format: 'a4', orientation: 'portrait' }),
          pagebreak: { mode: ['css', 'legacy'] },
        })
      );
      expect(mockFrom).toHaveBeenCalledWith(pdfContainer);
      expect(mockSave).toHaveBeenCalled();
    });
  });

  describe('F04 — Persistent initialChordId', () => {
    it('consumes initialChordId once so manual selection survives subsequent search and refresh', async () => {
      const chordA: any = {
        id: 'c-1',
        title: 'Chord A',
        originalKey: 'C',
        content: '[C]Chord A',
        userId: 'u-1',
        artistId: null,
        songId: null,
      };
      const chordB: any = {
        id: 'c-2',
        title: 'Chord B',
        originalKey: 'D',
        content: '[D]Chord B',
        userId: 'u-1',
        artistId: null,
        songId: null,
      };

      getSmartChords.mockResolvedValue([chordA, chordB]);
      const onInitialChordConsumed = vi.fn();

      render(
        <SmartChordsWorkspace
          ministryId="min-1"
          initialChordId="c-1"
          onInitialChordConsumed={onInitialChordConsumed}
        />
      );

      // Initially chord A is selected from initialChordId
      await waitFor(() => {
        expect(screen.getByDisplayValue('Chord A')).toBeInTheDocument();
      });

      // User manually selects chord B
      const chordBItem = screen.getByText('Chord B');
      fireEvent.click(chordBItem);

      await waitFor(() => {
        expect(screen.getByDisplayValue('Chord B')).toBeInTheDocument();
      });

      // User types in search bar triggering list refresh
      const searchInput = screen.getByPlaceholderText(/buscar cifra/i);
      getSmartChords.mockResolvedValue([chordA, chordB]);
      fireEvent.change(searchInput, { target: { value: 'Chord' } });

      // Selection must REMAIN chord B, not reset back to chord A!
      await waitFor(() => {
        expect(screen.getByDisplayValue('Chord B')).toBeInTheDocument();
      });
      expect(screen.queryByDisplayValue('Chord A')).not.toBeInTheDocument();
    });
  });

  describe('User Chord Font Preferences', () => {
    const openEditor = async () => {
      const newBtn = screen.getByRole('button', { name: /Criar Cifra/i });
      fireEvent.click(newBtn);
      await waitFor(() => {
        expect(screen.getByTestId('font-family-select')).toBeInTheDocument();
      });
    };

    it('1. initializes with default monospace when user has no custom preference', async () => {
      getMe.mockResolvedValue({
        id: 'user-default',
        email: 'user@example.com',
        name: 'Default User',
        preferences: { chordFontFamily: 'monospace' },
      });

      render(<SmartChordsWorkspace ministryId="min-1" />);
      await openEditor();

      await waitFor(() => {
        const select = screen.getByTestId('font-family-select') as HTMLSelectElement;
        expect(select.value).toBe('monospace');
      });
    });

    it('2. loads saved Arial preference from backend on entry', async () => {
      getMe.mockResolvedValue({
        id: 'user-1',
        email: 'user1@example.com',
        name: 'User 1',
        preferences: { chordFontFamily: 'Arial' },
      });

      render(<SmartChordsWorkspace ministryId="min-1" />);
      await openEditor();

      await waitFor(() => {
        const select = screen.getByTestId('font-family-select') as HTMLSelectElement;
        expect(select.value).toBe('Arial');
      });

      const printSheetBox = document.querySelector('.print-sheet-box') as HTMLElement;
      expect(printSheetBox).toHaveStyle({ fontFamily: 'Arial, Helvetica, sans-serif' });
    });

    it('3. sends PATCH to backend when user changes font to Georgia', async () => {
      getMe.mockResolvedValue({
        id: 'user-1',
        email: 'user1@example.com',
        name: 'User 1',
        preferences: { chordFontFamily: 'monospace' },
      });
      updateUserPreferences.mockResolvedValue({
        preferences: { chordFontFamily: 'Georgia' },
      });

      render(<SmartChordsWorkspace ministryId="min-1" />);
      await openEditor();

      await waitFor(() => {
        expect(screen.getByTestId('font-family-select')).toHaveValue('monospace');
      });

      fireEvent.change(screen.getByTestId('font-family-select'), {
        target: { value: 'Georgia' },
      });

      await waitFor(() => {
        expect(updateUserPreferences).toHaveBeenCalledWith({ chordFontFamily: 'Georgia' });
      });

      expect(screen.getByTestId('font-family-select')).toHaveValue('Georgia');
    });

    it('4. synchronizes workspace toolbar selector and print modal selector', async () => {
      getMe.mockResolvedValue({
        id: 'user-1',
        email: 'user1@example.com',
        name: 'User 1',
        preferences: { chordFontFamily: 'Arial' },
      });

      render(<SmartChordsWorkspace ministryId="min-1" />);
      await openEditor();

      await waitFor(() => {
        expect(screen.getByTestId('font-family-select')).toHaveValue('Arial');
      });

      // Open print modal
      fireEvent.click(screen.getByText(/Exportar PDF/i));

      const modalSelect = screen.getByTestId('modal-font-family-select') as HTMLSelectElement;
      expect(modalSelect.value).toBe('Arial');

      // Change in modal
      fireEvent.change(modalSelect, { target: { value: 'Verdana' } });

      const toolbarSelect = screen.getByTestId('font-family-select') as HTMLSelectElement;
      expect(toolbarSelect.value).toBe('Verdana');
      expect(modalSelect.value).toBe('Verdana');

      await waitFor(() => {
        expect(updateUserPreferences).toHaveBeenCalledWith({ chordFontFamily: 'Verdana' });
      });
    });

    it('5. applies selected font to PDF modal preview', async () => {
      getMe.mockResolvedValue({
        id: 'user-1',
        email: 'user1@example.com',
        name: 'User 1',
        preferences: { chordFontFamily: 'Times New Roman' },
      });

      render(<SmartChordsWorkspace ministryId="min-1" />);
      await openEditor();

      await waitFor(() => {
        expect(screen.getByTestId('font-family-select')).toHaveValue('Times New Roman');
      });

      // Open print modal
      fireEvent.click(screen.getByText(/Exportar PDF/i));

      // Sheet in modal contains Times New Roman
      const modalSheet = document.getElementById('printable-sheet-pdf');
      expect(modalSheet).toBeInTheDocument();
      expect(modalSheet).toHaveStyle({ fontFamily: '"Times New Roman", Times, serif' });
    });

    it('6. preserves font on remount using local cache and backend confirmation', async () => {
      getMe.mockResolvedValue({
        id: 'user-1',
        email: 'user1@example.com',
        name: 'User 1',
        preferences: { chordFontFamily: 'Courier New' },
      });

      const { unmount } = render(<SmartChordsWorkspace ministryId="min-1" />);
      await openEditor();

      await waitFor(() => {
        expect(screen.getByTestId('font-family-select')).toHaveValue('Courier New');
      });

      unmount();

      // Second mount: immediately reads cached preference
      render(<SmartChordsWorkspace ministryId="min-1" />);
      await openEditor();
      const select = screen.getByTestId('font-family-select') as HTMLSelectElement;
      expect(select.value).toBe('Courier New');
    });

    it('7. isolates preferences between different authenticated user accounts', async () => {
      // User A previously cached Arial
      localStorage.setItem('louvaio_chord_font_user_user-a', 'Arial');

      // User B is active
      localStorage.setItem('louvaio_last_auth_user_id', 'user-b');
      getMe.mockResolvedValue({
        id: 'user-b',
        email: 'userb@example.com',
        name: 'User B',
        preferences: { chordFontFamily: 'Georgia' },
      });

      render(<SmartChordsWorkspace ministryId="min-1" />);
      await openEditor();

      await waitFor(() => {
        expect(screen.getByTestId('font-family-select')).toHaveValue('Georgia');
      });

      // User A's storage was not polluted
      expect(localStorage.getItem('louvaio_chord_font_user_user-a')).toBe('Arial');
      expect(localStorage.getItem('louvaio_chord_font_user_user-b')).toBe('Georgia');
    });

    it('8. rejects stale async preference response when user changes font before response arrives', async () => {
      let resolveGetMe: any;
      getMe.mockReturnValue(
        new Promise((resolve) => {
          resolveGetMe = resolve;
        })
      );

      render(<SmartChordsWorkspace ministryId="min-1" />);
      await openEditor();

      // User immediately changes font to Verdana before getMe finishes
      fireEvent.change(screen.getByTestId('font-family-select'), {
        target: { value: 'Verdana' },
      });

      expect(screen.getByTestId('font-family-select')).toHaveValue('Verdana');

      // Now getMe resolves with stale 'Arial'
      resolveGetMe({
        id: 'user-1',
        email: 'user1@example.com',
        name: 'User 1',
        preferences: { chordFontFamily: 'Arial' },
      });

      await new Promise((r) => setTimeout(r, 50));

      // Selection must remain Verdana, not overwritten by Arial
      expect(screen.getByTestId('font-family-select')).toHaveValue('Verdana');
    });

    it('9. gracefully handles preference update API failure without crashing', async () => {
      getMe.mockResolvedValue({
        id: 'user-1',
        email: 'user1@example.com',
        name: 'User 1',
        preferences: { chordFontFamily: 'monospace' },
      });
      updateUserPreferences.mockRejectedValue(new Error('Network failure'));

      render(<SmartChordsWorkspace ministryId="min-1" />);
      await openEditor();

      await waitFor(() => {
        expect(screen.getByTestId('font-family-select')).toHaveValue('monospace');
      });

      // Changing font still updates UI optimistically without throwing an uncaught error
      expect(() => {
        fireEvent.change(screen.getByTestId('font-family-select'), {
          target: { value: 'Georgia' },
        });
      }).not.toThrow();

      expect(screen.getByTestId('font-family-select')).toHaveValue('Georgia');
    });

    it('10. falls back to monospace when backend or stored font is unsupported', async () => {
      getMe.mockResolvedValue({
        id: 'user-1',
        email: 'user1@example.com',
        name: 'User 1',
        preferences: { chordFontFamily: 'Comic Sans MS' },
      });

      render(<SmartChordsWorkspace ministryId="min-1" />);
      await openEditor();

      await waitFor(() => {
        expect(screen.getByTestId('font-family-select')).toHaveValue('monospace');
      });
    });
  });
  it('keeps saved inline label and progression together in the interactive reader', async () => {
    const content = 'Intro: (riff viol) [ ||: A | A7M | D | % :|| ]';
    getSmartChords.mockResolvedValue([{ id: 'canonical', title: 'Canonical Saved', originalKey: 'A', content }]);
    render(<SmartChordsWorkspace ministryId="min-1" />);
    fireEvent.click(await screen.findByText('Canonical Saved'));
    const row = await screen.findByRole('group', { name: content });
    expect(row.textContent).toBe(content.replace(/[\[\]]/g, ''));
    expect(row).toHaveStyle({ flexWrap: 'nowrap', whiteSpace: 'pre', overflowX: 'auto' });
    expect(row.querySelectorAll('[data-bar-chord-idx]')).toHaveLength(3);
  });

});

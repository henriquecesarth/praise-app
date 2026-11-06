import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { RoutedSmartChords } from './smart-chords/RoutedSmartChords';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
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
    sessionStorage.clear();
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

  describe('M20-C14 Gate 1 navigation', () => {
    const chord = { id: 'route-1', title: 'Can??o da rota', artistName: 'Artista', originalKey: 'C', content: '[C]Texto original', userId: 'u', createdAt: '', updatedAt: '' };
    const NativeRequest = globalThis.Request;
    function mount(path = '/cifras/route-1/editar', initialChordId?: string) {
      // jsdom AbortSignal belongs to a different realm than Node's Request.
      vi.stubGlobal('Request', class extends NativeRequest {
        constructor(input: RequestInfo | URL, init?: RequestInit) { super(input, { ...init, signal: undefined }); }
      });
      const router = createMemoryRouter([{ path: '*', element: <RoutedSmartChords ministryId="min-1" currentUserId="u" initialChordId={initialChordId} /> }], { initialEntries: [path] });
      render(<RouterProvider router={router} />);
      return router;
    }
    beforeEach(() => {
      getSmartChords.mockResolvedValue([chord]);
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      vi.spyOn(window, 'alert').mockImplementation(() => {});
    });
    it('recovers pending metadata and content after refresh within the same user and ministry', async () => {
      sessionStorage.setItem('louvaio_smart_chord_draft:u:min-1:route-1', JSON.stringify(['T?tulo recuperado', '', 'Artista recuperado', 'D', '[D]Rascunho', '', chord.title, true]));
      mount();
      await screen.findByDisplayValue('[D]Rascunho');
      expect(screen.getByDisplayValue('Artista recuperado')).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('Alterações');
      // Recovery updates state asynchronously; wait for its navigation-guard effect to commit.
      await waitFor(() => expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(false));
    });
    it('opens an editor directly from its URL and preserves identity on remount', async () => {
      const router = mount();
      await screen.findByDisplayValue(chord.content);
      expect(router.state.location.pathname).toBe('/cifras/route-1/editar');
      expect(screen.getByDisplayValue(chord.title)).toBeInTheDocument();
    });
    it('cancels internal navigation and context changes for metadata edits, then discards explicitly', async () => {
      const router = mount();
      await screen.findByDisplayValue(chord.content);
      fireEvent.change(screen.getByDisplayValue('Artista'), { target: { value: 'Outro artista' } });
      vi.mocked(window.confirm).mockReturnValue(false);
      fireEvent.click(screen.getByRole('button', { name: /Biblioteca/ }));
      await waitFor(() => expect(router.state.location.pathname).toBe('/cifras/route-1/editar'));
      expect(window.dispatchEvent(new Event('smart-chord-context-change', { cancelable: true }))).toBe(false);
      expect(screen.getByDisplayValue('Outro artista')).toBeInTheDocument();
      vi.mocked(window.confirm).mockReturnValue(true);
      fireEvent.click(screen.getByRole('button', { name: /Biblioteca/ }));
      await waitFor(() => expect(router.state.location.pathname).toBe('/cifras'));
      await router.navigate('/cifras/route-1/editar');
      await screen.findByDisplayValue('Artista');
    });
    it('supports browser back and forward without reusing another draft', async () => {
      const router = mount('/cifras');
      await screen.findByText(chord.title);
      await router.navigate('/cifras/route-1/editar');
      await screen.findByDisplayValue(chord.content);
      await router.navigate(-1);
      await waitFor(() => expect(router.state.location.pathname).toBe('/cifras'));
      await router.navigate(1);
      await screen.findByDisplayValue(chord.content);
    });
    it('does not reopen the editor when a save finishes after returning to the library', async () => {
      let finish!: (value: typeof chord) => void;
      const pending = new Promise<typeof chord>(resolve => { finish = resolve; });
      updateSmartChord.mockReturnValueOnce(pending);
      const router = mount();
      await screen.findByDisplayValue(chord.content);
      fireEvent.change(screen.getByDisplayValue(chord.content), { target: { value: '[D]Salvamento lento' } });
      fireEvent.click(screen.getByRole('button', { name: 'Salvar cifra' }));
      await waitFor(() => expect(updateSmartChord).toHaveBeenCalledOnce());
      fireEvent.click(screen.getByRole('button', { name: /Biblioteca/ }));
      await waitFor(() => expect(router.state.location.pathname).toBe('/cifras'));
      await act(async () => { finish({ ...chord, content: '[D]Salvamento lento' }); await pending; });
      expect(router.state.location.pathname).toBe('/cifras');
      expect(removeSmartChordRepertoireLink).not.toHaveBeenCalled();
    });
    it('preserves typed text and dirty state after save failure', async () => {
      updateSmartChord.mockRejectedValueOnce(new Error('Falha controlada'));
      mount();
      await screen.findByDisplayValue(chord.content);
      fireEvent.change(screen.getByDisplayValue(chord.content), { target: { value: '[D]Texto preservado' } });
      fireEvent.click(screen.getByRole('button', { name: 'Salvar cifra' }));
      await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Falha controlada'));
      expect(screen.getByDisplayValue('[D]Texto preservado')).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('Alterações');
    });
    it('opens repertoire initialChordId through the canonical editor route', async () => {
      const router = mount('/cifras', chord.id);
      await screen.findByDisplayValue(chord.content);
      expect(router.state.location.pathname).toBe('/cifras/route-1/editar');
    });
    it('creates, saves, returns to library and reopens the persisted chord', async () => {
      const saved = { ...chord, id: 'created', title: 'Nova Cifra', artistName: '', content: '[C]Insira a letra e [G]acordes aqui.' };
      createSmartChord.mockImplementation(async () => { getSmartChords.mockResolvedValue([saved]); return saved; });
      const router = mount('/cifras/nova');
      await screen.findByDisplayValue('Nova Cifra');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar cifra' })).not.toBeDisabled());
      fireEvent.click(screen.getByRole('button', { name: 'Salvar cifra' }));
      await waitFor(() => expect(router.state.location.pathname).toBe('/cifras/created/editar'));
      fireEvent.click(screen.getByRole('button', { name: /Biblioteca/ }));
      await waitFor(() => expect(router.state.location.pathname).toBe('/cifras'));
      await router.navigate('/cifras/created/editar');
      await screen.findByDisplayValue(saved.content);
    });
    it('updates and reopens saved content', async () => {
      const saved = { ...chord, content: '[G]Conte?do salvo' };
      updateSmartChord.mockImplementation(async () => { getSmartChords.mockResolvedValue([saved]); return saved; });
      const router = mount();
      await screen.findByDisplayValue(chord.content);
      fireEvent.change(screen.getByDisplayValue(chord.content), { target: { value: saved.content } });
      fireEvent.click(screen.getByRole('button', { name: 'Salvar cifra' }));
      await waitFor(() => expect(updateSmartChord).toHaveBeenCalled());
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Salvo'));
      fireEvent.click(screen.getByRole('button', { name: /Biblioteca/ }));
      await waitFor(() => expect(router.state.location.pathname).toBe('/cifras'));
      await router.navigate('/cifras/route-1/editar');
      await screen.findByDisplayValue(saved.content);
    });
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

      fireEvent.click(screen.getByLabelText('Mais a\u00e7\u00f5es'));
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
      fireEvent.click(screen.getByRole('button', { name: 'Gerar e visualizar PDF' }));

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

    it('applies font family changes made in PDF settings to PDF sheet without altering reading view toolbar (M20-C13)', async () => {
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

      // PDF settings panel is on main screen
      const modalFontSelect = screen.getByTestId('modal-font-family-select') as HTMLSelectElement;
      fireEvent.change(modalFontSelect, { target: { value: 'Georgia' } });

      // Open preview modal to verify PDF sheet
      fireEvent.click(screen.getByRole('button', { name: /Exportar PDF/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Gerar e visualizar PDF' }));

      const pdfContainer = document.querySelector('#printable-sheet-pdf') as HTMLElement;
      expect(pdfContainer.style.fontFamily).toContain('Georgia');

      const closeBtn = screen.getByRole('button', { name: /Fechar/i });
      fireEvent.click(closeBtn);

      // Workspace reading view font remains unchanged
      const toolbarSelect = screen.getByTestId('font-family-select') as HTMLSelectElement;
      expect(toolbarSelect.value).toBe('monospace');
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

      const mockSave = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      URL.createObjectURL = vi.fn(() => 'blob:pagination');
      const worker: any = { prop: { pdf: { internal: { getNumberOfPages: () => 1 }, output: () => new Blob(['pdf']) } } };
      worker.toPdf = () => { const promise: any = Promise.resolve(); promise.get = (key: string) => Promise.resolve(worker.prop[key]); return promise; };
      const mockFrom = vi.fn().mockReturnValue(worker);
      const mockSet = vi.fn().mockReturnValue({ from: mockFrom });
      const mockHtml2pdf = vi.fn().mockReturnValue({ set: mockSet });
      (window as any).html2pdf = mockHtml2pdf;

      render(<SmartChordsWorkspace ministryId="min-1" />);

      await waitFor(() => {
        expect(screen.getByText('Compact PDF Track')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Compact PDF Track'));
      fireEvent.click(screen.getByRole('button', { name: /Exportar PDF/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Gerar e visualizar PDF' }));

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
      await waitFor(() => expect(downloadBtn).not.toBeDisabled());
      fireEvent.click(downloadBtn);

      await waitFor(() => {
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
      mockSave.mockRestore();
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

    it('4. isolates PDF font settings from reading toolbar so configuring PDF preserves reading preference (M20-C13)', async () => {
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

      // PDF selector is in #pdf-settings-panel on main screen, initialized to preference
      const modalSelect = screen.getByTestId('modal-font-family-select') as HTMLSelectElement;
      expect(modalSelect.value).toBe('Arial');

      // Changing font in PDF settings panel
      fireEvent.change(modalSelect, { target: { value: 'Verdana' } });

      const toolbarSelect = screen.getByTestId('font-family-select') as HTMLSelectElement;
      // Reading toolbar remains Arial
      expect(toolbarSelect.value).toBe('Arial');
      // PDF selector is Verdana
      expect(modalSelect.value).toBe('Verdana');

      // User reading preference was not mutated
      expect(updateUserPreferences).not.toHaveBeenCalled();
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
      fireEvent.click(screen.getByRole('button', { name: /Exportar PDF/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Gerar e visualizar PDF' }));

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

  describe('M20-C11 — PDF Line Spacing, 10mm A4 Margins, Real Page Count & Preview/Download Parity', () => {
    it('applies chordLineSpacingPx to PDF sheet lines, eliminates duplicate CSS padding for exact 10mm margins, displays real page count, and reuses in-memory Blob on download', async () => {
      getSmartChords.mockResolvedValue([
        {
          id: 'sc-c11',
          title: 'C11 Fidelity Track',
          originalKey: 'C',
          content: '[C]Primeira linha\n[G]Segunda linha\n[Am]Terceira linha',
        },
      ]);

      const fakeBlob = new Blob(['%PDF-1.4-c11'], { type: 'application/pdf' });
      let currentPages = 2;
      const mockPdfInstance = {
        internal: { getNumberOfPages: () => currentPages },
        output: vi.fn().mockReturnValue(fakeBlob),
      };
      const mockWorker: any = {
        prop: {
          pdf: mockPdfInstance,
          canvas: null,
          pageSize: { inner: { width: 190, height: 277, ratio: 277 / 190 } },
        },
        toPdf: vi.fn().mockImplementation(() => {
          const p: any = Promise.resolve();
          p.get = (key: string) => Promise.resolve(mockWorker.prop[key]);
          return p;
        }),
        save: vi.fn(),
      };
      const mockFrom = vi.fn().mockReturnValue(mockWorker);
      const mockSet = vi.fn().mockReturnValue({ from: mockFrom });
      const mockHtml2pdf = vi.fn().mockReturnValue({ set: mockSet });
      (window as any).html2pdf = mockHtml2pdf;

      const createObjectURLSpy = vi.fn().mockReturnValue('blob:mock-c11-pdf');
      const revokeObjectURLSpy = vi.fn();
      URL.createObjectURL = createObjectURLSpy;
      URL.revokeObjectURL = revokeObjectURLSpy;

      render(<SmartChordsWorkspace ministryId="min-1" />);
      fireEvent.click(await screen.findByText('C11 Fidelity Track'));

      // Adjust spacing in workspace to 16px
      const slider = screen.getByTestId('reading-line-spacing');
      fireEvent.change(slider, { target: { value: '16' } });
      expect(screen.getByTestId('reading-lines')).toHaveStyle({ gap: '16px' });

      // Open PDF preview modal
      fireEvent.click(screen.getByRole('button', { name: /Exportar PDF/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Gerar e visualizar PDF' }));

      const pdfContainer = document.getElementById('printable-sheet-pdf') as HTMLElement;
      expect(pdfContainer).not.toBeNull();
      // Exact 10mm margin via html2pdf without duplicate CSS padding on #printable-sheet-pdf
      expect(pdfContainer.style.padding).toBe('0px');
      expect(pdfContainer.style.width).toBe('190mm');

      const pdfLines = screen.getByTestId('pdf-sheet-lines');
      expect(pdfLines).toHaveStyle({ gap: '16px' });

      // Real page count from jsPDF internal.getNumberOfPages()
      await waitFor(() => {
        expect(screen.getByTestId('pdf-page-count')).toHaveTextContent('PDF • 2 páginas');
      });
      expect(mockHtml2pdf).toHaveBeenCalledTimes(1);

      // Clicking Baixar PDF reuses the already generated in-memory Blob without calling html2pdf again
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      fireEvent.click(screen.getByRole('button', { name: /Baixar PDF/i }));
      await waitFor(() => {
        expect(clickSpy).toHaveBeenCalledTimes(1);
      });
      expect(mockHtml2pdf).toHaveBeenCalledTimes(1);

      // Changing spacing inside modal updates both PDF sheet gap, workspace reading gap, and regenerates preview
      currentPages = 3;
      fireEvent.click(screen.getByRole('button', { name: 'Configura\u00e7\u00f5es' }));
      fireEvent.click(screen.getByTestId('modal-spacing-increase'));
      expect(screen.getByTestId('modal-line-spacing-value')).toHaveTextContent('18px');
      fireEvent.click(screen.getByRole('button', { name: 'Gerar e visualizar PDF' }));
      expect(screen.getByTestId('pdf-sheet-lines')).toHaveStyle({ gap: '18px' });
      expect(screen.getByTestId('reading-lines')).toHaveStyle({ gap: '18px' });

      await waitFor(() => {
        expect(screen.getByTestId('pdf-page-count')).toHaveTextContent('PDF • 3 páginas');
      });
      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-c11-pdf');

      // Closing modal preserves active Blob URL and cached preview for subsequent openings (C13 cache)
      fireEvent.click(screen.getByRole('button', { name: /Fechar/i }));
      expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1);

      clickSpy.mockRestore();
    });
  });

  describe('M20-C12 — Simplified PDF Tone & Custom Marker', () => {
    it('simplifies PDF header to "Tom: {key}", renders custom right-aligned marker, isolates preference per user, and omits marker when empty', async () => {
      localStorage.clear();
      localStorage.setItem('louvaio_last_auth_user_id', 'user-alpha');
      localStorage.setItem('louvaio_pdf_marker_user_user-alpha', 'Min. Infantil IBBP');

      getSmartChords.mockResolvedValue([
        {
          id: 'sc-c12',
          title: 'Canção C12',
          originalKey: 'G',
          content: '[G]Linha um\n[D]Linha dois',
        },
      ]);

      const mockPdfInstance = {
        internal: { getNumberOfPages: () => 1 },
        output: vi.fn().mockReturnValue(new Blob(['%PDF-1.4-c12'], { type: 'application/pdf' })),
      };
      const mockWorker: any = {
        prop: {
          pdf: mockPdfInstance,
          canvas: null,
          pageSize: { inner: { width: 190, height: 277, ratio: 277 / 190 } },
        },
        toPdf: vi.fn().mockImplementation(() => {
          const p: any = Promise.resolve();
          p.get = (key: string) => Promise.resolve(mockWorker.prop[key]);
          return p;
        }),
        save: vi.fn(),
      };
      const mockFrom = vi.fn().mockReturnValue(mockWorker);
      const mockSet = vi.fn().mockReturnValue({ from: mockFrom });
      const mockHtml2pdf = vi.fn().mockReturnValue({ set: mockSet });
      (window as any).html2pdf = mockHtml2pdf;

      const { rerender } = render(<SmartChordsWorkspace ministryId="min-1" currentUserId="user-alpha" />);
      fireEvent.click(await screen.findByText('Canção C12'));

      // 1. Open export modal
      fireEvent.click(screen.getByRole('button', { name: /Exportar PDF/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Gerar e visualizar PDF' }));

      const pdfHeader = document.querySelector('#printable-sheet-pdf .pdf-header') as HTMLElement;
      expect(pdfHeader).not.toBeNull();

      // Verified: Single-row layout - h2 block removed, title is bold 16px in left flex group
      expect(pdfHeader.querySelector('h2')).toBeNull();
      const titleElem = screen.getByTestId('pdf-header-title');
      expect(titleElem).toHaveTextContent('Canção C12');
      expect(titleElem.tagName.toLowerCase()).toBe('strong');
      expect(titleElem.style.fontSize).toBe('16px');
      expect(titleElem.style.fontWeight).toBe('700');
      expect(pdfHeader.style.display).toBe('flex');
      expect(pdfHeader.style.borderBottom).toBe('1px solid rgb(221, 221, 221)');
      expect(pdfHeader.style.paddingBottom).toBe('8px');
      expect(pdfHeader.style.marginBottom).toBe('12px');

      // Verified: "Tom: G" is present, and neither "Tom Original:" nor "Tom Atual:" is in the PDF header
      expect(pdfHeader.textContent).toContain('Tom: G');
      expect(pdfHeader.textContent).not.toContain('Tom Original:');
      expect(pdfHeader.textContent).not.toContain('Tom Atual:');

      // Verified: custom marker loaded from user-alpha preference
      const markerInput = screen.getByTestId('modal-pdf-marker-input') as HTMLInputElement;
      expect(markerInput.value).toBe('Min. Infantil IBBP');

      const markerSpan = screen.getByTestId('pdf-header-custom-marker');
      expect(markerSpan).toHaveTextContent('Min. Infantil IBBP');
      expect(markerSpan.style.textAlign).toBe('right');
      expect(markerSpan.style.marginLeft).toBe('auto');

      // 2. Clear marker: marker span disappears from DOM and occupies zero space
      fireEvent.change(markerInput, { target: { value: '' } });
      expect(screen.queryByTestId('pdf-header-custom-marker')).toBeNull();
      expect(localStorage.getItem('louvaio_pdf_marker_user_user-alpha')).toBe('');

      // 3. Edit marker to custom text
      fireEvent.change(markerInput, { target: { value: 'Coral Jovem' } });
      expect(screen.getByTestId('pdf-header-custom-marker')).toHaveTextContent('Coral Jovem');
      expect(localStorage.getItem('louvaio_pdf_marker_user_user-alpha')).toBe('Coral Jovem');

      // 4. Close modal and transpose by +2 semitones: key becomes A (G -> G# -> A)
      fireEvent.click(screen.getByRole('button', { name: /Fechar/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Transpor um semitom acima' }));
      fireEvent.click(screen.getByRole('button', { name: 'Transpor um semitom acima' }));

      // Reopen modal: PDF header reflects transposed effective key "Tom: A"
      fireEvent.click(screen.getByRole('button', { name: /Exportar PDF/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Gerar e visualizar PDF' }));
      const updatedHeader = document.querySelector('#printable-sheet-pdf .pdf-header') as HTMLElement;
      expect(updatedHeader.textContent).toContain('Tom: A');
      expect(updatedHeader.textContent).not.toContain('Tom: G');

      // 5. User isolation: User Beta has separate marker cache
      localStorage.setItem('louvaio_pdf_marker_user_user-beta', 'Ministério Beta');
      fireEvent.click(screen.getByRole('button', { name: /Fechar/i }));

      rerender(<SmartChordsWorkspace ministryId="min-1" currentUserId="user-beta" />);
      await waitFor(() => expect(getSmartChords).toHaveBeenCalled());
      fireEvent.click(screen.getByRole('button', { name: /Criar Cifra/i }));
      fireEvent.click(screen.getByRole('button', { name: /Exportar PDF/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Gerar e visualizar PDF' }));

      const betaInput = screen.getByTestId('modal-pdf-marker-input') as HTMLInputElement;
      expect(betaInput.value).toBe('Ministério Beta');
      expect(screen.getByTestId('pdf-header-custom-marker')).toHaveTextContent('Ministério Beta');
      // User Alpha preference remains untouched
      expect(localStorage.getItem('louvaio_pdf_marker_user_user-alpha')).toBe('Coral Jovem');
    });

    it('renders single-row PDF header with long title, custom marker and multi-page preview correctly', async () => {
      localStorage.setItem('louvaio_pdf_marker_user_user-gamma', 'Ministério de Louvor e Artes');
      const longTitle = 'Grandes Coisas Fez o Senhor por Nós e por Isso Estamos Alegres';

      getSmartChords.mockResolvedValueOnce([
        {
          id: 'sc-long',
          title: longTitle,
          originalKey: 'D',
          content: '[D]Verso longo de teste com múltiplas páginas\n[A]Refrão longo\n[G]Ponte com acordes estendidos',
        },
      ]);

      const mockPdfInstance = {
        internal: { getNumberOfPages: () => 2 },
        output: vi.fn().mockReturnValue(new Blob(['%PDF-1.4-long'], { type: 'application/pdf' })),
      };
      const mockWorker: any = {
        prop: {
          pdf: mockPdfInstance,
          canvas: null,
          pageSize: { inner: { width: 190, height: 277, ratio: 277 / 190 } },
        },
        toPdf: vi.fn().mockImplementation(() => {
          const p: any = Promise.resolve();
          p.get = (key: string) => Promise.resolve(mockWorker.prop[key]);
          return p;
        }),
        save: vi.fn(),
      };
      const mockFrom = vi.fn().mockReturnValue(mockWorker);
      const mockSet = vi.fn().mockReturnValue({ from: mockFrom });
      const mockHtml2pdf = vi.fn().mockReturnValue({ set: mockSet });
      (window as any).html2pdf = mockHtml2pdf;

      render(<SmartChordsWorkspace ministryId="min-1" currentUserId="user-gamma" />);
      fireEvent.click(await screen.findByText(longTitle));

      // Open PDF export modal
      fireEvent.click(screen.getByRole('button', { name: /Exportar PDF/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Gerar e visualizar PDF' }));

      const pdfHeader = document.querySelector('#printable-sheet-pdf .pdf-header') as HTMLElement;
      expect(pdfHeader).not.toBeNull();

      // Verify single horizontal line layout
      expect(pdfHeader.querySelector('h2')).toBeNull();
      const titleElem = screen.getByTestId('pdf-header-title');
      expect(titleElem).toHaveTextContent(longTitle);
      expect(titleElem.style.fontSize).toBe('16px');
      expect(titleElem.style.fontWeight).toBe('700');

      // Verify discrete border and reduced vertical spacing (saving ~45px)
      expect(pdfHeader.style.borderBottom).toBe('1px solid rgb(221, 221, 221)');
      expect(pdfHeader.style.paddingBottom).toBe('8px');
      expect(pdfHeader.style.marginBottom).toBe('12px');

      // Verify title, artist, effective key in left group and marker on the right
      expect(pdfHeader.textContent).toContain('Artista:');
      expect(pdfHeader.textContent).toContain('Tom: D');

      const markerSpan = screen.getByTestId('pdf-header-custom-marker');
      expect(markerSpan).toHaveTextContent('Ministério de Louvor e Artes');
      expect(markerSpan.style.textAlign).toBe('right');
      expect(markerSpan.style.marginLeft).toBe('auto');

      // Verify multi-page badge
      expect(await screen.findByTestId('pdf-page-count')).toHaveTextContent('2 páginas');
    });

    function setupDemandPdf() {
      const blob = new Blob(['%PDF-test'], { type: 'application/pdf' });
      const pdf = { internal: { getNumberOfPages: () => 2 }, output: vi.fn(() => blob) };
      const worker: any = { prop: { pdf, canvas: null, pageSize: { inner: { width: 190, height: 277, ratio: 277 / 190 } } } };
      worker.toPdf = vi.fn(() => { const promise: any = Promise.resolve(); promise.get = (key: string) => Promise.resolve(worker.prop[key]); return promise; });
      const engine = vi.fn(() => ({ set: vi.fn(() => ({ from: vi.fn(() => worker) })) }));
      (window as any).html2pdf = engine;
      URL.createObjectURL = vi.fn(() => 'blob:on-demand'); URL.revokeObjectURL = vi.fn();
      getSmartChords.mockResolvedValue([{ id: 'demand', title: 'Sob demanda', originalKey: 'C', content: '[C]Linha de teste' }]);
      return { engine, blob, pdf, worker };
    }
    async function openDemand() {
      fireEvent.click(await screen.findByText('Sob demanda'));
      fireEvent.click(screen.getByRole('button', { name: 'Exportar PDF' }));
    }
    async function generateDemand() {
      fireEvent.click(screen.getByRole('button', { name: 'Gerar e visualizar PDF' }));
      await waitFor(() => expect(screen.getByTestId('pdf-page-count')).toHaveTextContent('2 p\u00e1ginas'));
    }
    it('updates rapid size and spacing controls immediately without generating until confirmation', async () => {
      const { engine } = setupDemandPdf();
      render(<SmartChordsWorkspace ministryId="min-1" currentUserId="demand-user" />);
      await openDemand();
      for (let n = 0; n < 5; n++) fireEvent.click(screen.getByTestId('modal-font-size-increase'));
      fireEvent.click(screen.getByTestId('modal-spacing-increase'));
      expect(screen.getByTestId('modal-font-size-value')).toHaveTextContent('18px');
      expect(screen.getByTestId('modal-line-spacing-value')).toHaveTextContent('2px');
      expect(engine).not.toHaveBeenCalled();
      await generateDemand();
      expect(engine).toHaveBeenCalledTimes(1);
    });
    it('keeps a long marker intact, returns to settings and reuses unchanged Blob for download', async () => {
      const { engine, blob } = setupDemandPdf();
      render(<SmartChordsWorkspace ministryId="min-1" currentUserId="demand-user" />);
      await openDemand();
      const marker = 'Ensaio do minist?rio '.repeat(30);
      fireEvent.change(screen.getByTestId('modal-pdf-marker-input'), { target: { value: marker } });
      expect(screen.getByTestId('modal-pdf-marker-input')).toHaveValue(marker);
      expect(engine).not.toHaveBeenCalled();
      await generateDemand();
      fireEvent.click(screen.getByRole('button', { name: 'Configura\u00e7\u00f5es' }));
      expect(screen.getByTestId('modal-pdf-marker-input')).toHaveValue(marker);
      await generateDemand();
      expect(engine).toHaveBeenCalledTimes(1);
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      fireEvent.click(screen.getByRole('button', { name: 'Baixar PDF' }));
      expect(click).toHaveBeenCalledOnce();
      expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
      expect(engine).toHaveBeenCalledTimes(1);
      click.mockRestore();
    });
    it('does not publish a late PDF result after switching authenticated context', async () => {
      const { worker, pdf } = setupDemandPdf();
      let finish!: () => void;
      const pending: any = new Promise<void>(resolve => { finish = resolve; });
      pending.get = (key: string) => Promise.resolve(worker.prop[key]);
      worker.toPdf.mockReturnValueOnce(pending);
      const { rerender } = render(<SmartChordsWorkspace ministryId="min-1" currentUserId="u1" />);
      await openDemand();
      fireEvent.click(screen.getByRole('button', { name: 'Gerar e visualizar PDF' }));
      await waitFor(() => expect(worker.toPdf).toHaveBeenCalledOnce());
      rerender(<SmartChordsWorkspace ministryId="min-2" currentUserId="u2" />);
      finish();
      await waitFor(() => expect(pdf.output).toHaveBeenCalled());
      expect(URL.createObjectURL).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Baixar PDF' })).toBeNull();
    });
    it('shows generation errors and retries only after another explicit command', async () => {
      const { engine } = setupDemandPdf();
      engine.mockImplementationOnce(() => { throw new Error('Engine failed'); });
      render(<SmartChordsWorkspace ministryId="min-1" />);
      await openDemand();
      fireEvent.click(screen.getByRole('button', { name: 'Gerar e visualizar PDF' }));
      await screen.findByRole('alert');
      expect(screen.getByRole('button', { name: 'Baixar PDF' })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Configura\u00e7\u00f5es' }));
      expect(engine).toHaveBeenCalledTimes(1);
      await generateDemand();
      expect(engine).toHaveBeenCalledTimes(2);
    });
    it('cancels settings without generating and preserves document text across modes', async () => {
      const { engine } = setupDemandPdf();
      render(<SmartChordsWorkspace ministryId="min-1" />);
      await openDemand();
      fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
      fireEvent.click(screen.getByRole('button', { name: 'Visualizar' }));
      fireEvent.click(screen.getByRole('button', { name: 'Exportar PDF' }));
      expect(screen.getByRole('dialog', { name: 'Exportar PDF' })).toBeInTheDocument();
      expect(engine).not.toHaveBeenCalled();
    });
    it('invalidates cached content and transposition and blocks stale downloads after context changes', async () => {
      const { engine } = setupDemandPdf();
      const { rerender } = render(<SmartChordsWorkspace ministryId="min-1" currentUserId="u1" />);
      await openDemand(); await generateDemand();
      fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
      fireEvent.change(screen.getByDisplayValue('[C]Linha de teste'), { target: { value: '[D]Texto novo' } });
      fireEvent.click(screen.getByRole('button', { name: 'Exportar PDF' }));
      await generateDemand();
      expect(engine).toHaveBeenCalledTimes(2);
      fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
      fireEvent.click(screen.getByRole('button', { name: 'Transpor um semitom acima' }));
      fireEvent.click(screen.getByRole('button', { name: 'Exportar PDF' }));
      await generateDemand();
      expect(engine).toHaveBeenCalledTimes(3);
      rerender(<SmartChordsWorkspace ministryId="min-2" currentUserId="u2" />);
      expect(screen.queryByRole('button', { name: 'Baixar PDF' })).toBeNull();
      expect(URL.revokeObjectURL).toHaveBeenCalled();
    });
  });


  describe('M20-C13 — Separar Configuração e Pré-visualização do PDF', () => {
    it('renders #pdf-settings-panel on the main screen with all 4 controls and allows toggling', async () => {
      localStorage.clear();
      getSmartChords.mockResolvedValueOnce([
        { id: 'sc-c13-panel', title: 'Painel C13', originalKey: 'G', content: '[G]Linha [D]um' }
      ]);

      render(<SmartChordsWorkspace ministryId="min-1" currentUserId="user-c13" />);
      fireEvent.click(await screen.findByText('Painel C13'));

      fireEvent.click(screen.getByTestId('toggle-pdf-settings'));
      // Panel opens on explicit request
      const panel = screen.getByTestId('pdf-settings-panel');
      expect(panel).toBeInTheDocument();

      // All 4 controls are present in panel
      expect(screen.getByTestId('modal-font-family-select')).toBeInTheDocument();
      expect(screen.getByTestId('modal-font-size-value')).toHaveTextContent('13px');
      expect(screen.getByTestId('modal-line-spacing-value')).toHaveTextContent('0px');
      expect(screen.getByTestId('modal-pdf-marker-input')).toBeInTheDocument();

      // Toggle button collapses and expands panel
      const toggleBtn = screen.getByTestId('toggle-pdf-settings');
      fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
      expect(screen.getByTestId('pdf-settings-panel')).not.toBeVisible();

      fireEvent.click(toggleBtn);
      expect(screen.getByTestId('pdf-settings-panel')).toBeInTheDocument();
    });

    it('executes 0 calls to html2pdf while adjusting controls in the settings panel', async () => {
      localStorage.clear();
      getSmartChords.mockResolvedValueOnce([
        { id: 'sc-c13-resp', title: 'Zero Html2pdf', originalKey: 'C', content: '[C]Acorde' }
      ]);

      const mockHtml2pdf = vi.fn();
      (window as any).html2pdf = mockHtml2pdf;

      render(<SmartChordsWorkspace ministryId="min-1" currentUserId="user-c13-resp" />);
      fireEvent.click(await screen.findByText('Zero Html2pdf'));

      // 1. Rapidly change font size
      const incBtn = screen.getByTestId('modal-font-size-increase');
      fireEvent.click(incBtn);
      fireEvent.click(incBtn);
      fireEvent.click(incBtn);
      expect(screen.getByTestId('modal-font-size-value')).toHaveTextContent('16px');

      // 2. Type in marker input
      const markerInput = screen.getByTestId('modal-pdf-marker-input');
      fireEvent.change(markerInput, { target: { value: 'Min. Louvor' } });
      expect(markerInput).toHaveValue('Min. Louvor');

      // 3. Change line spacing
      const spacingInc = screen.getByTestId('modal-spacing-increase');
      fireEvent.click(spacingInc);
      expect(screen.getByTestId('modal-line-spacing-value')).toHaveTextContent('2px');

      // 4. Change font family
      const fontSelect = screen.getByTestId('modal-font-family-select');
      fireEvent.change(fontSelect, { target: { value: 'Verdana' } });

      // ZERO calls to html2pdf occurred during any of these interactions
      expect(mockHtml2pdf).toHaveBeenCalledTimes(0);
    });

    it('simplifies modal by removing all 4 configuration controls and keeping only preview and download actions', async () => {
      localStorage.clear();
      getSmartChords.mockResolvedValueOnce([
        { id: 'sc-c13-modal', title: 'Modal Limpo', originalKey: 'A', content: '[A]Acorde simples' }
      ]);

      const mockPdfInstance = { internal: { getNumberOfPages: () => 1 }, output: vi.fn().mockReturnValue(new Blob(['%PDF-1.4'])) };
      const mockWorker: any = {
        prop: { pdf: mockPdfInstance, canvas: null, pageSize: { inner: { width: 190, height: 277, ratio: 277 / 190 } } },
        toPdf: vi.fn().mockImplementation(() => {
          const p: any = Promise.resolve();
          p.get = (key: string) => Promise.resolve(mockWorker.prop[key]);
          return p;
        }),
      };
      (window as any).html2pdf = vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue(mockWorker) }) });

      render(<SmartChordsWorkspace ministryId="min-1" currentUserId="user-c13-modal" />);
      fireEvent.click(await screen.findByText('Modal Limpo'));

      // Open modal
      fireEvent.click(screen.getByRole('button', { name: /Exportar PDF/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Gerar e visualizar PDF' }));

      await waitFor(() => {
        expect(screen.getByTestId('pdf-page-count')).toHaveTextContent('PDF • 1 página');
      });

      // Inside modal, NONE of the 4 configuration controls exist
      const modalElement = document.querySelector('.smart-chords-pdf-modal') as HTMLElement;
      expect(modalElement).toBeInTheDocument();
      expect(modalElement.querySelector('[data-testid="modal-font-family-select"]')).toBeNull();
      expect(modalElement.querySelector('[data-testid="modal-font-size-increase"]')).toBeNull();
      expect(modalElement.querySelector('[data-testid="modal-spacing-increase"]')).toBeNull();
      expect(modalElement.querySelector('[data-testid="modal-pdf-marker-input"]')).toBeNull();

      // Only title, page count badge, download button and close button exist
      expect(modalElement.querySelector('#pdf-preview-title')).toHaveTextContent('Pré-visualização do PDF');
      expect(modalElement.querySelector('[data-testid="pdf-page-count"]')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Baixar PDF/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Fechar/i })).toBeInTheDocument();
    });

    it('reuses cached Blob on closing and reopening modal without changes with zero extra html2pdf calls', async () => {
      localStorage.clear();
      getSmartChords.mockResolvedValueOnce([
        { id: 'sc-c13-cache', title: 'Cache Test', originalKey: 'F', content: '[F]Acorde' }
      ]);

      const mockPdfInstance = { internal: { getNumberOfPages: () => 1 }, output: vi.fn().mockReturnValue(new Blob(['%PDF-1.4-cached'])) };
      const mockWorker: any = {
        prop: { pdf: mockPdfInstance, canvas: null, pageSize: { inner: { width: 190, height: 277, ratio: 277 / 190 } } },
        toPdf: vi.fn().mockImplementation(() => {
          const p: any = Promise.resolve();
          p.get = (key: string) => Promise.resolve(mockWorker.prop[key]);
          return p;
        }),
      };
      const mockHtml2pdf = vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue(mockWorker) }) });
      (window as any).html2pdf = mockHtml2pdf;

      render(<SmartChordsWorkspace ministryId="min-1" currentUserId="user-c13-cache" />);
      fireEvent.click(await screen.findByText('Cache Test'));

      // 1. First modal open -> generates PDF
      fireEvent.click(screen.getByRole('button', { name: /Exportar PDF/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Gerar e visualizar PDF' }));
      await waitFor(() => {
        expect(screen.getByTestId('pdf-page-count')).toHaveTextContent('PDF • 1 página');
      });
      expect(mockHtml2pdf).toHaveBeenCalledTimes(1);

      // 2. Close modal
      fireEvent.click(screen.getByRole('button', { name: /Fechar/i }));
      expect(screen.queryByTestId('pdf-preview-title')).toBeNull();

      // 3. Reopen modal without changing anything -> reuses cache with 0 extra calls
      fireEvent.click(screen.getByRole('button', { name: /Exportar PDF/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Gerar e visualizar PDF' }));
      expect(screen.getByTestId('pdf-page-count')).toHaveTextContent('PDF • 1 página');
      expect(mockHtml2pdf).toHaveBeenCalledTimes(1);

      // 4. Download PDF reuses identical cached blob
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-cache-download');
      fireEvent.click(screen.getByRole('button', { name: /Baixar PDF/i }));

      await waitFor(() => {
        expect(clickSpy).toHaveBeenCalledTimes(1);
      });
      expect(mockHtml2pdf).toHaveBeenCalledTimes(1);
      clickSpy.mockRestore();
    });

    it('does not alter normal reading font or font size when adjusting PDF settings', async () => {
      localStorage.clear();
      getSmartChords.mockResolvedValueOnce([
        { id: 'sc-c13-isolation', title: 'Isolamento', originalKey: 'D', content: '[D]Verso [A]dois' }
      ]);

      render(<SmartChordsWorkspace ministryId="min-1" currentUserId="user-c13-iso" />);
      fireEvent.click(await screen.findByText('Isolamento'));

      // Initial reading font & font size
      const readingFontSelect = screen.getByTestId('font-family-select') as HTMLSelectElement;
      expect(readingFontSelect.value).toBe('monospace');

      // Adjust PDF font and PDF size in the PDF settings panel
      const pdfFontSelect = screen.getByTestId('modal-font-family-select') as HTMLSelectElement;
      fireEvent.change(pdfFontSelect, { target: { value: 'Times New Roman' } });

      const pdfSizeInc = screen.getByTestId('modal-font-size-increase');
      fireEvent.click(pdfSizeInc);
      fireEvent.click(pdfSizeInc);
      expect(screen.getByTestId('modal-font-size-value')).toHaveTextContent('15px');

      // Reading view font and size remain completely untouched
      expect(readingFontSelect.value).toBe('monospace');
      expect(screen.getByText('13px')).toBeInTheDocument(); // reading font size remains 13px
    });
  });

  it('R12 ignores older search results arriving after the latest query', async () => {
    render(<SmartChordsWorkspace ministryId="m1" currentUserId="user-default" />);
    await waitFor(() => expect(getSmartChords).toHaveBeenCalled());
    let release!: (value: unknown[]) => void;
    getSmartChords.mockImplementation((_ministry: string, query: string) => query === 'old' ? new Promise(resolve => { release = resolve; }) : Promise.resolve([{ id: 'latest', title: 'Latest result', originalKey: 'C', content: '[C]text' }]));
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar cifra' }), { target: { value: 'old' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar cifra' }), { target: { value: 'new' } });
    await screen.findByText('Latest result');
    await act(async () => { release([{ id: 'stale', title: 'Stale result', originalKey: 'C', content: '[C]old' }]); });
    expect(screen.getByText('Latest result')).toBeInTheDocument();
    expect(screen.queryByText('Stale result')).not.toBeInTheDocument();
  });
  it('R12 tolerates malformed encoded chord routes', async () => {
    getSmartChords.mockResolvedValue([{ id: 'valid', title: 'Valid', originalKey: 'C', content: '[C]text' }]);
    render(<SmartChordsWorkspace ministryId="m1" currentUserId="user-default" routePath="/cifras/%E0%A4%A/editar" />);
    await waitFor(() => expect(getSmartChords).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('textbox', { name: 'Buscar cifra' })).toBeInTheDocument();
  });
});

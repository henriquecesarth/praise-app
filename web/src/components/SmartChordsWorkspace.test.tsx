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
  },
}));

describe('SmartChordsWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getArtists.mockResolvedValue([]);
    getSongs.mockResolvedValue({ songs: [], totalCount: 0 });
    getSmartChords.mockResolvedValue([]);
    createSmartChord.mockResolvedValue({ id: 'new-1', title: 'Nova Cifra' });
    updateSmartChord.mockResolvedValue({ id: 'c-1', title: 'Atualizada' });
    deleteSmartChord.mockResolvedValue(undefined);
    getSmartChordRepertoireLink.mockResolvedValue({ link: null, song: null });
    setSmartChordRepertoireLink.mockResolvedValue({ link: null, song: null });
    removeSmartChordRepertoireLink.mockResolvedValue(undefined);
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
});

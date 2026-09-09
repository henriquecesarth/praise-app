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
} = vi.hoisted(() => ({
  getArtists: vi.fn(),
  getSongs: vi.fn(),
  getSmartChords: vi.fn(),
  createSmartChord: vi.fn(),
  updateSmartChord: vi.fn(),
  deleteSmartChord: vi.fn(),
}));

vi.mock('../api', () => ({
  api: {
    getArtists,
    getSongs,
    getSmartChords,
    createSmartChord,
    updateSmartChord,
    deleteSmartChord,
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
});

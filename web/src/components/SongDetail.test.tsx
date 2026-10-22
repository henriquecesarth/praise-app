import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SongDetail } from './SongDetail';
import { Song, SmartChord } from '../types';

const {
  getMySmartChordsForSong,
  getSmartChords,
  setSmartChordRepertoireLink,
  removeSmartChordRepertoireLink,
} = vi.hoisted(() => ({
  getMySmartChordsForSong: vi.fn(),
  getSmartChords: vi.fn(),
  setSmartChordRepertoireLink: vi.fn(),
  removeSmartChordRepertoireLink: vi.fn(),
}));

vi.mock('../api', () => ({
  api: {
    getMySmartChordsForSong,
    getSmartChords,
    setSmartChordRepertoireLink,
    removeSmartChordRepertoireLink,
  },
}));

describe('SongDetail Web Repertoire <-> Smart Chords Integration', () => {
  const mockSong: Song = {
    id: 'song-123',
    ministryId: 'min-1',
    title: 'Graça Admirável',
    artist: 'John Newton',
    versions: [
      {
        id: 'v1',
        name: 'Original',
        key: 'G',
        classificationIds: [],
        links: [],
      },
    ],
  };

  const mockChord1: SmartChord = {
    id: 'chord-1',
    userId: 'user-1',
    artistId: null,
    songId: null,
    title: 'Graça Admirável (Violão)',
    originalKey: 'G',
    content: '[G]Graça admirável [C]que salvou',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-02',
  };

  const mockChord2: SmartChord = {
    id: 'chord-2',
    userId: 'user-1',
    artistId: null,
    songId: null,
    title: 'Graça Admirável (Tom Baixo)',
    originalKey: 'D',
    content: '[D]Graça admirável [G]que salvou',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-03',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getMySmartChordsForSong.mockResolvedValue([]);
    getSmartChords.mockResolvedValue([]);
    setSmartChordRepertoireLink.mockResolvedValue({ link: { id: 'link-1' }, song: null });
    removeSmartChordRepertoireLink.mockResolvedValue(undefined);
  });

  it('fetches authenticated user linked smart chords on mount using active ministry and song id', async () => {
    getMySmartChordsForSong.mockResolvedValue([mockChord1]);

    render(
      <SongDetail
        song={mockSong}
        ministryId="min-1"
        onBack={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(getMySmartChordsForSong).toHaveBeenCalledWith('min-1', 'song-123');
    });

    expect(await screen.findByText(/Graça admirável/)).toBeInTheDocument();
  });

  it('renders linked personal Smart Chords even if song.smartChord is undefined', async () => {
    getMySmartChordsForSong.mockResolvedValue([mockChord1]);

    render(
      <SongDetail
        song={{ ...mockSong, smartChord: undefined }}
        ministryId="min-1"
        onBack={vi.fn()}
      />
    );

    expect(await screen.findByText('Cifra Inteligente')).toBeInTheDocument();
    expect(await screen.findByText(/Graça admirável/)).toBeInTheDocument();
  });

  it('supports multiple personal Smart Chords linked to the same Song and switching between them', async () => {
    getMySmartChordsForSong.mockResolvedValue([mockChord1, mockChord2]);

    render(
      <SongDetail
        song={mockSong}
        ministryId="min-1"
        onBack={vi.fn()}
      />
    );

    expect(await screen.findByText(/Graça Admirável \(Violão\)/)).toBeInTheDocument();
    expect(screen.getByText(/Graça Admirável \(Tom Baixo\)/)).toBeInTheDocument();

    // Default active is chord 1 (key G)
    expect(screen.getByText('Tom Original:')).toBeInTheDocument();

    // Switch to chord 2
    fireEvent.click(screen.getByText(/Graça Admirável \(Tom Baixo\)/));

    // Now chord 2 content and key D should be active
    await waitFor(() => {
      expect(screen.getByText('D')).toBeInTheDocument();
    });
  });

  it('calls onOpenSmartChord when clicking Abrir no Cifrador', async () => {
    getMySmartChordsForSong.mockResolvedValue([mockChord1]);
    const onOpenSmartChord = vi.fn();

    render(
      <SongDetail
        song={mockSong}
        ministryId="min-1"
        onBack={vi.fn()}
        onOpenSmartChord={onOpenSmartChord}
      />
    );

    const openBtn = await screen.findByRole('button', { name: /abrir no cifrador/i });
    fireEvent.click(openBtn);

    expect(onOpenSmartChord).toHaveBeenCalledWith('chord-1');
  });

  it('opens link modal, lists user personal chords and confirms link via api.setSmartChordRepertoireLink', async () => {
    getMySmartChordsForSong.mockResolvedValue([]);
    getSmartChords.mockResolvedValue([mockChord1]);

    render(
      <SongDetail
        song={mockSong}
        ministryId="min-1"
        onBack={vi.fn()}
      />
    );

    const linkBtn = await screen.findByRole('button', { name: /vincular cifra/i });
    fireEvent.click(linkBtn);

    // Modal opens and fetches personal smart chords
    await waitFor(() => {
      expect(getSmartChords).toHaveBeenCalledWith('min-1');
    });

    expect(screen.getByText('Vincular Cifra Inteligente')).toBeInTheDocument();
    expect(screen.getByText('Graça Admirável (Violão)')).toBeInTheDocument();

    // Select the chord in the list
    fireEvent.click(screen.getByText('Graça Admirável (Violão)'));

    // Confirm link
    const confirmBtn = screen.getByRole('button', { name: /confirmar vínculo/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(setSmartChordRepertoireLink).toHaveBeenCalledWith('min-1', 'chord-1', 'song-123');
    });

    // After success, refreshed list
    await waitFor(() => {
      expect(getMySmartChordsForSong).toHaveBeenCalledTimes(2);
    });
  });

  it('displays error in modal if linking fails and does not close modal or corrupt chord', async () => {
    getMySmartChordsForSong.mockResolvedValue([]);
    getSmartChords.mockResolvedValue([mockChord1]);
    setSmartChordRepertoireLink.mockRejectedValue(new Error('Erro de permissão ou rede'));

    render(
      <SongDetail
        song={mockSong}
        ministryId="min-1"
        onBack={vi.fn()}
      />
    );

    const linkBtn = await screen.findByRole('button', { name: /vincular cifra/i });
    fireEvent.click(linkBtn);

    await waitFor(() => {
      expect(getSmartChords).toHaveBeenCalledWith('min-1');
    });

    fireEvent.click(screen.getByText('Graça Admirável (Violão)'));
    const confirmBtn = screen.getByRole('button', { name: /confirmar vínculo/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByText(/Erro de permissão ou rede/)).toBeInTheDocument();
    });

    // Modal remains open
    expect(screen.getByText('Vincular Cifra Inteligente')).toBeInTheDocument();
  });

  it('unlinks active chord via api.removeSmartChordRepertoireLink and refreshes', async () => {
    getMySmartChordsForSong.mockResolvedValue([mockChord1]);

    render(
      <SongDetail
        song={mockSong}
        ministryId="min-1"
        onBack={vi.fn()}
      />
    );

    const unlinkBtn = await screen.findByRole('button', { name: /desvincular/i });
    fireEvent.click(unlinkBtn);

    await waitFor(() => {
      expect(removeSmartChordRepertoireLink).toHaveBeenCalledWith('min-1', 'chord-1');
    });

    await waitFor(() => {
      expect(getMySmartChordsForSong).toHaveBeenCalledTimes(2);
    });
  });

  it('displays error banner with Tentar novamente when loading linked chords fails', async () => {
    getMySmartChordsForSong.mockRejectedValueOnce(new Error('Falha de conexão com o servidor'));

    render(
      <SongDetail
        song={mockSong}
        ministryId="min-1"
        onBack={vi.fn()}
      />
    );

    expect(await screen.findByText(/Falha de conexão com o servidor/)).toBeInTheDocument();
    const retryBtn = screen.getByRole('button', { name: /tentar novamente/i });

    getMySmartChordsForSong.mockResolvedValueOnce([mockChord1]);
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(getMySmartChordsForSong).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText(/Graça admirável/)).toBeInTheDocument();
  });

  it('fences against stale async responses when switching ministries', async () => {
    let resolveFirst: (val: any) => void;
    const firstPromise = new Promise((resolve) => {
      resolveFirst = resolve;
    });

    getMySmartChordsForSong.mockReturnValueOnce(firstPromise);

    const { rerender } = render(
      <SongDetail
        song={mockSong}
        ministryId="min-alpha"
        onBack={vi.fn()}
      />
    );

    getMySmartChordsForSong.mockResolvedValueOnce([mockChord2]);
    rerender(
      <SongDetail
        song={mockSong}
        ministryId="min-beta"
        onBack={vi.fn()}
      />
    );

    // Resolve the first request after the switch
    resolveFirst!([mockChord1]);

    await waitFor(() => {
      expect(screen.getByText('Tom Original:')).toBeInTheDocument();
      const originalKeyEl = screen.getByText('Tom Original:').parentElement;
      expect(originalKeyEl).toHaveTextContent('D');
      expect(originalKeyEl).not.toHaveTextContent('G');
    });
  });
});

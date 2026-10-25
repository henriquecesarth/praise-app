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
    localStorage.setItem('praise_auth_token', 'test-auth-token');
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
      expect(screen.getAllByText('D')[0]).toBeInTheDocument();
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

  describe('F01 — HIGH: Legacy privacy fallback', () => {
    it('never renders legacy song.smartChord when getMySmartChordsForSong returns empty response', async () => {
      const songWithLegacyChord: Song = {
        ...mockSong,
        smartChord: {
          id: 'legacy-foreign-chord',
          originalKey: 'F#',
          content: '[F#]Legacy Foreign Chord [B]Private Content',
        },
      };

      getMySmartChordsForSong.mockResolvedValue([]);

      render(
        <SongDetail
          song={songWithLegacyChord}
          ministryId="min-1"
          onBack={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(getMySmartChordsForSong).toHaveBeenCalledWith('min-1', 'song-123');
      });

      // Must NOT render foreign chord content or key F#
      expect(screen.queryByText(/Legacy Foreign Chord/)).not.toBeInTheDocument();
      expect(screen.queryByText('F#')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^cifra inteligente$/i })).not.toBeInTheDocument();
    });

    it('never renders legacy song.smartChord when getMySmartChordsForSong fails with an error', async () => {
      const songWithLegacyChord: Song = {
        ...mockSong,
        smartChord: {
          id: 'legacy-foreign-chord',
          originalKey: 'F#',
          content: '[F#]Legacy Foreign Chord [B]Private Content',
        },
      };

      getMySmartChordsForSong.mockRejectedValue(new Error('Network error'));

      render(
        <SongDetail
          song={songWithLegacyChord}
          ministryId="min-1"
          onBack={vi.fn()}
        />
      );

      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(screen.queryByText(/Legacy Foreign Chord/)).not.toBeInTheDocument();
      expect(screen.queryByText('F#')).not.toBeInTheDocument();
    });
  });

  describe('F02 — Stale context across ministries', () => {
    it('immediately invalidates loaded chord data and unlinking action upon ministry switch', async () => {
      getMySmartChordsForSong.mockResolvedValueOnce([mockChord1]);

      const { rerender } = render(
        <SongDetail
          song={mockSong}
          ministryId="min-alpha"
          onBack={vi.fn()}
        />
      );

      expect(await screen.findByText(/Graça admirável/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /desvincular/i })).toBeInTheDocument();

      // Pending promise for ministry beta
      let resolveBeta: (val: any) => void;
      const betaPromise = new Promise((resolve) => {
        resolveBeta = resolve;
      });
      getMySmartChordsForSong.mockReturnValueOnce(betaPromise);

      rerender(
        <SongDetail
          song={mockSong}
          ministryId="min-beta"
          onBack={vi.fn()}
        />
      );

      // Previous chord from min-alpha must be cleared immediately, not displayed while loading
      expect(screen.queryByText(/Graça admirável/)).not.toBeInTheDocument();
      // Desvincular button must NOT be present or active for the old chord
      expect(screen.queryByRole('button', { name: /desvincular/i })).not.toBeInTheDocument();

      resolveBeta!([]);
      await waitFor(() => {
        expect(screen.queryByText(/Graça admirável/)).not.toBeInTheDocument();
      });
    });
  });

  describe('F03 — Stale linking modal', () => {
    it('resets modal state when song changes to prevent linking chord to unintended song', async () => {
      getMySmartChordsForSong.mockResolvedValue([]);
      getSmartChords.mockResolvedValue([mockChord1]);

      const { rerender } = render(
        <SongDetail
          song={mockSong}
          ministryId="min-1"
          onBack={vi.fn()}
        />
      );

      // Open link modal
      const linkBtn = await screen.findByRole('button', { name: /vincular cifra/i });
      fireEvent.click(linkBtn);

      await waitFor(() => {
        expect(screen.getByText('Vincular Cifra Inteligente')).toBeInTheDocument();
      });

      // Select chord1
      fireEvent.click(screen.getByText('Graça Admirável (Violão)'));

      // Switch song
      const song2: Song = {
        ...mockSong,
        id: 'song-456',
        title: 'Outra Música',
      };

      rerender(
        <SongDetail
          song={song2}
          ministryId="min-1"
          onBack={vi.fn()}
        />
      );

      // Modal must be closed and state reset
      expect(screen.queryByText('Vincular Cifra Inteligente')).not.toBeInTheDocument();
    });
  });

  describe('R2-01 — Stale pending operations', () => {
    it('does not leave isLinking active in new song when linking was pending in previous song', async () => {
      getMySmartChordsForSong.mockResolvedValue([]);
      getSmartChords.mockResolvedValue([mockChord1]);

      let resolveLinkA: (val: any) => void;
      const linkPromiseA = new Promise((resolve) => {
        resolveLinkA = resolve;
      });
      setSmartChordRepertoireLink.mockReturnValueOnce(linkPromiseA);

      const { rerender } = render(
        <SongDetail
          song={mockSong}
          ministryId="min-1"
          onBack={vi.fn()}
        />
      );

      // Open link modal in Song A
      const linkBtnA = await screen.findByRole('button', { name: /vincular cifra/i });
      fireEvent.click(linkBtnA);

      await waitFor(() => {
        expect(screen.getByText('Vincular Cifra Inteligente')).toBeInTheDocument();
      });

      // Select chord1 and confirm link in Song A
      fireEvent.click(screen.getByText('Graça Admirável (Violão)'));
      const confirmBtnA = screen.getByRole('button', { name: /confirmar vínculo/i });
      fireEvent.click(confirmBtnA);

      // Song A has isLinking = true
      expect(screen.getByText('Vinculando...')).toBeInTheDocument();

      // User switches to Song B while link is still in-flight
      const songB: Song = {
        ...mockSong,
        id: 'song-456',
        title: 'Segunda Música',
      };

      rerender(
        <SongDetail
          song={songB}
          ministryId="min-1"
          onBack={vi.fn()}
        />
      );

      // Open link modal in Song B
      const linkBtnB = await screen.findByRole('button', { name: /vincular cifra/i });
      fireEvent.click(linkBtnB);

      await waitFor(() => {
        expect(screen.getByText('Vincular Cifra Inteligente')).toBeInTheDocument();
      });

      // Confirm button in Song B must NOT be stuck in "Vinculando..." or disabled by old pending operation
      expect(screen.queryByText('Vinculando...')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /confirmar vínculo/i })).toBeInTheDocument();

      // Now resolve Song A's link promise
      resolveLinkA!({ link: { id: 'link-old' }, song: null });

      // Song B's modal must stay open and unchanged
      expect(screen.getByText('Vincular Cifra Inteligente')).toBeInTheDocument();
      expect(screen.queryByText('Vinculando...')).not.toBeInTheDocument();
    });

    it('does not display stale error in Song B if Song A link operation rejects after switch', async () => {
      getMySmartChordsForSong.mockResolvedValue([]);
      getSmartChords.mockResolvedValue([mockChord1]);

      let rejectLinkA: (err: any) => void;
      const linkPromiseA = new Promise((_, reject) => {
        rejectLinkA = reject;
      });
      setSmartChordRepertoireLink.mockReturnValueOnce(linkPromiseA);

      const { rerender } = render(
        <SongDetail
          song={mockSong}
          ministryId="min-1"
          onBack={vi.fn()}
        />
      );

      // Open modal in Song A and initiate link
      const linkBtnA = await screen.findByRole('button', { name: /vincular cifra/i });
      fireEvent.click(linkBtnA);
      await waitFor(() => expect(screen.getByText('Vincular Cifra Inteligente')).toBeInTheDocument());

      fireEvent.click(screen.getByText('Graça Admirável (Violão)'));
      fireEvent.click(screen.getByRole('button', { name: /confirmar vínculo/i }));

      // Switch to Song B
      const songB: Song = { ...mockSong, id: 'song-456', title: 'Segunda Música' };
      rerender(
        <SongDetail
          song={songB}
          ministryId="min-1"
          onBack={vi.fn()}
        />
      );

      // Open modal in Song B
      const linkBtnB = await screen.findByRole('button', { name: /vincular cifra/i });
      fireEvent.click(linkBtnB);
      await waitFor(() => expect(screen.getByText('Vincular Cifra Inteligente')).toBeInTheDocument());

      // Reject Song A's link promise
      rejectLinkA!(new Error('Erro de vínculo de Song A'));

      // Song B's modal must NOT show Song A's error and must not be stuck disabled
      await waitFor(() => {
        expect(screen.queryByText(/Erro de vínculo de Song A/)).not.toBeInTheDocument();
      });
      expect(screen.queryByText('Vinculando...')).not.toBeInTheDocument();
    });

    it('does not leave isUnlinking active when switching songs while unlink is pending', async () => {
      getMySmartChordsForSong.mockResolvedValue([mockChord1]);

      let resolveUnlinkA: (val: any) => void;
      const unlinkPromiseA = new Promise((resolve) => {
        resolveUnlinkA = resolve;
      });
      removeSmartChordRepertoireLink.mockReturnValueOnce(unlinkPromiseA);

      const { rerender } = render(
        <SongDetail
          song={mockSong}
          ministryId="min-1"
          onBack={vi.fn()}
        />
      );

      // Song A has linked chord
      const unlinkBtnA = await screen.findByRole('button', { name: /desvincular/i });
      fireEvent.click(unlinkBtnA);

      // Unlink is pending in Song A
      expect(screen.getByRole('button', { name: /desvinculando\.\.\./i })).toBeInTheDocument();

      // Switch to Song B which also has a linked chord
      const songB: Song = { ...mockSong, id: 'song-456', title: 'Segunda Música' };
      rerender(
        <SongDetail
          song={songB}
          ministryId="min-1"
          onBack={vi.fn()}
        />
      );

      // Wait for Song B's chords to load
      const unlinkBtnB = await screen.findByRole('button', { name: /desvincular/i });
      // In Song B, Desvincular button must NOT be disabled or show "Desvinculando..."
      expect(unlinkBtnB).not.toBeDisabled();
      expect(screen.queryByRole('button', { name: /desvinculando/i })).not.toBeInTheDocument();

      // Resolve Song A's unlink
      resolveUnlinkA!(undefined);

      // Song B must remain interactive
      expect(screen.getByRole('button', { name: /desvincular/i })).not.toBeDisabled();
    });
  });

  describe('R2-02 — Stale modal fetch errors', () => {
    it('does not overwrite Song B available chords when Song A modal fetch rejects', async () => {
      let rejectFetchA: (err: any) => void;
      const fetchPromiseA = new Promise<SmartChord[]>((_, reject) => {
        rejectFetchA = reject;
      });

      // Song A fetch will hang until rejected
      getSmartChords.mockReturnValueOnce(fetchPromiseA);

      const { rerender } = render(
        <SongDetail
          song={mockSong}
          ministryId="min-1"
          onBack={vi.fn()}
        />
      );

      // Open modal in Song A
      const linkBtnA = await screen.findByRole('button', { name: /vincular cifra/i });
      fireEvent.click(linkBtnA);

      // Switch to Song B while fetch A is in flight
      const songB: Song = { ...mockSong, id: 'song-456', title: 'Segunda Música' };
      // Song B's getSmartChords resolves successfully with mockChord2
      getSmartChords.mockResolvedValueOnce([mockChord2]);

      rerender(
        <SongDetail
          song={songB}
          ministryId="min-1"
          onBack={vi.fn()}
        />
      );

      // Open modal in Song B
      const linkBtnB = await screen.findByRole('button', { name: /vincular cifra/i });
      fireEvent.click(linkBtnB);

      // Song B successfully loads mockChord2
      expect(await screen.findByText('Graça Admirável (Tom Baixo)')).toBeInTheDocument();

      // Now reject Song A's fetch
      rejectFetchA!(new Error('Falha grave de rede de Song A'));

      // Song B's modal must still show mockChord2 and NOT the error from Song A
      await waitFor(() => {
        expect(screen.queryByText(/Falha grave de rede de Song A/)).not.toBeInTheDocument();
      });
      expect(screen.getByText('Graça Admirável (Tom Baixo)')).toBeInTheDocument();
    });

    it('does not overwrite Song B available chords when Song A modal fetch succeeds late', async () => {
      let resolveFetchA: (val: any) => void;
      const fetchPromiseA = new Promise<SmartChord[]>((resolve) => {
        resolveFetchA = resolve;
      });

      getSmartChords.mockReturnValueOnce(fetchPromiseA);

      const { rerender } = render(
        <SongDetail
          song={mockSong}
          ministryId="min-1"
          onBack={vi.fn()}
        />
      );

      // Open modal in Song A
      const linkBtnA = await screen.findByRole('button', { name: /vincular cifra/i });
      fireEvent.click(linkBtnA);

      // Switch to Song B
      const songB: Song = { ...mockSong, id: 'song-456', title: 'Segunda Música' };
      getSmartChords.mockResolvedValueOnce([mockChord2]);

      rerender(
        <SongDetail
          song={songB}
          ministryId="min-1"
          onBack={vi.fn()}
        />
      );

      // Open modal in Song B
      const linkBtnB = await screen.findByRole('button', { name: /vincular cifra/i });
      fireEvent.click(linkBtnB);

      expect(await screen.findByText('Graça Admirável (Tom Baixo)')).toBeInTheDocument();

      // Resolve Song A's fetch with mockChord1
      resolveFetchA!([mockChord1]);

      // mockChord1 must never appear in Song B's modal
      await waitFor(() => {
        expect(screen.getByText('Graça Admirável (Tom Baixo)')).toBeInTheDocument();
      });
      expect(screen.queryByText('Graça Admirável (Violão)')).not.toBeInTheDocument();
    });

    it('invalidates previous fetch when modal is closed and reopened', async () => {
      let rejectFetch1: (err: any) => void;
      const fetchPromise1 = new Promise<SmartChord[]>((_, reject) => {
        rejectFetch1 = reject;
      });

      getSmartChords.mockReturnValueOnce(fetchPromise1);

      render(
        <SongDetail
          song={mockSong}
          ministryId="min-1"
          onBack={vi.fn()}
        />
      );

      // Open modal (first time)
      const linkBtn = await screen.findByRole('button', { name: /vincular cifra/i });
      fireEvent.click(linkBtn);
      await waitFor(() => expect(screen.getByText('Vincular Cifra Inteligente')).toBeInTheDocument());

      // Close modal
      const cancelBtn = screen.getByRole('button', { name: /cancelar/i });
      fireEvent.click(cancelBtn);
      expect(screen.queryByText('Vincular Cifra Inteligente')).not.toBeInTheDocument();

      // Reopen modal (second time) - resolves with mockChord1
      getSmartChords.mockResolvedValueOnce([mockChord1]);
      fireEvent.click(linkBtn);

      expect(await screen.findByText('Graça Admirável (Violão)')).toBeInTheDocument();

      // First fetch now rejects
      rejectFetch1!(new Error('Erro de requisição anterior cancelada'));

      // The old error must NOT overwrite the current modal content
      await waitFor(() => {
        expect(screen.queryByText(/Erro de requisição anterior/)).not.toBeInTheDocument();
      });
      expect(screen.getByText('Graça Admirável (Violão)')).toBeInTheDocument();
    });
  });

  describe('Scenario 8 — Duplicate submissions prevention in active context', () => {
    it('prevents multiple simultaneous link submissions in the same active context', async () => {
      getMySmartChordsForSong.mockResolvedValue([]);
      getSmartChords.mockResolvedValue([mockChord1]);

      let resolveLink: (val: any) => void;
      const linkPromise = new Promise((resolve) => {
        resolveLink = resolve;
      });
      setSmartChordRepertoireLink.mockReturnValueOnce(linkPromise);

      render(
        <SongDetail
          song={mockSong}
          ministryId="min-1"
          onBack={vi.fn()}
        />
      );

      const linkBtn = await screen.findByRole('button', { name: /vincular cifra/i });
      fireEvent.click(linkBtn);
      await waitFor(() => expect(screen.getByText('Vincular Cifra Inteligente')).toBeInTheDocument());

      fireEvent.click(screen.getByText('Graça Admirável (Violão)'));
      const confirmBtn = screen.getByRole('button', { name: /confirmar vínculo/i });

      // Click once
      fireEvent.click(confirmBtn);
      expect(setSmartChordRepertoireLink).toHaveBeenCalledTimes(1);

      // Attempt duplicate click while in-flight
      fireEvent.click(confirmBtn);
      expect(setSmartChordRepertoireLink).toHaveBeenCalledTimes(1);

      // Confirm button is disabled
      expect(confirmBtn).toBeDisabled();

      resolveLink!({ link: { id: 'link-1' }, song: null });
    });

    it('prevents multiple simultaneous unlink submissions in the same active context', async () => {
      getMySmartChordsForSong.mockResolvedValue([mockChord1]);

      let resolveUnlink: (val: any) => void;
      const unlinkPromise = new Promise((resolve) => {
        resolveUnlink = resolve;
      });
      removeSmartChordRepertoireLink.mockReturnValueOnce(unlinkPromise);

      render(
        <SongDetail
          song={mockSong}
          ministryId="min-1"
          onBack={vi.fn()}
        />
      );

      const unlinkBtn = await screen.findByRole('button', { name: /desvincular cifra/i });

      // Click once
      fireEvent.click(unlinkBtn);
      expect(removeSmartChordRepertoireLink).toHaveBeenCalledTimes(1);

      // Attempt second click while in-flight
      fireEvent.click(unlinkBtn);
      expect(removeSmartChordRepertoireLink).toHaveBeenCalledTimes(1);

      // Unlink button is disabled
      expect(unlinkBtn).toBeDisabled();

      resolveUnlink!(undefined);
    });
  });

  describe('R3 — Session Reload & Lifecycle', () => {
    it('switching praise_auth_token from session A to session B re-triggers authorized fetch and renders session B chords', async () => {
      localStorage.setItem('praise_auth_token', 'token-session-a');
      getMySmartChordsForSong.mockResolvedValueOnce([mockChord1]);

      const { rerender } = render(
        <SongDetail
          song={mockSong}
          ministryId="min-1"
          onBack={vi.fn()}
        />
      );

      // Session A chords load
      expect(await screen.findByText(/Graça admirável que salvou/)).toBeInTheDocument();
      expect(screen.getByText('Tom Original:').parentElement).toHaveTextContent('G');
      expect(getMySmartChordsForSong).toHaveBeenCalledTimes(1);

      // Switch auth token to session B without changing song or ministry
      localStorage.setItem('praise_auth_token', 'token-session-b');
      const mockChordB: SmartChord = {
        ...mockChord2,
        id: 'chord-b',
        userId: 'user-b',
        originalKey: 'E',
        content: '[E]Conteúdo exclusivo da sessão B',
      };
      getMySmartChordsForSong.mockResolvedValueOnce([mockChordB]);

      rerender(
        <SongDetail
          song={mockSong}
          ministryId="min-1"
          onBack={vi.fn()}
        />
      );

      // Must re-trigger fetch for session B and render session B chords
      await waitFor(() => {
        expect(getMySmartChordsForSong).toHaveBeenCalledTimes(2);
      });
      expect(await screen.findByText(/Conteúdo exclusivo da sessão B/)).toBeInTheDocument();
      expect(screen.getByText('Tom Original:').parentElement).toHaveTextContent('E');
      expect(screen.queryByText(/Graça admirável que salvou/)).not.toBeInTheDocument();
    });

    it('logout clears personal data without making unauthorized fetch', async () => {
      localStorage.setItem('praise_auth_token', 'token-session-a');
      getMySmartChordsForSong.mockResolvedValueOnce([mockChord1]);

      const { rerender } = render(
        <SongDetail
          song={mockSong}
          ministryId="min-1"
          onBack={vi.fn()}
        />
      );

      expect(await screen.findByText(/Graça admirável que salvou/)).toBeInTheDocument();
      expect(getMySmartChordsForSong).toHaveBeenCalledTimes(1);

      // User logs out (token removed)
      localStorage.removeItem('praise_auth_token');

      rerender(
        <SongDetail
          song={mockSong}
          ministryId="min-1"
          onBack={vi.fn()}
        />
      );

      // Personal chords from session A must be immediately cleared
      expect(screen.queryByText(/Graça admirável que salvou/)).not.toBeInTheDocument();

      // No new fetch should be triggered while unauthenticated
      expect(getMySmartChordsForSong).toHaveBeenCalledTimes(1);
    });

    it('stale session A response cannot overwrite session B', async () => {
      localStorage.setItem('praise_auth_token', 'token-session-a');
      let resolveSessionA: (val: any) => void;
      const promiseA = new Promise((resolve) => {
        resolveSessionA = resolve;
      });
      getMySmartChordsForSong.mockReturnValueOnce(promiseA);

      const { rerender } = render(
        <SongDetail
          song={mockSong}
          ministryId="min-1"
          onBack={vi.fn()}
        />
      );

      // Switch to session B while session A is in-flight
      localStorage.setItem('praise_auth_token', 'token-session-b');
      const mockChordB: SmartChord = {
        ...mockChord2,
        id: 'chord-b',
        userId: 'user-b',
        originalKey: 'E',
        content: '[E]Conteúdo exclusivo da sessão B',
      };
      getMySmartChordsForSong.mockResolvedValueOnce([mockChordB]);

      rerender(
        <SongDetail
          song={mockSong}
          ministryId="min-1"
          onBack={vi.fn()}
        />
      );

      expect(await screen.findByText(/Conteúdo exclusivo da sessão B/)).toBeInTheDocument();

      // Session A completes late
      resolveSessionA!([mockChord1]);

      // Session B data remains, session A data is ignored
      await waitFor(() => {
        expect(screen.getByText(/Conteúdo exclusivo da sessão B/)).toBeInTheDocument();
      });
      expect(screen.queryByText(/Graça admirável que salvou/)).not.toBeInTheDocument();
    });

    it('session B returning empty list renders empty state without falling back to legacy song.smartChord', async () => {
      localStorage.setItem('praise_auth_token', 'token-session-a');
      getMySmartChordsForSong.mockResolvedValueOnce([mockChord1]);

      const songWithLegacy: Song = {
        ...mockSong,
        smartChord: {
          id: 'legacy-chord',
          originalKey: 'Ab',
          content: '[Ab]Legacy Chord',
        },
      };

      const { rerender } = render(
        <SongDetail
          song={songWithLegacy}
          ministryId="min-1"
          onBack={vi.fn()}
        />
      );

      expect(await screen.findByText(/Graça admirável que salvou/)).toBeInTheDocument();

      // Switch to session B which has no personal chords
      localStorage.setItem('praise_auth_token', 'token-session-b');
      getMySmartChordsForSong.mockResolvedValueOnce([]);

      rerender(
        <SongDetail
          song={songWithLegacy}
          ministryId="min-1"
          onBack={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(getMySmartChordsForSong).toHaveBeenCalledTimes(2);
      });

      // Neither session A nor legacy fallback should be rendered
      expect(screen.queryByText(/Graça admirável que salvou/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Legacy Chord/)).not.toBeInTheDocument();
    });

    it('session B failure displays error alert without exposing session A data', async () => {
      localStorage.setItem('praise_auth_token', 'token-session-a');
      getMySmartChordsForSong.mockResolvedValueOnce([mockChord1]);

      const { rerender } = render(
        <SongDetail
          song={mockSong}
          ministryId="min-1"
          onBack={vi.fn()}
        />
      );

      expect(await screen.findByText(/Graça admirável que salvou/)).toBeInTheDocument();

      // Switch to session B which fails with a network error
      localStorage.setItem('praise_auth_token', 'token-session-b');
      getMySmartChordsForSong.mockRejectedValueOnce(new Error('Erro ao carregar cifras da sessão B'));

      rerender(
        <SongDetail
          song={mockSong}
          ministryId="min-1"
          onBack={vi.fn()}
        />
      );

      expect(await screen.findByText(/Erro ao carregar cifras da sessão B/)).toBeInTheDocument();
      expect(screen.queryByText(/Graça admirável que salvou/)).not.toBeInTheDocument();
    });

    it('no repeated fetch loop occurs after successful fetch in session B', async () => {
      localStorage.setItem('praise_auth_token', 'token-session-a');
      getMySmartChordsForSong.mockResolvedValueOnce([mockChord1]);

      const { rerender } = render(
        <SongDetail
          song={mockSong}
          ministryId="min-1"
          onBack={vi.fn()}
        />
      );

      expect(await screen.findByText(/Graça admirável que salvou/)).toBeInTheDocument();

      localStorage.setItem('praise_auth_token', 'token-session-b');
      const mockChordB: SmartChord = {
        ...mockChord2,
        id: 'chord-b',
        userId: 'user-b',
        originalKey: 'E',
        content: '[E]Conteúdo exclusivo da sessão B',
      };
      getMySmartChordsForSong.mockResolvedValueOnce([mockChordB]);

      rerender(
        <SongDetail
          song={mockSong}
          ministryId="min-1"
          onBack={vi.fn()}
        />
      );

      expect(await screen.findByText(/Conteúdo exclusivo da sessão B/)).toBeInTheDocument();
      expect(getMySmartChordsForSong).toHaveBeenCalledTimes(2);

      // Re-render again with session B unchanged
      rerender(
        <SongDetail
          song={mockSong}
          ministryId="min-1"
          onBack={vi.fn()}
        />
      );

      // Call count must remain 2 (no loop)
      expect(getMySmartChordsForSong).toHaveBeenCalledTimes(2);
    });
  });

  describe('Universal Chord Font — SongDetail Web Repertoire Rendering', () => {
    const testChord: SmartChord = {
      id: 'chord-anchored-1',
      userId: 'user-1',
      artistId: null,
      songId: null,
      title: 'Cifra com Ancoragem',
      originalKey: 'G',
      content: '[G]Graça admirável [C]que salvou',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-02',
    };

    beforeEach(() => {
      localStorage.setItem('praise_auth_token', 'test-auth-token');
      getMySmartChordsForSong.mockResolvedValue([testChord]);
    });

    it('1. applies Arial font preference to chord sheet container', async () => {
      render(
        <SongDetail
          song={mockSong}
          ministryId="min-1"
          chordFontFamily="Arial"
          onBack={vi.fn()}
        />
      );

      const sheet = await screen.findByTestId('song-detail-chord-sheet');
      expect(sheet).toHaveStyle({ fontFamily: 'Arial, Helvetica, sans-serif' });
    });

    it('2. applies Georgia font preference to chord sheet container', async () => {
      render(
        <SongDetail
          song={mockSong}
          ministryId="min-1"
          chordFontFamily="Georgia"
          onBack={vi.fn()}
        />
      );

      const sheet = await screen.findByTestId('song-detail-chord-sheet');
      expect(sheet).toHaveStyle({ fontFamily: 'Georgia, serif' });
    });

    it('3. defaults safely to monospace when no authenticated preference is available', async () => {
      localStorage.removeItem('louvaio_smart_chord_font_family');
      localStorage.removeItem('louvaio_last_auth_user_id');

      render(
        <SongDetail
          song={mockSong}
          ministryId="min-1"
          onBack={vi.fn()}
        />
      );

      const sheet = await screen.findByTestId('song-detail-chord-sheet');
      expect(sheet).toHaveStyle({ fontFamily: 'monospace, "Courier New", Courier' });
    });

    it('4. verifies structural chord anchoring to exact lyric character positions', async () => {
      render(
        <SongDetail
          song={mockSong}
          ministryId="min-1"
          chordFontFamily="Arial"
          onBack={vi.fn()}
        />
      );

      await screen.findByTestId('song-detail-chord-sheet');

      // First chord [G] must be anchored to character 0 ('G' in 'Graça')
      const chordG = document.querySelector('[data-anchor-idx="0"]');
      expect(chordG).toBeInTheDocument();
      expect(chordG).toHaveTextContent('G');
      const charCell0 = document.querySelector('[data-char-idx="0"]');
      expect(charCell0).toContainElement(chordG as HTMLElement);
      expect(charCell0).toHaveTextContent(/G/);

      // Second chord [C] must be anchored to character 16 ('q' in 'que salvou')
      const chordC = document.querySelector('[data-anchor-idx="16"]');
      expect(chordC).toBeInTheDocument();
      expect(chordC).toHaveTextContent('C');
      const charCell16 = document.querySelector('[data-char-idx="16"]');
      expect(charCell16).toContainElement(chordC as HTMLElement);
      expect(charCell16).toHaveTextContent(/q/);
    });

    it('5. preserves transposition with character-anchored chords', async () => {
      render(
        <SongDetail
          song={mockSong}
          ministryId="min-1"
          chordFontFamily="Georgia"
          onBack={vi.fn()}
        />
      );

      await screen.findByTestId('song-detail-chord-sheet');

      // Click +1 Semitom
      const transposeUpBtn = screen.getByText('+1 Semitom');
      fireEvent.click(transposeUpBtn);

      await waitFor(() => {
        expect(screen.getByText('Tom Atual:')).toBeInTheDocument();
        expect(screen.getAllByText('G#')[0]).toBeInTheDocument();
      });

      // Verify transposed chords at anchored positions: G -> G#, C -> C#
      const chordGSharp = document.querySelector('[data-anchor-idx="0"]');
      expect(chordGSharp).toHaveTextContent('G#');

      const chordCSharp = document.querySelector('[data-anchor-idx="16"]');
      expect(chordCSharp).toHaveTextContent('C#');
    });

    it('6. preserves font preference and anchoring across multiple linked chords', async () => {
      getMySmartChordsForSong.mockResolvedValue([mockChord1, mockChord2]);

      render(
        <SongDetail
          song={mockSong}
          ministryId="min-1"
          chordFontFamily="Verdana"
          onBack={vi.fn()}
        />
      );

      const sheet = await screen.findByTestId('song-detail-chord-sheet');
      expect(sheet).toHaveStyle({ fontFamily: 'Verdana, Geneva, sans-serif' });

      // Switch to Chord 2 (Tom Baixo)
      fireEvent.click(screen.getByText(/Graça Admirável \(Tom Baixo\)/));

      await waitFor(() => {
        expect(screen.getAllByText('D')[0]).toBeInTheDocument();
      });

      // Font style remains Verdana
      expect(screen.getByTestId('song-detail-chord-sheet')).toHaveStyle({
        fontFamily: 'Verdana, Geneva, sans-serif',
      });
    });

    it('7. updates font view dynamically when preference change event is fired without reload', async () => {
      render(
        <SongDetail
          song={mockSong}
          ministryId="min-1"
          chordFontFamily="monospace"
          onBack={vi.fn()}
        />
      );

      const sheet = await screen.findByTestId('song-detail-chord-sheet');
      expect(sheet).toHaveStyle({ fontFamily: 'monospace, "Courier New", Courier' });

      // Fire louvaio_chord_font_changed event
      fireEvent(
        window,
        new CustomEvent('louvaio_chord_font_changed', { detail: { font: 'Georgia' } })
      );

      await waitFor(() => {
        expect(screen.getByTestId('song-detail-chord-sheet')).toHaveStyle({
          fontFamily: 'Georgia, serif',
        });
      });
    });

    it('8. isolates preferences between user accounts when switching users', async () => {
      localStorage.setItem('louvaio_chord_font_user_user-a', 'Arial');
      localStorage.setItem('louvaio_chord_font_user_user-b', 'Georgia');
      localStorage.setItem('louvaio_last_auth_user_id', 'user-b');

      render(
        <SongDetail
          song={mockSong}
          ministryId="min-1"
          onBack={vi.fn()}
        />
      );

      const sheet = await screen.findByTestId('song-detail-chord-sheet');
      // Must use User B's Georgia, NOT User A's Arial
      expect(sheet).toHaveStyle({ fontFamily: 'Georgia, serif' });
    });

    it('9. preserves M19 privacy behavior: falls back to lyrics and hides chord sheet when unlinked or unauthenticated', async () => {
      getMySmartChordsForSong.mockResolvedValue([]);

      render(
        <SongDetail
          song={{ ...mockSong, notes: 'Observação da letra' }}
          ministryId="min-1"
          chordFontFamily="Arial"
          onBack={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Observação da letra')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('song-detail-chord-sheet')).toBeNull();
    });
  });
  it('renders an inline instrumental section in the saved song reader as a single musical row', async () => {
    const content = 'Solo: [ Am | D ]';
    getMySmartChordsForSong.mockResolvedValue([{ ...mockChord1, content }]);
    render(<SongDetail song={mockSong} ministryId="min-1" onBack={vi.fn()} />);
    const row = await screen.findByRole('group', { name: content });
    expect(row.textContent).toBe(content.replace(/[\[\]]/g, ''));
    expect(row).toHaveStyle({ flexWrap: 'nowrap', whiteSpace: 'pre', overflowX: 'auto' });
  });

});

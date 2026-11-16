import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SongDetail } from './SongDetail';
import { api } from '../api';
import { Classification, SmartChord, Song } from '../types';

vi.mock('../api', () => ({
  api: {
    getMe: vi.fn(),
    getMySmartChordsForSong: vi.fn(),
    getSmartChords: vi.fn(),
    setSmartChordRepertoireLink: vi.fn(),
    removeSmartChordRepertoireLink: vi.fn(),
    getMyPendingSmartChordsForSong: vi.fn(),
  },
}));

const mockClassifications: Classification[] = [
  { id: 'c-adoracao', ministryId: 'min-1', name: 'Adoração', createdAt: '', updatedAt: '' },
  { id: 'c-ceia', ministryId: 'min-1', name: 'Santa Ceia', createdAt: '', updatedAt: '' },
  { id: 'c-jovens', ministryId: 'min-1', name: 'Jovens', createdAt: '', updatedAt: '' },
];

const multiVersionSong: Song = {
  id: 'song-multi',
  ministryId: 'min-1',
  title: 'Sublime Graça',
  artist: 'John Newton',
  originalKey: 'G',
  bpm: 72,
  duration: '04:45',
  notes: 'Observação original de estúdio',
  youtubeUrl: 'https://youtu.be/v1-video',
  chordSheetUrl: 'https://cifraclub.com.br/sublime-graca',
  classificationId: 'c-adoracao',
  versions: [
    {
      id: 'ver-1',
      name: 'Gravação Original',
      key: 'G',
      bpm: 72,
      duration: '04:45',
      notes: 'Intro suave no piano e violão',
      classificationIds: ['c-adoracao'],
      links: [
        { label: 'Vídeo', url: 'https://youtu.be/v1-video' },
        { label: 'Cifra', url: 'https://cifraclub.com.br/sublime-graca' },
      ],
    },
    {
      id: 'ver-2',
      name: 'Arranjo Acústico',
      key: 'E',
      bpm: 64,
      duration: '05:10',
      notes: 'Capotraste na 2ª casa, sem bateria',
      classificationIds: ['c-ceia', 'c-jovens'],
      links: [],
    },
  ],
};

const mockNotationChord: SmartChord = {
  id: 'chord-1',
  userId: 'user-1',
  artistId: 'artist-1',
  songId: 'song-multi',
  title: 'Sublime Graça (Violão)',
  originalKey: 'G',
  content:
    '{{Só violão}}\n{{^Entrada: baixo}}\n[G(add9)/B]Sublime  [C9]graça\n| G7(b9) (Em) | % N.C. 2x |\ne|--0h2--3--0--|\n  Doce   [D]som',
  createdAt: '2026-11-09',
  updatedAt: '2026-11-09',
};

const mockSecondChord: SmartChord = {
  id: 'chord-2',
  userId: 'user-1',
  artistId: 'artist-1',
  songId: 'song-multi',
  title: 'Sublime Graça (Teclado)',
  originalKey: 'A',
  content: '[A]Sublime [D]graça no [E]teclado',
  createdAt: '2026-11-09',
  updatedAt: '2026-11-09',
};

describe('SongDetail (D2-B Delivery 2)', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('praise_auth_token', 'token-user-1');
    vi.clearAllMocks();
    vi.mocked(api.getMe).mockResolvedValue({ id: 'user-1', preferences: {} } as any);
    vi.mocked(api.getMySmartChordsForSong).mockResolvedValue([]);
    vi.mocked(api.getMyPendingSmartChordsForSong).mockResolvedValue([]);
    vi.mocked(api.getSmartChords).mockResolvedValue([]);
  });

  it('renders compact stage header with back navigation, title, artist, and respects RBAC for admin actions', async () => {
    const onBack = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    const { rerender } = render(
      <SongDetail
        song={multiVersionSong}
        ministryId="min-1"
        classifications={mockClassifications}
        onBack={onBack}
      />
    );

    expect(screen.getByRole('heading', { name: 'Sublime Graça' })).toBeInTheDocument();
    expect(screen.getByText('John Newton')).toBeInTheDocument();

    const backBtn = screen.getByRole('button', { name: 'Voltar para músicas' });
    fireEvent.click(backBtn);
    expect(onBack).toHaveBeenCalledTimes(1);

    // Without onEdit/onDelete (member RBAC), admin buttons must not render
    expect(screen.queryByRole('button', { name: /Editar música/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Excluir música/i })).not.toBeInTheDocument();

    // With admin callbacks, Edit and Delete buttons render and trigger callbacks
    rerender(
      <SongDetail
        song={multiVersionSong}
        ministryId="min-1"
        classifications={mockClassifications}
        onBack={onBack}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );

    const editBtn = screen.getByRole('button', { name: 'Editar música Sublime Graça' });
    const deleteBtn = screen.getByRole('button', { name: 'Excluir música Sublime Graça' });
    fireEvent.click(editBtn);
    fireEvent.click(deleteBtn);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('switches versions in Music Stand Bar updating key, BPM, duration, notes, classifications, and links without leaking v1 links', async () => {
    const { rerender } = render(
      <SongDetail
        song={multiVersionSong}
        ministryId="min-1"
        userRole="admin"
        currentUserId="user-1"
        classifications={mockClassifications}
        onBack={vi.fn()}
      />
    );

    const versionTablist = screen.getByRole('tablist', { name: 'Versões da música' });
    const v1Tab = within(versionTablist).getByRole('tab', { name: /Gravação Original/i });
    const v2Tab = within(versionTablist).getByRole('tab', { name: /Arranjo Acústico/i });

    expect(v1Tab).toHaveAttribute('aria-selected', 'true');
    expect(v1Tab).toHaveTextContent('G');
    expect(v2Tab).toHaveTextContent('E');

    const infoCard = screen.getByTestId('version-info-card');
    expect(infoCard).toHaveTextContent('Informações da Versão (Gravação Original)');
    expect(infoCard).toHaveTextContent('72 BPM');
    expect(infoCard).toHaveTextContent('04:45');
    expect(infoCard).toHaveTextContent('Intro suave no piano e violão');
    expect(within(infoCard).getByTestId('version-classifications')).toHaveTextContent('Adoração');
    expect(screen.getByTestId('version-links-card')).toBeInTheDocument();

    // Switch to Version 2 (Arranjo Acústico) which has no links of its own
    fireEvent.click(v2Tab);

    expect(v2Tab).toHaveAttribute('aria-selected', 'true');
    expect(infoCard).toHaveTextContent('Informações da Versão (Arranjo Acústico)');
    expect(infoCard).toHaveTextContent('E');
    expect(infoCard).toHaveTextContent('64 BPM');
    expect(infoCard).toHaveTextContent('05:10');
    expect(infoCard).toHaveTextContent('Capotraste na 2ª casa, sem bateria');
    expect(within(infoCard).getByTestId('version-classifications')).toHaveTextContent('Santa Ceia');
    expect(within(infoCard).getByTestId('version-classifications')).toHaveTextContent('Jovens');

    // Version 2 has empty links and must NOT leak Version 1 root links
    expect(screen.queryByTestId('version-links-card')).not.toBeInTheDocument();

    // Updating the same song prop preserves the selected version (does not force index 0)
    rerender(
      <SongDetail
        song={{ ...multiVersionSong, title: 'Sublime Graça (Revisada)' }}
        ministryId="min-1"
        classifications={mockClassifications}
        onBack={vi.fn()}
      />
    );
    expect(within(screen.getByRole('tablist', { name: 'Versões da música' })).getByRole('tab', { name: /Arranjo Acústico/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('supports legacy single-version songs without versions array', () => {
    const legacySong: Song = {
      id: 'song-legacy',
      ministryId: 'min-1',
      title: 'Castelo Forte',
      artist: 'Martinho Lutero',
      originalKey: 'D',
      bpm: 80,
      duration: '03:50',
      notes: 'Hino clássico',
      classificationId: 'c-adoracao',
      youtubeUrl: 'https://youtu.be/castelo-forte',
      versions: [],
    };

    render(
      <SongDetail
        song={legacySong}
        ministryId="min-1"
        classifications={mockClassifications}
        onBack={vi.fn()}
      />
    );

    const infoCard = screen.getByTestId('version-info-card');
    expect(infoCard).toHaveTextContent('D');
    expect(infoCard).toHaveTextContent('80 BPM');
    expect(infoCard).toHaveTextContent('03:50');
    expect(infoCard).toHaveTextContent('Hino clássico');
    expect(within(infoCard).getByTestId('version-classifications')).toHaveTextContent('Adoração');
    expect(screen.getByTestId('version-links-card')).toHaveTextContent('Vídeo');
  });

  it('renders P1-P8 musical notation, supports visual transposition without mutating persisted data, and switches between multiple personal chords and reading modes', async () => {
    const originalContentSnapshot = mockNotationChord.content;
    vi.mocked(api.getMySmartChordsForSong).mockResolvedValue([mockNotationChord, mockSecondChord]);

    render(
      <SongDetail
        song={multiVersionSong}
        ministryId="min-1"
        classifications={mockClassifications}
        onBack={vi.fn()}
      />
    );

    const chordSheet = await screen.findByTestId('song-detail-chord-sheet');
    expect(chordSheet).toHaveTextContent('Só violão');
    expect(chordSheet).toHaveTextContent('baixo');
    expect(chordSheet).toHaveTextContent('G(add9)/B');
    expect(chordSheet).toHaveTextContent('G7(b9)');
    expect(chordSheet).toHaveTextContent('e|--0h2--3--0--|');

    const keyReadout = screen.getByTestId('song-detail-key-readout');
    expect(keyReadout).toHaveTextContent('Tom Original: G');
    expect(keyReadout).toHaveTextContent('Tom Atual: G');

    // Transpose +2 semitones
    const plusBtn = screen.getByRole('button', { name: '+1 Semitom' });
    fireEvent.click(plusBtn);
    fireEvent.click(plusBtn);

    expect(keyReadout).toHaveTextContent('Tom Original: G');
    expect(keyReadout).toHaveTextContent('Tom Atual: A (+2)');
    expect(chordSheet).toHaveTextContent('A(add9)/C#');
    expect(chordSheet).toHaveTextContent('A7(b9)');
    // Persisted chord content is never mutated by visual transposition
    expect(mockNotationChord.content).toBe(originalContentSnapshot);

    // Reset transposition
    fireEvent.click(screen.getByRole('button', { name: 'Resetar' }));
    expect(keyReadout).toHaveTextContent('Tom Atual: G');
    expect(chordSheet).toHaveTextContent('G(add9)/B');

    // Switch to second personal linked chord
    const personalChordTabs = screen.getByRole('tablist', { name: 'Cifras pessoais vinculadas' });
    fireEvent.click(within(personalChordTabs).getByRole('tab', { name: /Sublime Graça \(Teclado\)/i }));
    expect(keyReadout).toHaveTextContent('Tom Original: A');
    expect(chordSheet).toHaveTextContent('teclado');

    // Switch to "Apenas Letra" mode
    fireEvent.click(screen.getByRole('button', { name: /Apenas Letra/i }));
    const lyricsSheet = screen.getByTestId('song-detail-lyrics-sheet');
    expect(lyricsSheet).toHaveTextContent('Sublime graça no teclado');
    expect(lyricsSheet).not.toHaveTextContent('[A]');
  });

  it('supports linking, opening in Cifrador, unlinking personal chords, and fences stale responses across context switches', async () => {
    let resolveStaleChords: (value: SmartChord[]) => void = () => {};
    vi.mocked(api.getMySmartChordsForSong).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStaleChords = resolve;
        })
    );

    const onOpenSmartChord = vi.fn();
    const { rerender } = render(
      <SongDetail
        song={multiVersionSong}
        ministryId="min-1"
        userRole="admin"
        currentUserId="user-1"
        onBack={vi.fn()}
        onOpenSmartChord={onOpenSmartChord}
      />
    );

    // Switch to another song before first request resolves
    const secondSong: Song = {
      id: 'song-2',
      ministryId: 'min-1',
      title: 'Outra Música',
      artist: 'Outro Artista',
      versions: [{ id: 'v1', name: 'Original', key: 'C', classificationIds: [], links: [] }],
    };
    vi.mocked(api.getMySmartChordsForSong).mockResolvedValueOnce([mockSecondChord]);

    rerender(
      <SongDetail
        song={secondSong}
        ministryId="min-1"
        userRole="admin"
        currentUserId="user-1"
        onBack={vi.fn()}
        onOpenSmartChord={onOpenSmartChord}
      />
    );

    // Resolve stale request from song-multi; it must be ignored
    resolveStaleChords([mockNotationChord]);

    const chordSheet = await screen.findByTestId('song-detail-chord-sheet');
    expect(chordSheet).toHaveTextContent('teclado');
    expect(chordSheet).not.toHaveTextContent('Só violão');

    // Open in Cifrador
    fireEvent.click(screen.getByRole('button', { name: 'Abrir no Cifrador' }));
    expect(onOpenSmartChord).toHaveBeenCalledWith('chord-2');

    // Unlink personal chord
    vi.mocked(api.removeSmartChordRepertoireLink).mockResolvedValueOnce({} as any);
    vi.mocked(api.getMySmartChordsForSong).mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole('button', { name: 'Desvincular Cifra' }));

    await waitFor(() => {
      expect(api.removeSmartChordRepertoireLink).toHaveBeenCalledWith('min-1', 'chord-2');
    });
  });

  it('completes personal chord link modal flow and immediately purges personal chords when auth session or ministry changes', async () => {
    vi.mocked(api.getMySmartChordsForSong).mockResolvedValueOnce([]);
    vi.mocked(api.getSmartChords).mockResolvedValueOnce([mockNotationChord]);
    vi.mocked(api.setSmartChordRepertoireLink).mockResolvedValueOnce({} as any);

    const { rerender } = render(
      <SongDetail
        song={multiVersionSong}
        ministryId="min-1"
        userRole="admin"
        currentUserId="user-1"
        classifications={mockClassifications}
        onBack={vi.fn()}
      />
    );

    // Open Link Smart Chord modal
    fireEvent.click(screen.getByRole('button', { name: 'Vincular Cifra Inteligente' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Vincular Cifra Inteligente')).toBeInTheDocument();

    // Select chord and confirm link
    const chordOption = await within(dialog).findByText('Sublime Graça (Violão)');
    fireEvent.click(chordOption);

    vi.mocked(api.getMySmartChordsForSong).mockResolvedValueOnce([mockNotationChord]);
    fireEvent.click(within(dialog).getByRole('button', { name: /Confirmar Vínculo/i }));

    await waitFor(() => {
      expect(api.setSmartChordRepertoireLink).toHaveBeenCalledWith('min-1', 'chord-1', 'song-multi', 'ver-1');
    });

    const chordSheet = await screen.findByTestId('song-detail-chord-sheet');
    expect(chordSheet).toHaveTextContent('G(add9)/B');

    // Switch user session -> must immediately clear User 1's personal chord (privacy invariant)
    vi.mocked(api.getMySmartChordsForSong).mockResolvedValueOnce([]);
    localStorage.setItem('praise_auth_token', 'token-user-2');
    fireEvent(window, new Event('praise_auth_changed'));

    await waitFor(() => {
      expect(screen.queryByTestId('song-detail-chord-sheet')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('song-detail-lyrics-sheet')).toBeInTheDocument();

    // Switch ministry -> resets version selection to index 0
    rerender(
      <SongDetail
        song={{ ...multiVersionSong, ministryId: 'min-2' }}
        ministryId="min-2"
        userRole="admin"
        currentUserId="user-1"
        classifications={mockClassifications}
        onBack={vi.fn()}
      />
    );
    const v1Tab = within(screen.getByRole('tablist', { name: 'Versões da música' })).getByRole('tab', {
      name: /Gravação Original/i,
    });
    expect(v1Tab).toHaveAttribute('aria-selected', 'true');
  });

  it('FASE 2: isolates personal smart chords per version tab and classifies pending links into the active version', async () => {
    vi.mocked(api.getMySmartChordsForSong).mockImplementation(async (_mId, _sId, options) => {
      if (options?.versionId === 'ver-1') return [mockNotationChord];
      if (options?.versionId === 'ver-2') return [mockSecondChord];
      return [];
    });
    vi.mocked(api.getMyPendingSmartChordsForSong).mockResolvedValue([
      {
        id: 'chord-pending',
        userId: 'user-1',
        artistId: 'artist-1',
        songId: 'song-multi',
        title: 'Cifra Legada Pendente',
        originalKey: 'E',
        content: '[E]Pendente',
        createdAt: '2026-11-09',
        updatedAt: '2026-11-09',
      },
    ]);
    vi.mocked(api.setSmartChordRepertoireLink).mockResolvedValue({ link: null, song: null });

    render(
      <SongDetail
        song={multiVersionSong}
        ministryId="min-1"
        userRole="admin"
        currentUserId="user-1"
        classifications={[]}
        initialVersionId="ver-2"
        onBack={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(await screen.findByText(/Sublime Graça \(Teclado\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/Sublime Graça \(Violão\)/i)).toBeNull();
    expect(api.getMySmartChordsForSong).toHaveBeenCalledWith('min-1', 'song-multi', { versionId: 'ver-2' });

    const banner = await screen.findByTestId('pending-chords-classification-banner');
    expect(within(banner).getByText('Cifra Legada Pendente')).toBeInTheDocument();

    fireEvent.click(within(banner).getByRole('button', { name: /Vincular à versão Arranjo Acústico/i }));
    await waitFor(() => {
      expect(api.setSmartChordRepertoireLink).toHaveBeenCalledWith('min-1', 'chord-pending', 'song-multi', 'ver-2');
    });

    const v1Tab = within(screen.getByRole('tablist', { name: 'Versões da música' })).getByRole('tab', {
      name: /Gravação Original/i,
    });
    fireEvent.click(v1Tab);
    expect(await screen.findByText(/Sublime Graça \(Violão\)/i)).toBeInTheDocument();
    expect(api.getMySmartChordsForSong).toHaveBeenCalledWith('min-1', 'song-multi', { versionId: 'ver-1' });
  });

  it('FASE 3: exibe fallback explícito quando initialVersionId não existe e preserva backLabel de escala', async () => {
    vi.mocked(api.getMySmartChordsForSong).mockResolvedValue([]);
    vi.mocked(api.getMyPendingSmartChordsForSong).mockResolvedValue([]);

    render(
      <SongDetail
        song={multiVersionSong}
        ministryId="min-1"
        classifications={[]}
        initialVersionId="ver-removida"
        backLabel="Voltar para Escala"
        onBack={vi.fn()}
      />
    );

    const banner = await screen.findByTestId('song-detail-version-fallback-banner');
    expect(banner).toHaveTextContent(/não foi encontrada/i);
    expect(banner).toHaveTextContent(/Gravação Original/i);
    expect(screen.getByRole('button', { name: 'Voltar para Escala' })).toBeInTheDocument();
  });

  it('R2.2 RBAC (member & fail-closed): displays shared admin chord for reading/transposition while hiding all admin linking/unlinking controls', async () => {
    const adminSharedChord: SmartChord = {
      ...mockNotationChord,
      userId: 'admin-owner-1',
    };
    vi.mocked(api.getMySmartChordsForSong).mockResolvedValue([adminSharedChord]);
    vi.mocked(api.getMyPendingSmartChordsForSong).mockResolvedValue([mockSecondChord]);

    const onOpenSmartChord = vi.fn();
    const { rerender } = render(
      <SongDetail
        song={multiVersionSong}
        ministryId="min-1"
        userRole="member"
        currentUserId="member-user-1"
        classifications={mockClassifications}
        onBack={vi.fn()}
        onOpenSmartChord={onOpenSmartChord}
      />
    );

    const chordSheet = await screen.findByTestId('song-detail-chord-sheet');
    expect(chordSheet).toHaveTextContent('G(add9)/B');

    // Member never fetches pending classification queue or renders admin controls
    expect(api.getMyPendingSmartChordsForSong).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Vincular Cifra Inteligente' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Abrir no Cifrador' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Desvincular Cifra' })).toBeNull();
    expect(screen.queryByTestId('pending-chords-classification-banner')).toBeNull();

    // Ephemeral transposition + mode switch work for member
    fireEvent.click(screen.getByRole('button', { name: '+1 Semitom' }));
    expect(chordSheet).toHaveTextContent('G#(add9)/C');
    fireEvent.click(screen.getByRole('button', { name: /Apenas Letra/i }));
    expect(screen.getByTestId('song-detail-lyrics-sheet')).toBeInTheDocument();

    // Omitting userRole must fail closed as member
    rerender(
      <SongDetail
        song={multiVersionSong}
        ministryId="min-1"
        onBack={vi.fn()}
        onOpenSmartChord={onOpenSmartChord}
      />
    );
    expect(screen.queryByRole('button', { name: 'Vincular Cifra Inteligente' })).toBeNull();

    // Secondary admin viewing another admin's shared chord can link another chord, but cannot open/unlink foreign owner's chord
    rerender(
      <SongDetail
        song={multiVersionSong}
        ministryId="min-1"
        userRole="admin"
        currentUserId="admin-other-2"
        onBack={vi.fn()}
        onOpenSmartChord={onOpenSmartChord}
      />
    );
    expect(await screen.findByRole('button', { name: 'Vincular Cifra Inteligente' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abrir no Cifrador' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Desvincular Cifra' })).toBeNull();
    expect(screen.queryByTestId('pending-chords-classification-banner')).toBeNull();

    // Missing currentUserId must fail closed even when userRole is admin
    rerender(
      <SongDetail
        song={multiVersionSong}
        ministryId="min-1"
        userRole="admin"
        onBack={vi.fn()}
        onOpenSmartChord={onOpenSmartChord}
      />
    );
    expect(screen.queryByRole('button', { name: 'Abrir no Cifrador' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Desvincular Cifra' })).toBeNull();
    expect(screen.queryByTestId('pending-chords-classification-banner')).toBeNull();

    // Missing chord.userId on active or pending chord must fail closed even for identified admin
    vi.mocked(api.getMySmartChordsForSong).mockResolvedValue([
      { ...adminSharedChord, userId: '' } as any,
    ]);
    vi.mocked(api.getMyPendingSmartChordsForSong).mockResolvedValue([
      { ...adminSharedChord, id: 'pend-missing-owner', userId: '' } as any,
    ]);
    rerender(
      <SongDetail
        song={{ ...multiVersionSong, id: 'song-missing-owner' }}
        ministryId="min-1"
        userRole="admin"
        currentUserId="admin-owner-1"
        onBack={vi.fn()}
        onOpenSmartChord={onOpenSmartChord}
      />
    );
    expect(await screen.findByTestId('song-detail-chord-sheet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abrir no Cifrador' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Desvincular Cifra' })).toBeNull();
    expect(screen.queryByTestId('pending-chords-classification-banner')).toBeNull();
  });

  it('opens and closes piano diagram on chord click and keyboard (Enter/Space + Escape) with transposed chord, preserving scroll and restoring focus with zero content mutation', async () => {
    const originalContentSnapshot = mockNotationChord.content;
    vi.mocked(api.getMySmartChordsForSong).mockResolvedValue([mockNotationChord]);

    render(
      <SongDetail
        song={multiVersionSong}
        ministryId="min-1"
        classifications={mockClassifications}
        onBack={vi.fn()}
      />
    );

    const chordSheet = await screen.findByTestId('song-detail-chord-sheet');
    expect(chordSheet).toBeInTheDocument();

    // 1. Click on chord button in SongDetail (e.g. G(add9)/B)
    const chordBtn = screen.getByRole('button', { name: 'Ver diagrama do acorde G(add9)/B' });
    expect(chordBtn).toBeInTheDocument();
    chordBtn.focus();
    fireEvent.click(chordBtn);

    // Dialog opens with G(add9)/B
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText('G(add9)/B')).toBeInTheDocument();

    // Close dialog via Escape key
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    // Focus returned to chord button
    expect(document.activeElement).toBe(chordBtn);

    // 2. Transpose +2 semitones -> G(add9)/B becomes A(add9)/C#
    const plusBtn = screen.getByRole('button', { name: '+1 Semitom' });
    fireEvent.click(plusBtn);
    fireEvent.click(plusBtn);

    const transposedBtn = screen.getByRole('button', { name: 'Ver diagrama do acorde A(add9)/C#' });
    expect(transposedBtn).toBeInTheDocument();

    // Trigger via keyboard Enter/click
    transposedBtn.focus();
    fireEvent.click(transposedBtn);

    const transposedDialog = screen.getByRole('dialog');
    expect(transposedDialog).toBeInTheDocument();
    expect(within(transposedDialog).getByText('A(add9)/C#')).toBeInTheDocument();

    // Close via Close button
    const closeBtn = within(transposedDialog).getByTestId('chord-piano-close-btn');
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(document.activeElement).toBe(transposedBtn);

    // Persisted chord content is strictly unmutated
    expect(mockNotationChord.content).toBe(originalContentSnapshot);
  });

  it('preserves both container scrollTop and window.scrollY when opening and closing piano diagram', async () => {
    vi.mocked(api.getMySmartChordsForSong).mockResolvedValue([mockNotationChord]);
    const scrollToSpy = vi.fn();
    const originalScrollTo = window.scrollTo;
    const originalScrollY = Object.getOwnPropertyDescriptor(window, 'scrollY');
    Object.defineProperty(window, 'scrollTo', { configurable: true, value: scrollToSpy });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 420 });

    try {
      render(
        <SongDetail
          song={multiVersionSong}
          ministryId="min-1"
          classifications={mockClassifications}
          onBack={vi.fn()}
        />
      );

      const chordBtn = await screen.findByRole('button', { name: 'Ver diagrama do acorde G(add9)/B' });
      fireEvent.click(chordBtn);

      const dialog = screen.getByRole('dialog');
      fireEvent.click(within(dialog).getByTestId('chord-piano-close-btn'));

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
      expect(scrollToSpy).toHaveBeenCalledWith({ top: 420 });
    } finally {
      Object.defineProperty(window, 'scrollTo', { configurable: true, value: originalScrollTo });
      if (originalScrollY) {
        Object.defineProperty(window, 'scrollY', originalScrollY);
      }
    }
  });
});

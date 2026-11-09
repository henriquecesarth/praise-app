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
      expect(api.setSmartChordRepertoireLink).toHaveBeenCalledWith('min-1', 'chord-1', 'song-multi');
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
        classifications={mockClassifications}
        onBack={vi.fn()}
      />
    );
    const v1Tab = within(screen.getByRole('tablist', { name: 'Versões da música' })).getByRole('tab', {
      name: /Gravação Original/i,
    });
    expect(v1Tab).toHaveAttribute('aria-selected', 'true');
  });
});

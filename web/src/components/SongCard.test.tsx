import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { api } from '../api';
import { Classification, Song } from '../types';
import { SongCard } from './SongCard';

vi.mock('../api', () => ({
  api: {
    getMe: vi.fn(),
    getMyGroups: vi.fn(),
    getMyMinistries: vi.fn(),
    getMinistrySubscription: vi.fn(),
    getSongs: vi.fn(),
    getSongById: vi.fn(),
    getMySmartChordsForSong: vi.fn().mockResolvedValue([]),
    getFolders: vi.fn(),
    getArtists: vi.fn(),
    getCounts: vi.fn(),
    getClassifications: vi.fn(),
    getSchedules: vi.fn(),
    getMinistryMembers: vi.fn(),
    getAnnouncements: vi.fn(),
  },
}));

const baseSong: Song = {
  id: 'song-1',
  title: 'Graça',
  artist: 'Artista Exemplo',
  versions: [{ id: 'v1', name: 'Original', key: 'G', classificationIds: [], bpm: 92, duration: '00:03:45', links: [] }],
};

describe('SongCard repertoire row', () => {
  it('renders compact musical metadata and calls the accessible open action', () => {
    const onTap = vi.fn();
    render(<SongCard song={baseSong} onTap={onTap} />);
    const button = screen.getByRole('button', { name: 'Abrir música Graça, Artista Exemplo' });
    expect(button).toHaveClass('louvaio-song-row');
    expect(screen.getByText('92 BPM')).toBeInTheDocument();
    expect(screen.getByText('03:45')).toBeInTheDocument();
    expect(screen.getByText('G', { selector: '.louvaio-song-row__key' })).toBeInTheDocument();
    fireEvent.click(button);
    expect(onTap).toHaveBeenCalledOnce();
    expect(button.querySelector('.song-avatar')).toBeNull();
  });

  it('shows version summary tooltip and classification badges only from supplied summary data', () => {
    const classifications: Classification[] = [
      { id: 'worship', ministryId: 'ministry-1', name: 'Adoração', color: '#B85A3C', createdAt: '', updatedAt: '' },
    ];
    const song: Song = {
      ...baseSong,
      versions: [
        { id: 'v1', name: 'Original', key: 'G', classificationIds: ['worship'], links: [] },
        { id: 'v2', name: 'Ao vivo', key: 'A', classificationIds: [], links: [] },
      ],
    };
    render(<SongCard song={song} classifications={classifications} onTap={() => undefined} />);
    expect(screen.getByText('2 versões')).toHaveAttribute('title', 'Original, Ao vivo');
    expect(screen.getByText('Adoração')).toBeInTheDocument();
    expect(screen.queryByText(/Cifra Inteligente/)).not.toBeInTheDocument();
  });

  it('renders resource indicators from actual song or version links and does not invent a version count', () => {
    const song = {
      ...baseSong,
      versions: undefined,
      youtubeUrl: 'https://youtube.example/video',
    } as unknown as Song;
    render(<SongCard song={song} onTap={() => undefined} />);
    expect(screen.getByLabelText('YouTube')).toBeInTheDocument();
    expect(screen.queryByText(/versões/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Cifra externa')).not.toBeInTheDocument();
  });

  it('ignores empty default link placeholders and shows external chord/audio/lyrics only when URLs are present', () => {
    const songWithEmptyLinks: Song = {
      ...baseSong,
      versions: [
        {
          id: 'v1',
          name: 'Original',
          key: 'G',
          classificationIds: [],
          links: [
            { label: 'Letra', url: '' },
            { label: 'Cifra', url: '   ' },
            { label: 'Áudio', url: 'https://audio.example/track' },
            { label: 'Vídeo', url: '' },
          ],
        },
      ],
    };
    render(<SongCard song={songWithEmptyLinks} onTap={() => undefined} />);
    expect(screen.queryByLabelText('Cifra externa')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('YouTube')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Áudio')).toBeInTheDocument();
  });
});

describe('Repertoire Library integration (D2-B Delivery 1)', () => {
  const mockUser = { id: 'user-1', email: 'lider@louvaio.test', name: 'Líder' };
  const adminMinistry = {
    id: 'min-1',
    name: 'Ministério Central',
    ownerUserId: 'user-1',
    subscriptionStatus: 'active' as const,
    role: 'admin' as const,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('praise_auth_token', 'mock-token');
    vi.mocked(api.getMe).mockResolvedValue(mockUser as any);
    vi.mocked(api.getMyGroups).mockResolvedValue([adminMinistry]);
    vi.mocked(api.getMyMinistries).mockResolvedValue([adminMinistry]);
    vi.mocked(api.getMinistrySubscription).mockResolvedValue({
      subscription: { planId: 'pro', accessMode: 'normal', administrativelySuspended: false },
      usage: { membersCount: 4, songsCount: 2 },
      quotas: { members: 100, songs: 500 },
      isOverLimit: false,
      overLimitDetails: { membersOver: false, songsOver: false },
      graceDaysRemaining: null,
    } as any);
    vi.mocked(api.getCounts).mockResolvedValue({ songs: 1, folders: 1, artists: 1 });
    vi.mocked(api.getClassifications).mockResolvedValue([
      { id: 'c-worship', ministryId: 'min-1', name: 'Adoração', color: '#B85A3C', createdAt: '', updatedAt: '' },
    ]);
    vi.mocked(api.getSongs).mockResolvedValue({ songs: [baseSong], totalCount: 1 });
    vi.mocked(api.getFolders).mockResolvedValue([
      { id: 'f-1', ministryId: 'min-1', name: 'Santa Ceia', description: 'Músicas de ceia', songCount: 1, songs: [baseSong], createdAt: '', updatedAt: '' },
    ]);
    vi.mocked(api.getArtists).mockResolvedValue([
      { id: 'a-1', ministryId: 'min-1', name: 'Artista Exemplo', createdAt: '', updatedAt: '' },
    ]);
    vi.mocked(api.getSchedules).mockResolvedValue([]);
    vi.mocked(api.getMinistryMembers).mockResolvedValue([]);
    vi.mocked(api.getAnnouncements).mockResolvedValue([]);
  });

  it('does not expose editing a list summary while full song details are pending', async () => {
    vi.mocked(api.getSongById).mockReturnValue(new Promise(() => {}));
    render(<MemoryRouter initialEntries={['/repertorio']}><App /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir música Graça, Artista Exemplo' }));
    await waitFor(() => expect(api.getSongById).toHaveBeenCalledWith('song-1', 'min-1'));
    expect(screen.queryByRole('button', { name: 'Editar música Graça' })).toBeNull();
    expect(screen.getByText(/Carregando detalhes/i)).toBeInTheDocument();
  });

  it('debounces search by 300ms and applies key, YouTube, and classification filters to api.getSongs', async () => {
    render(
      <MemoryRouter initialEntries={['/repertorio']}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Abrir música Graça, Artista Exemplo' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Adoração' })).toBeInTheDocument();

    vi.mocked(api.getSongs).mockClear();
    const searchInput = screen.getByLabelText('Buscar músicas');
    fireEvent.change(searchInput, { target: { value: 'Bondade' } });
    expect(api.getSongs).not.toHaveBeenCalled();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 330));
    });

    await waitFor(() => {
      expect(api.getSongs).toHaveBeenCalledWith('min-1', {
        search: 'Bondade',
        originalKey: undefined,
        hasYoutube: undefined,
        classificationId: undefined,
      });
    });

    // Apply classification chip filter
    fireEvent.click(screen.getByRole('button', { name: 'Adoração' }));
    await waitFor(() => {
      expect(api.getSongs).toHaveBeenCalledWith('min-1', {
        search: 'Bondade',
        originalKey: undefined,
        hasYoutube: undefined,
        classificationId: 'c-worship',
      });
    });

    // Apply key & YouTube filters via FilterPopover
    fireEvent.click(screen.getByLabelText('Abrir filtros do repertório'));
    fireEvent.click(screen.getByRole('button', { name: 'G' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar Filtros' }));

    await waitFor(() => {
      expect(api.getSongs).toHaveBeenCalledWith('min-1', {
        search: 'Bondade',
        originalKey: 'G',
        hasYoutube: true,
        classificationId: 'c-worship',
      });
    });

    expect(screen.getByRole('button', { name: 'Tom: G ×' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Com YouTube ×' })).toBeInTheDocument();

    // Remove key filter chip
    fireEvent.click(screen.getByRole('button', { name: 'Tom: G ×' }));
    await waitFor(() => {
      expect(api.getSongs).toHaveBeenCalledWith('min-1', {
        search: 'Bondade',
        originalKey: undefined,
        hasYoutube: true,
        classificationId: 'c-worship',
      });
    });
  });

  it('renders error state with retry and preserves tabs and administrative RBAC', async () => {
    vi.mocked(api.getSongs).mockRejectedValueOnce(new Error('Falha temporária na API'));
    vi.mocked(api.getMyGroups).mockResolvedValue([{ ...adminMinistry, role: 'member' }]);

    render(
      <MemoryRouter initialEntries={['/repertorio']}>
        <App />
      </MemoryRouter>,
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Falha temporária na API');
    expect(screen.queryByRole('button', { name: /Nova Música/i })).not.toBeInTheDocument();

    vi.mocked(api.getSongs).mockResolvedValueOnce({ songs: [baseSong], totalCount: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Abrir música Graça, Artista Exemplo' })).toBeInTheDocument();
    });

    // Switch to Pastas and Artistas tabs
    fireEvent.click(screen.getByRole('button', { name: /Pastas/i }));
    await waitFor(() => {
      expect(screen.getByText('Santa Ceia')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /Nova Pasta/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Artistas/i }));
    await waitFor(() => {
      expect(screen.getByText('Artista Exemplo')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /Novo Artista/i })).not.toBeInTheDocument();
  });

  it('displays RestrictedBanner in restricted/suspended mode and isolates classifications across ministries', async () => {
    const secondMinistry = {
      ...adminMinistry,
      id: 'min-2',
      name: 'Ministério Norte',
    };
    vi.mocked(api.getMyGroups).mockResolvedValue([adminMinistry, secondMinistry]);
    vi.mocked(api.getMyMinistries).mockResolvedValue([adminMinistry, secondMinistry]);
    vi.mocked(api.getMinistrySubscription).mockImplementation(async (minId: string) => ({
      subscription: {
        planId: 'pro',
        accessMode: minId === 'min-2' ? 'suspended' : 'restricted_over_limit',
        administrativelySuspended: minId === 'min-2',
        billingStatus: 'past_due',
      },
      usage: { membersCount: 15, songsCount: 60 },
      quotas: { members: 10, songs: 50 },
      isOverLimit: true,
      overLimitDetails: { membersOver: true, songsOver: true },
      graceDaysRemaining: null,
    } as any));
    vi.mocked(api.getClassifications).mockImplementation(async (minId: string) => (
      minId === 'min-1'
        ? [{ id: 'c-min1', ministryId: 'min-1', name: 'Exclusiva Min 1', createdAt: '', updatedAt: '' }]
        : []
    ));

    render(
      <MemoryRouter initialEntries={['/repertorio']}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Exclusiva Min 1' })).toBeInTheDocument();
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nova Música/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Exclusiva Min 1' }));
    await waitFor(() => {
      expect(api.getSongs).toHaveBeenCalledWith('min-1', expect.objectContaining({ classificationId: 'c-min1' }));
    });

    // Switch active ministry via sidebar selector
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'min-2' } });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Exclusiva Min 1' })).not.toBeInTheDocument();
    });
    expect(screen.getByText('Ministério suspenso')).toBeInTheDocument();
  });
});

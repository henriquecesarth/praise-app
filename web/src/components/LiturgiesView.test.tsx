import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LiturgiesView } from './LiturgiesView';
import { Song, Liturgy } from '../types';

const { getLiturgies, createLiturgy, deleteLiturgy } = vi.hoisted(() => ({
  getLiturgies: vi.fn(),
  createLiturgy: vi.fn(),
  deleteLiturgy: vi.fn(),
}));

vi.mock('../api', () => ({
  api: {
    getLiturgies,
    createLiturgy,
    deleteLiturgy,
  },
}));

const mockSongs: Song[] = [
  {
    id: 'song-1',
    title: 'Porque Ele Vive',
    artist: 'Harpa Cristã',
    artistId: 'art-1',
    artistName: 'Harpa Cristã',
    bpm: 72,
    originalKey: 'G',
    versions: [],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  },
  {
    id: 'song-2',
    title: 'Bondade de Deus',
    artist: 'Isaías Saad',
    artistId: 'art-2',
    artistName: 'Isaías Saad',
    bpm: 68,
    originalKey: 'C',
    versions: [],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  },
];

const mockLiturgies: Liturgy[] = [
  {
    id: 'lit-1',
    ministryId: 'min-1',
    title: 'Culto de Celebração - Manhã',
    date: '2026-09-13T12:00:00.000Z',
    description: 'Culto dominical matutino com ceia',
    createdBy: 'user-1',
    items: [
      { id: 'item-1', liturgyId: 'lit-1', type: 'song', songId: 'song-1', title: 'Porque Ele Vive (Harpa Cristã)', position: 0 },
      { id: 'item-2', liturgyId: 'lit-1', type: 'song', songId: 'song-2', title: 'Bondade de Deus (Isaías Saad)', position: 1 },
    ],
    createdAt: '2026-09-01',
    updatedAt: '2026-09-01',
  },
];

describe('LiturgiesView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLiturgies.mockResolvedValue([]);
    createLiturgy.mockResolvedValue(mockLiturgies[0]);
    deleteLiturgy.mockResolvedValue(undefined);
  });

  it('renders loading state initially while fetching', async () => {
    getLiturgies.mockReturnValue(new Promise(() => {})); // Never resolves
    render(<LiturgiesView groupId="min-1" userRole="admin" allSongs={mockSongs} />);

    expect(screen.getByText('Carregando liturgias...')).toBeInTheDocument();
  });

  it('renders empty state for admin with creation hint', async () => {
    getLiturgies.mockResolvedValue([]);
    render(<LiturgiesView groupId="min-1" userRole="admin" allSongs={mockSongs} />);

    await waitFor(() => {
      expect(screen.getByText('Nenhuma liturgia cadastrada')).toBeInTheDocument();
      expect(screen.getByText('Crie a programação dos próximos cultos e selecione o repertório.')).toBeInTheDocument();
    });
  });

  it('renders empty state for member with read-only hint', async () => {
    getLiturgies.mockResolvedValue([]);
    render(<LiturgiesView groupId="min-1" userRole="member" allSongs={mockSongs} />);

    await waitFor(() => {
      expect(screen.getByText('Nenhuma liturgia cadastrada')).toBeInTheDocument();
      expect(screen.getByText('Nenhuma ordem de culto disponibilizada pelo líder até o momento.')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Nova Liturgia' })).not.toBeInTheDocument();
  });

  it('renders populated liturgies with items and songs in correct order', async () => {
    getLiturgies.mockResolvedValue(mockLiturgies);
    render(<LiturgiesView groupId="min-1" userRole="admin" allSongs={mockSongs} />);

    await waitFor(() => {
      expect(screen.getByText('Culto de Celebração - Manhã')).toBeInTheDocument();
      expect(screen.getByText('Culto dominical matutino com ceia')).toBeInTheDocument();
      expect(screen.getByText('Porque Ele Vive (Harpa Cristã)')).toBeInTheDocument();
      expect(screen.getByText('Bondade de Deus (Isaías Saad)')).toBeInTheDocument();
      expect(screen.getByText('Repertório Selecionado (2)')).toBeInTheDocument();
    });
  });

  it('renders error state and retries on button click', async () => {
    getLiturgies.mockRejectedValueOnce(new Error('Falha de rede'));
    const user = userEvent.setup();

    render(<LiturgiesView groupId="min-1" userRole="admin" allSongs={mockSongs} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Erro ao carregar liturgias')).toBeInTheDocument();
      expect(screen.getByText('Falha de rede')).toBeInTheDocument();
    });

    getLiturgies.mockResolvedValue(mockLiturgies);
    await user.click(screen.getByRole('button', { name: /Tentar novamente/i }));

    await waitFor(() => {
      expect(screen.getByText('Culto de Celebração - Manhã')).toBeInTheDocument();
    });
    expect(getLiturgies).toHaveBeenCalledTimes(2);
  });

  it('allows admin to open modal and create a new liturgy', async () => {
    const user = userEvent.setup();
    const showToast = vi.fn();
    render(<LiturgiesView groupId="min-1" userRole="admin" allSongs={mockSongs} showToast={showToast} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Nova Liturgia' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Nova Liturgia' }));
    expect(screen.getByText('Nova Liturgia / Ordem do Culto')).toBeInTheDocument();

    const titleInput = screen.getByPlaceholderText('Ex: Culto de Celebração - Manhã');
    await user.type(titleInput, 'Culto Especial da Família');

    const descInput = screen.getByPlaceholderText('Instruções adicionais para a equipe...');
    await user.type(descInput, 'Levar violão adicional');

    // Select a song
    await user.click(screen.getByText('Porque Ele Vive'));

    await user.click(screen.getByRole('button', { name: 'Salvar Liturgia' }));

    await waitFor(() => {
      expect(createLiturgy).toHaveBeenCalledWith('min-1', expect.objectContaining({
        title: 'Culto Especial da Família',
        description: 'Levar violão adicional',
        items: expect.arrayContaining([
          expect.objectContaining({
            songId: 'song-1',
            type: 'song',
          }),
        ]),
      }));
      expect(showToast).toHaveBeenCalledWith('Liturgia criada com sucesso!', 'success');
    });
  });

  it('allows admin to delete a liturgy after confirmation', async () => {
    getLiturgies.mockResolvedValue(mockLiturgies);
    const user = userEvent.setup();
    const showToast = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<LiturgiesView groupId="min-1" userRole="admin" allSongs={mockSongs} showToast={showToast} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Excluir liturgia Culto de Celebração - Manhã')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('Excluir liturgia Culto de Celebração - Manhã'));

    expect(window.confirm).toHaveBeenCalled();
    expect(deleteLiturgy).toHaveBeenCalledWith('min-1', 'lit-1');
    expect(showToast).toHaveBeenCalledWith('Liturgia removida com sucesso.', 'success');
  });

  it('enforces member read-only mode with zero write controls', async () => {
    getLiturgies.mockResolvedValue(mockLiturgies);
    render(<LiturgiesView groupId="min-1" userRole="member" allSongs={mockSongs} />);

    await waitFor(() => {
      expect(screen.getByText('Culto de Celebração - Manhã')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: 'Nova Liturgia' })).not.toBeInTheDocument();
    expect(screen.queryByTitle('Excluir liturgia')).not.toBeInTheDocument();
  });

  it('clears state, closes modal and fetches new liturgies on ministry change', async () => {
    getLiturgies.mockResolvedValueOnce(mockLiturgies);
    const user = userEvent.setup();
    const { rerender } = render(<LiturgiesView groupId="min-1" userRole="admin" allSongs={mockSongs} />);

    await waitFor(() => {
      expect(screen.getByText('Culto de Celebração - Manhã')).toBeInTheDocument();
    });

    // Open creation modal
    await user.click(screen.getByRole('button', { name: 'Nova Liturgia' }));
    expect(screen.getByText('Nova Liturgia / Ordem do Culto')).toBeInTheDocument();

    // Switch ministry
    const ministry2Liturgies = [
      {
        id: 'lit-2',
        ministryId: 'min-2',
        title: 'Culto de Jovens - Sábado',
        date: '2026-09-19T19:00:00.000Z',
        description: 'Vigília de Louvor',
        items: [],
        createdAt: '2026-09-02',
        updatedAt: '2026-09-02',
      },
    ];
    getLiturgies.mockResolvedValueOnce(ministry2Liturgies);

    rerender(<LiturgiesView groupId="min-2" userRole="admin" allSongs={mockSongs} />);

    await waitFor(() => {
      expect(getLiturgies).toHaveBeenCalledWith('min-2');
      expect(screen.getByText('Culto de Jovens - Sábado')).toBeInTheDocument();
      // Ensure previous ministry liturgy is NOT rendered
      expect(screen.queryByText('Culto de Celebração - Manhã')).not.toBeInTheDocument();
      // Ensure modal was closed on tenant change
      expect(screen.queryByText('Nova Liturgia / Ordem do Culto')).not.toBeInTheDocument();
    });
  });

  it('renders empty prompt when no ministry is selected', async () => {
    render(<LiturgiesView groupId="" userRole="member" allSongs={mockSongs} />);

    expect(screen.getByText('Nenhum ministério selecionado')).toBeInTheDocument();
    expect(getLiturgies).not.toHaveBeenCalled();
  });
});
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardView } from './DashboardView';
import { Ministry, Announcement } from '../types';

const {
  getMinistryMembers,
  getAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
} = vi.hoisted(() => ({
  getMinistryMembers: vi.fn(),
  getAnnouncements: vi.fn(),
  createAnnouncement: vi.fn(),
  updateAnnouncement: vi.fn(),
  deleteAnnouncement: vi.fn(),
}));

vi.mock('../api', () => ({
  api: {
    getMinistryMembers,
    getAnnouncements,
    createAnnouncement,
    updateAnnouncement,
    deleteAnnouncement,
  },
}));

const mockMinistry: Ministry = {
  id: 'min-1',
  name: 'Ministério Central',
  ownerUserId: 'user-admin',
  subscriptionStatus: 'active',
  role: 'admin',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const mockAnnouncements: Announcement[] = [
  {
    id: 'ann-1',
    ministryId: 'min-1',
    title: 'Ensaio Geral',
    content: 'Ensaio nesta Quinta às 19h30 no templo principal.',
    author: 'Liderança de Louvor',
    important: true,
    createdBy: 'user-admin',
    createdAt: '2026-09-09T14:00:00.000Z',
    updatedAt: '2026-09-09T14:00:00.000Z',
  },
  {
    id: 'ann-2',
    ministryId: 'min-1',
    title: 'Vestimenta de Domingo',
    content: 'Paleta de tons pretos para o culto da noite.',
    author: 'Coordenação',
    important: false,
    createdBy: 'user-admin',
    createdAt: '2026-09-08T18:00:00.000Z',
    updatedAt: '2026-09-08T18:00:00.000Z',
  },
];

const defaultProps = {
  currentUser: { id: 'user-admin', email: 'admin@louvaio.test', name: 'Pastor Henrique' },
  ministries: [mockMinistry],
  activeMinistry: mockMinistry,
  schedules: [],
  userRole: 'admin' as const,
  onNavigateToRepertoire: vi.fn(),
  onNavigateToSchedules: vi.fn(),
  onSelectSchedule: vi.fn(),
};

describe('DashboardView - Persisted Announcements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMinistryMembers.mockResolvedValue([]);
    getAnnouncements.mockResolvedValue(mockAnnouncements);
  });

  it('1. Renderiza avisos persistidos da API no carregamento', async () => {
    render(<DashboardView {...defaultProps} />);

    expect(screen.getByText(/Avisos Recentes/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Ensaio Geral')).toBeInTheDocument();
      expect(screen.getByText('Vestimenta de Domingo')).toBeInTheDocument();
    });

    expect(screen.getByText(/Ensaio nesta Quinta às 19h30/i)).toBeInTheDocument();
    expect(screen.getByText('Importante')).toBeInTheDocument();
    expect(screen.getByText('Liderança de Louvor')).toBeInTheDocument();
    expect(getAnnouncements).toHaveBeenCalledWith('min-1');
  });

  it('2. Exibe estado vazio real com CTA para Administrador quando lista é vazia', async () => {
    getAnnouncements.mockResolvedValue([]);

    render(<DashboardView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Nenhum aviso no momento.')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /Criar Primeiro Aviso/i })).toBeInTheDocument();
    expect(screen.queryByText('Ensaio Geral')).not.toBeInTheDocument();
  });

  it('3. Membro tem experiência estritamente somente-leitura (sem botões de criar, editar ou excluir)', async () => {
    getAnnouncements.mockResolvedValue(mockAnnouncements);

    const memberMinistry: Ministry = { ...mockMinistry, role: 'member' };
    render(
      <DashboardView
        {...defaultProps}
        activeMinistry={memberMinistry}
        userRole="member"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Ensaio Geral')).toBeInTheDocument();
    });

    // Membro não vê botão Novo Aviso no cabeçalho
    expect(screen.queryByRole('button', { name: /Criar novo aviso/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Novo Aviso/i })).not.toBeInTheDocument();

    // Membro não vê ações de editar ou excluir nos cards
    expect(screen.queryByRole('button', { name: /Editar aviso Ensaio Geral/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Excluir aviso Ensaio Geral/i })).not.toBeInTheDocument();
  });

  it('4. Membro em ministério sem avisos vê mensagem amigável sem botão de criar', async () => {
    getAnnouncements.mockResolvedValue([]);

    const memberMinistry: Ministry = { ...mockMinistry, role: 'member' };
    render(
      <DashboardView
        {...defaultProps}
        activeMinistry={memberMinistry}
        userRole="member"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Nenhum aviso no momento.')).toBeInTheDocument();
      expect(screen.getByText(/Fique atento para novidades e recados da equipe/i)).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /Criar Primeiro Aviso/i })).not.toBeInTheDocument();
  });

  it('5. Exibe alerta de erro e permite tentar novamente sem colisão com empty state', async () => {
    getAnnouncements.mockRejectedValueOnce(new Error('Erro de conexão com o banco'));

    render(<DashboardView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Erro de conexão com o banco')).toBeInTheDocument();
    });

    // Não deve exibir texto de empty state durante erro
    expect(screen.queryByText('Nenhum aviso no momento.')).not.toBeInTheDocument();

    // Clicar em tentar novamente
    getAnnouncements.mockResolvedValueOnce(mockAnnouncements);
    const retryBtn = screen.getByRole('button', { name: /Tentar novamente/i });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText('Ensaio Geral')).toBeInTheDocument();
    });
  });

  it('6. Administrador pode criar novo aviso com sucesso via modal', async () => {
    const user = userEvent.setup();
    const newAnnouncement: Announcement = {
      id: 'ann-new',
      ministryId: 'min-1',
      title: 'Aviso Novo Culto',
      content: 'Horário do culto antecipado para 18h.',
      author: 'Pastor Henrique',
      important: true,
      createdBy: 'user-admin',
      createdAt: '2026-09-09T16:00:00.000Z',
      updatedAt: '2026-09-09T16:00:00.000Z',
    };
    createAnnouncement.mockResolvedValue(newAnnouncement);

    render(<DashboardView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Ensaio Geral')).toBeInTheDocument();
    });

    const createBtn = screen.getByRole('button', { name: /Criar novo aviso/i });
    await user.click(createBtn);

    expect(screen.getByRole('heading', { name: 'Novo Aviso' })).toBeInTheDocument();

    const titleInput = screen.getByPlaceholderText(/Ex: Ensaio Geral/i);
    const contentInput = screen.getByPlaceholderText(/Escreva o recado para a equipe/i);
    const importantCheckbox = screen.getByLabelText(/Marcar como aviso importante/i);

    await user.clear(titleInput);
    await user.type(titleInput, 'Aviso Novo Culto');
    await user.clear(contentInput);
    await user.type(contentInput, 'Horário do culto antecipado para 18h.');
    await user.click(importantCheckbox);

    const submitBtn = screen.getByRole('button', { name: /Publicar Aviso/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(createAnnouncement).toHaveBeenCalledWith('min-1', {
        title: 'Aviso Novo Culto',
        content: 'Horário do culto antecipado para 18h.',
        author: 'Pastor Henrique',
        important: true,
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Aviso Novo Culto')).toBeInTheDocument();
    });
  });

  it('7. Administrador pode editar aviso existente via modal', async () => {
    const user = userEvent.setup();
    const updatedAnnouncement: Announcement = {
      ...mockAnnouncements[0],
      title: 'Ensaio Geral Alterado',
      content: 'Novo local de ensaio.',
    };
    updateAnnouncement.mockResolvedValue(updatedAnnouncement);

    render(<DashboardView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Ensaio Geral')).toBeInTheDocument();
    });

    const editBtn = screen.getByRole('button', { name: /Editar aviso Ensaio Geral/i });
    await user.click(editBtn);

    expect(screen.getByRole('heading', { name: 'Editar Aviso' })).toBeInTheDocument();

    const titleInput = screen.getByDisplayValue('Ensaio Geral');
    await user.clear(titleInput);
    await user.type(titleInput, 'Ensaio Geral Alterado');

    const saveBtn = screen.getByRole('button', { name: /Salvar Alterações/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(updateAnnouncement).toHaveBeenCalledWith(
        'min-1',
        'ann-1',
        expect.objectContaining({
          title: 'Ensaio Geral Alterado',
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Ensaio Geral Alterado')).toBeInTheDocument();
    });
  });

  it('8. Administrador pode excluir aviso com confirmação', async () => {
    const user = userEvent.setup();
    deleteAnnouncement.mockResolvedValue(undefined);

    render(<DashboardView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Ensaio Geral')).toBeInTheDocument();
    });

    const deleteBtn = screen.getByRole('button', { name: /Excluir aviso Ensaio Geral/i });
    await user.click(deleteBtn);

    expect(screen.getByRole('heading', { name: 'Excluir Aviso' })).toBeInTheDocument();
    expect(screen.getByText(/Tem certeza que deseja excluir o aviso/i)).toBeInTheDocument();

    const confirmDeleteBtn = screen.getByRole('button', { name: 'Excluir' });
    await user.click(confirmDeleteBtn);

    await waitFor(() => {
      expect(deleteAnnouncement).toHaveBeenCalledWith('min-1', 'ann-1');
    });

    await waitFor(() => {
      expect(screen.queryByText('Ensaio Geral')).not.toBeInTheDocument();
    });
  });

  it('9. Fecha modal com tecla Escape', async () => {
    const user = userEvent.setup();
    render(<DashboardView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Ensaio Geral')).toBeInTheDocument();
    });

    const createBtn = screen.getByRole('button', { name: /Criar novo aviso/i });
    await user.click(createBtn);

    expect(screen.getByRole('heading', { name: 'Novo Aviso' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Novo Aviso' })).not.toBeInTheDocument();
    });
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { api } from '../api';

const mockUser = { id: 'user-compliance', email: 'integrante@louvaio.test', name: 'Líder Compliance' };
const mockMinistry = {
  id: 'min-test',
  name: 'Ministério de Louvor Central',
  ownerUserId: 'user-other',
  subscriptionStatus: 'active' as const,
  role: 'member' as const,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

vi.mock('../api', () => ({
  api: {
    getMe: vi.fn(),
    login: vi.fn(),
    getMyGroups: vi.fn(),
    getMyMinistries: vi.fn(),
    getMinistrySubscription: vi.fn(),
    getLiturgies: vi.fn(),
    getSongs: vi.fn(),
    getFolders: vi.fn(),
    getArtists: vi.fn(),
    getCounts: vi.fn(),
    getClassifications: vi.fn(),
    getSchedules: vi.fn(),
    getMinistryMembers: vi.fn(),
    getAnnouncements: vi.fn(),
    getAccountDeletionPreflight: vi.fn(),
    getAccountDeletionStatus: vi.fn(),
    reauthenticateAndGetFreshToken: vi.fn(),
    executeAccountDeletion: vi.fn(),
  },
}));

describe('Compliance Routing & App Integration (/privacidade & /exclusao-conta)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(api.getMinistrySubscription).mockResolvedValue({
      subscription: { planId: 'pro', accessMode: 'normal' },
      usage: { membersCount: 5, songsCount: 20 },
      limits: { maxMembers: 100, maxSongs: 500 },
    } as any);
    vi.mocked(api.getLiturgies).mockResolvedValue([]);
    vi.mocked(api.getSongs).mockResolvedValue({ songs: [], totalCount: 0 });
    vi.mocked(api.getFolders).mockResolvedValue([]);
    vi.mocked(api.getArtists).mockResolvedValue([]);
    vi.mocked(api.getCounts).mockResolvedValue({ songs: 0, folders: 0, artists: 0 });
    vi.mocked(api.getClassifications).mockResolvedValue([]);
    vi.mocked(api.getSchedules).mockResolvedValue([]);
    vi.mocked(api.getMinistryMembers).mockResolvedValue([]);
    vi.mocked(api.getAnnouncements).mockResolvedValue([]);
  });

  it('renders /privacidade publicly without authentication or sidebar shell', () => {
    render(
      <MemoryRouter initialEntries={['/privacidade']}>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByText('Política de Privacidade')).toBeInTheDocument();
    expect(screen.getByText(/1\. Informações Coletadas e Processadas/i)).toBeInTheDocument();
    expect(screen.queryByText('Acesse sua conta')).not.toBeInTheDocument();
    expect(screen.queryByText('Painel')).not.toBeInTheDocument();
  });

  it('renders /exclusao-conta publicly without authentication', async () => {
    render(
      <MemoryRouter initialEntries={['/exclusao-conta']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Exclusão Definitiva de Conta')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /Excluir minha conta/i })).toBeInTheDocument();
    expect(screen.queryByText('Acesse sua conta')).not.toBeInTheDocument();
  });

  it('routes unauthenticated user from /exclusao-conta through login and returns to preflight', async () => {
    const user = userEvent.setup();

    vi.mocked(api.login).mockResolvedValue({
      user: mockUser,
      token: 'new-auth-token',
    });
    vi.mocked(api.getMe).mockResolvedValue(mockUser);
    vi.mocked(api.getMyGroups).mockResolvedValue([mockMinistry]);
    vi.mocked(api.getAccountDeletionPreflight).mockResolvedValue({
      deletionAllowed: true,
      blockers: [],
      activeJob: null,
    });

    render(
      <MemoryRouter initialEntries={['/exclusao-conta']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Exclusão Definitiva de Conta')).toBeInTheDocument();
    });

    // Click primary CTA "Excluir minha conta"
    const ctaBtn = screen.getByRole('button', { name: /Excluir minha conta/i });
    await user.click(ctaBtn);

    // Now login page is displayed
    expect(screen.getByText('Acesse sua conta')).toBeInTheDocument();

    // Fill login
    const emailInput = screen.getByLabelText(/Endereço de E-mail/i);
    const passwordInput = screen.getByLabelText(/^Senha$/i);
    const submitBtn = screen.getByRole('button', { name: /Entrar no LouvAIO/i });

    await user.type(emailInput, 'integrante@louvaio.test');
    await user.type(passwordInput, 'senha123');
    await user.click(submitBtn);

    // After login success, user returns to /exclusao-conta in authenticated mode
    await waitFor(() => {
      expect(screen.getByText('Confirmação de Ação Destrutiva')).toBeInTheDocument();
    });

    expect(api.getAccountDeletionPreflight).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/integrante@louvaio\.test/i)).toBeInTheDocument();
  });

  it('directly checks preflight on /exclusao-conta when already authenticated', async () => {
    localStorage.setItem('praise_auth_token', 'valid-token');
    vi.mocked(api.getMe).mockResolvedValue(mockUser);
    vi.mocked(api.getMyGroups).mockResolvedValue([mockMinistry]);
    vi.mocked(api.getAccountDeletionPreflight).mockResolvedValue({
      deletionAllowed: false,
      blockers: [
        {
          code: 'SOLE_MINISTRY_ADMIN',
          message: 'Você é o único administrador do ministério "Central".',
        },
      ],
      activeJob: null,
    });

    render(
      <MemoryRouter initialEntries={['/exclusao-conta']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Exclusão não permitida no momento')).toBeInTheDocument();
    });

    expect(screen.getByText('Você é o único administrador do ministério "Central".')).toBeInTheDocument();
    expect(api.getAccountDeletionPreflight).toHaveBeenCalledTimes(1);
  });
});

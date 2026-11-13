import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

const authMocks = vi.hoisted(() => ({
  getMe: vi.fn(),
  getMyGroups: vi.fn(),
  getMinistrySubscription: vi.fn(),
  getCounts: vi.fn(),
  getClassifications: vi.fn(),
  getSchedules: vi.fn(),
  getSongs: vi.fn(),
  getFolders: vi.fn(),
  getArtists: vi.fn(),
  getSmartChords: vi.fn(),
}));

vi.mock('./api', () => ({
  api: authMocks,
}));

describe('Phase B — Expired Session Handling on Global 401 Event', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('praise_auth_token', 'valid-token-123');

    authMocks.getMe.mockResolvedValue({
      id: 'user-1',
      name: 'Pastor João',
      email: 'joao@louvaio.com',
      role: 'admin',
    });
    authMocks.getMyGroups.mockResolvedValue([
      { id: 'min-1', name: 'Ministério Central', role: 'admin', ownerUserId: 'user-1' },
    ]);
    authMocks.getMinistrySubscription.mockResolvedValue({
      plan: { id: 'free', name: 'Free' },
      subscription: { accessMode: 'normal', administrativelySuspended: false, cancelAtPeriodEnd: false },
      quotas: { members: 10, songs: 50 },
      usage: { membersCount: 1, songsCount: 1 },
      isOverLimit: false,
      overLimitDetails: [],
      graceDaysRemaining: null,
      pendingTransition: null,
      paymentStatus: { state: 'current' },
      graceReason: null,
    });
    authMocks.getCounts.mockResolvedValue({ songs: 0, folders: 0, artists: 0 });
    authMocks.getClassifications.mockResolvedValue([]);
    authMocks.getSchedules.mockResolvedValue([]);
    authMocks.getSongs.mockResolvedValue({ songs: [], totalCount: 0 });
    authMocks.getFolders.mockResolvedValue([]);
    authMocks.getArtists.mockResolvedValue([]);
    authMocks.getSmartChords.mockResolvedValue([]);
  });

  it('limpa token e estado e redireciona para Login ao receber louvaio:session-expired', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText('Ministério Central').length).toBeGreaterThan(0);
    });

    await act(async () => {
      window.dispatchEvent(new CustomEvent('louvaio:session-expired', { detail: { status: 401 } }));
    });

    await waitFor(() => {
      expect(localStorage.getItem('praise_auth_token')).toBeNull();
      expect(screen.getByText(/Sua sessão expirou\. Faça login novamente\./i)).toBeInTheDocument();
      expect(screen.queryByText('Ministério Central')).not.toBeInTheDocument();
    });
  });
});

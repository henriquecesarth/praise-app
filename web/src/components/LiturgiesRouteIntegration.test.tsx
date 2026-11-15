import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import App from '../App';
import { api } from '../api';

const mockUser = { id: 'user-1', email: 'admin@louvaio.test', name: 'Líder de Louvor' };
const mockMinistry = {
  id: 'min-alpha',
  name: 'Comunidade da Graça',
  ownerUserId: 'user-1',
  subscriptionStatus: 'active' as const,
  role: 'admin' as const,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

vi.mock('../api', () => ({
  api: {
    getMe: vi.fn(),
    getMyGroups: vi.fn(),
    getMyMinistries: vi.fn(),
    getMinistrySubscription: vi.fn(),
    getSongs: vi.fn(),
    getFolders: vi.fn(),
    getArtists: vi.fn(),
    getCounts: vi.fn(),
    getClassifications: vi.fn(),
    getSchedules: vi.fn(),
    getMinistryMembers: vi.fn(),
    getAnnouncements: vi.fn(),
  },
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="current-pathname">{location.pathname}</div>;
}

describe('Liturgies Legacy Route Redirect & Discontinuation Integration', () => {
  beforeEach(() => {
    localStorage.setItem('praise_auth_token', 'mock-token');
    vi.mocked(api.getMe).mockResolvedValue(mockUser);
    vi.mocked(api.getMyGroups).mockResolvedValue([mockMinistry]);
    vi.mocked(api.getMyMinistries).mockResolvedValue([mockMinistry]);
    vi.mocked(api.getMinistrySubscription).mockResolvedValue({
      subscription: { planId: 'pro', accessMode: 'normal' },
      usage: { membersCount: 5, songsCount: 20 },
      limits: { maxMembers: 100, maxSongs: 500 },
    } as any);
    vi.mocked(api.getSongs).mockResolvedValue({ songs: [], totalCount: 0 });
    vi.mocked(api.getFolders).mockResolvedValue([]);
    vi.mocked(api.getArtists).mockResolvedValue([]);
    vi.mocked(api.getCounts).mockResolvedValue({ songs: 0, folders: 0, artists: 0 });
    vi.mocked(api.getClassifications).mockResolvedValue([]);
    vi.mocked(api.getSchedules).mockResolvedValue([]);
    vi.mocked(api.getMinistryMembers).mockResolvedValue([]);
    vi.mocked(api.getAnnouncements).mockResolvedValue([]);
  });

  it('redirects legacy /liturgias deep link directly to /escalas and renders Escalas do Louvor', async () => {
    render(
      <MemoryRouter initialEntries={['/liturgias']}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('current-pathname')).toHaveTextContent('/escalas');
      expect(screen.getByText('Escalas do Louvor')).toBeInTheDocument();
      expect(screen.getAllByText('Comunidade da Graça').length).toBeGreaterThanOrEqual(1);
    });

    expect(screen.queryByText('Liturgias & Ordem de Culto')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Liturgias/i })).not.toBeInTheDocument();
  });

  it('does not expose standalone Liturgias button in desktop sidebar', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText('Comunidade da Graça').length).toBeGreaterThanOrEqual(1);
    });

    expect(screen.queryByRole('button', { name: /Liturgias/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Escalas$/i }).length).toBeGreaterThanOrEqual(1);
  });
});
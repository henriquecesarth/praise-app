import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
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
const mockLiturgies = [
  {
    id: 'lit-1',
    ministryId: 'min-alpha',
    title: 'Culto de Domingo Noite',
    date: '2026-09-20T19:00:00.000Z',
    description: 'Culto de Celebração e Adoração',
    createdBy: 'user-1',
    items: [],
    createdAt: '2026-09-01',
    updatedAt: '2026-09-01',
  },
];

vi.mock('../api', () => ({
  api: {
    getMe: vi.fn(),
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
  },
}));

describe('Liturgies Direct Route & App Integration', () => {
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
    vi.mocked(api.getLiturgies).mockResolvedValue(mockLiturgies);
    vi.mocked(api.getSongs).mockResolvedValue({ songs: [], totalCount: 0 });
    vi.mocked(api.getFolders).mockResolvedValue([]);
    vi.mocked(api.getArtists).mockResolvedValue([]);
    vi.mocked(api.getCounts).mockResolvedValue({ songs: 0, folders: 0, artists: 0 });
    vi.mocked(api.getClassifications).mockResolvedValue([]);
    vi.mocked(api.getSchedules).mockResolvedValue([]);
    vi.mocked(api.getMinistryMembers).mockResolvedValue([]);
    vi.mocked(api.getAnnouncements).mockResolvedValue([]);
  });

  it('directly renders LiturgiesView when accessing /liturgias deep link without redirecting to dashboard', async () => {
    render(
      <MemoryRouter initialEntries={['/liturgias']}>
        <App />
      </MemoryRouter>
    );

    // Wait for session and ministry to load
    await waitFor(() => {
      expect(screen.getByText('Liturgias & Ordem de Culto')).toBeInTheDocument();
      expect(screen.getByText('Culto de Domingo Noite')).toBeInTheDocument();
      expect(screen.getAllByText('Comunidade da Graça').length).toBeGreaterThanOrEqual(1);
    });

    // Check header and desktop sidebar highlight
    const liturgiesNavButtons = screen.getAllByRole('button', { name: /Liturgias/i });
    expect(liturgiesNavButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('navigates from sidebar to Liturgias and updates active view', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText('Comunidade da Graça').length).toBeGreaterThanOrEqual(1);
    });

    // Click Liturgias button in sidebar
    const liturgiesBtn = screen.getByRole('button', { name: /^Liturgias$/i });
    await user.click(liturgiesBtn);

    await waitFor(() => {
      expect(screen.getByText('Culto de Domingo Noite')).toBeInTheDocument();
      expect(screen.getByText('Liturgias & Ordem de Culto')).toBeInTheDocument();
    });
  });
});
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { api } from '../api';
import { SmartChordsWorkspace } from './SmartChordsWorkspace';
import { preferenceWriter, PreferenceWriter } from '../utils/preferenceWriter';

const mockUserA = {
  id: 'user-a',
  email: 'admin-a@louvaio.test',
  name: 'User A',
  preferences: {
    chordFontFamily: 'Georgia',
  },
};

const mockMinistry = {
  id: 'min-alpha',
  name: 'Comunidade da Graça',
  ownerUserId: 'user-a',
  subscriptionStatus: 'active' as const,
  role: 'admin' as const,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

const mockSong = {
  id: 'song-1',
  ministryId: 'min-alpha',
  title: 'Oceanos',
  originalKey: 'D',
  content: '[D]Tu és [A]Deus',
  versions: [{ id: 'v1', name: 'Principal', key: 'D' }],
};

const mockChord = {
  id: 'sc-1',
  ministryId: 'min-alpha',
  userId: 'user-a',
  songId: 'song-1',
  title: 'Oceanos - Cifra',
  content: '[D]Tu és [A]Deus',
  originalKey: 'D',
};

vi.mock('../api', () => ({
  api: {
    getMe: vi.fn(),
    getMyGroups: vi.fn(),
    getMyMinistries: vi.fn(),
    getMinistrySubscription: vi.fn(),
    getLiturgies: vi.fn(),
    getSongs: vi.fn(),
    getSongById: vi.fn(),
    getFolders: vi.fn(),
    getArtists: vi.fn(),
    getCounts: vi.fn(),
    getClassifications: vi.fn(),
    getSchedules: vi.fn(),
    getMinistryMembers: vi.fn(),
    getAnnouncements: vi.fn(),
    getSmartChordById: vi.fn(),
    getSmartChordRepertoireLink: vi.fn(),
    getSmartChords: vi.fn(),
    getMySmartChordsForSong: vi.fn(),
    updateUserPreferences: vi.fn(),
  },
}));

describe('Targeted Chord Font Synchronization Regressions (WEB-01 & WEB-02)', () => {
  beforeEach(() => {
    localStorage.clear();
    preferenceWriter.reset();
    vi.clearAllMocks();
    vi.mocked(api.getArtists).mockResolvedValue([]);
    vi.mocked(api.getFolders).mockResolvedValue([]);
    vi.mocked(api.getCounts).mockResolvedValue({ songs: 0, folders: 0, artists: 0 });
    vi.mocked(api.getClassifications).mockResolvedValue([]);
    vi.mocked(api.getSchedules).mockResolvedValue([]);
    vi.mocked(api.getMinistryMembers).mockResolvedValue([]);
    vi.mocked(api.getAnnouncements).mockResolvedValue([]);
    vi.mocked(api.getLiturgies).mockResolvedValue([]);
    vi.mocked(api.getSongs).mockResolvedValue({ songs: [], totalCount: 0 } as any);
    vi.mocked(api.getSmartChords).mockResolvedValue([]);
    vi.mocked(api.getMySmartChordsForSong).mockResolvedValue([mockChord as any]);
    vi.mocked(api.getSmartChordById).mockResolvedValue(mockChord as any);
    vi.mocked(api.getSmartChordRepertoireLink).mockResolvedValue({ linked: true, songId: 'song-1' } as any);
  });

  it('1. Georgia -> Verdana -> navigate to SongDetail -> Verdana (WEB-01 App state sync)', async () => {
    localStorage.setItem('praise_auth_token', 'mock-token');
    vi.mocked(api.getMe).mockResolvedValue({ ...mockUserA });
    vi.mocked(api.getMyGroups).mockResolvedValue([mockMinistry]);
    vi.mocked(api.getMyMinistries).mockResolvedValue([mockMinistry]);
    vi.mocked(api.getMinistrySubscription).mockResolvedValue({
      subscription: { planId: 'pro', accessMode: 'normal' },
      usage: { membersCount: 5, songsCount: 20 },
      limits: { maxMembers: 100, maxSongs: 500 },
    } as any);
    vi.mocked(api.getSongs).mockResolvedValue({ songs: [mockSong as any], totalCount: 1 });
    vi.mocked(api.getSongById).mockResolvedValue(mockSong as any);
    vi.mocked(api.updateUserPreferences).mockResolvedValue({
      preferences: { chordFontFamily: 'Verdana' },
    });

    render(
      <MemoryRouter initialEntries={['/cifras']}>
        <App />
      </MemoryRouter>
    );

    const createBtn = await screen.findByRole('button', { name: /Criar Cifra/i });
    fireEvent.click(createBtn);

    const fontSelect = await screen.findByTestId('font-family-select');
    expect(fontSelect).toHaveValue('Georgia');

    // Change to Verdana
    fireEvent.change(fontSelect, { target: { value: 'Verdana' } });

    await waitFor(() => {
      expect(api.updateUserPreferences).toHaveBeenCalledWith({ chordFontFamily: 'Verdana' });
    });

    // Navigate to Repertoire and click the song
    const user = userEvent.setup();
    const repButtons = screen.getAllByRole('button', { name: /Repertório/i });
    await user.click(repButtons[0]);

    const songCard = await screen.findByText('Oceanos');
    await user.click(songCard);

    // SongDetail must display Verdana
    const chordSheet = await screen.findByTestId('song-detail-chord-sheet');
    expect(chordSheet).toHaveStyle({ fontFamily: 'Verdana, Geneva, sans-serif' });
  });

  it('2. Arial -> Verdana rapidly -> serialized and persisted value ends as Verdana (WEB-02)', async () => {
    localStorage.setItem('praise_auth_token', 'mock-token');
    vi.mocked(api.getMe).mockResolvedValue({ ...mockUserA });

    let inFlightCount = 0;
    let maxConcurrent = 0;
    const patchCalls: string[] = [];
    let resolveArial: any;
    let resolveVerdana: any;

    vi.mocked(api.updateUserPreferences).mockImplementation(async ({ chordFontFamily }: any) => {
      inFlightCount++;
      maxConcurrent = Math.max(maxConcurrent, inFlightCount);
      patchCalls.push(chordFontFamily);

      try {
        if (chordFontFamily === 'Arial') {
          return await new Promise((resolve) => {
            resolveArial = resolve;
          });
        }
        if (chordFontFamily === 'Verdana') {
          return await new Promise((resolve) => {
            resolveVerdana = resolve;
          });
        }
        return { preferences: { chordFontFamily } };
      } finally {
        inFlightCount--;
      }
    });

    render(<SmartChordsWorkspace ministryId="min-alpha" />);

    const createBtn = await screen.findByRole('button', { name: /Criar Cifra/i });
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(screen.getByTestId('font-family-select')).toBeInTheDocument();
    });

    const fontSelect = screen.getByTestId('font-family-select');

    // 1. User selects Arial (in-flight)
    fireEvent.change(fontSelect, { target: { value: 'Arial' } });

    // 2. User rapidly selects Verdana (while Arial is in flight)
    fireEvent.change(fontSelect, { target: { value: 'Verdana' } });

    expect(maxConcurrent).toBe(1);
    expect(patchCalls).toEqual(['Arial']);

    // Complete Arial
    resolveArial({ preferences: { chordFontFamily: 'Arial' } });

    // Queued Verdana is now dispatched
    await waitFor(() => {
      expect(patchCalls).toEqual(['Arial', 'Verdana']);
    });

    expect(maxConcurrent).toBe(1);

    // Complete Verdana
    resolveVerdana({ preferences: { chordFontFamily: 'Verdana' } });

    await waitFor(() => {
      expect(screen.getByTestId('font-family-select')).toHaveValue('Verdana');
    });

    expect(preferenceWriter.getLatestConfirmedFont()).toBe('Verdana');
  });

  it('3. Reversed asynchronous completion cannot persist older selection', async () => {
    const executedCalls: string[] = [];
    let resolveFirst: any;
    let resolveSecond: any;

    const customWriter = new PreferenceWriter({
      updateUserPreferences: async ({ chordFontFamily }) => {
        executedCalls.push(chordFontFamily);
        if (chordFontFamily === 'Arial') {
          return new Promise((r) => { resolveFirst = r; });
        }
        if (chordFontFamily === 'Georgia') {
          return new Promise((r) => { resolveSecond = r; });
        }
        return { preferences: { chordFontFamily } };
      },
    });

    customWriter.setSession('user-1', 'monospace');

    // Select Arial
    const p1 = customWriter.updateFont('Arial');
    // Rapidly select Georgia
    const p2 = customWriter.updateFont('Georgia');

    // Arial is in flight
    expect(executedCalls).toEqual(['Arial']);

    // Complete Arial
    resolveFirst({ preferences: { chordFontFamily: 'Arial' } });
    await p1;

    // Georgia is dispatched
    await waitFor(() => {
      expect(executedCalls).toEqual(['Arial', 'Georgia']);
    });

    // Complete Georgia
    resolveSecond({ preferences: { chordFontFamily: 'Georgia' } });
    await p2;

    expect(customWriter.getLatestConfirmedFont()).toBe('Georgia');
    expect(customWriter.getLatestRequestedFont()).toBe('Georgia');
  });

  it('4. Earlier failed PATCH does not block a later valid update', async () => {
    let callCount = 0;
    const calls: string[] = [];

    const customWriter = new PreferenceWriter({
      updateUserPreferences: async ({ chordFontFamily }) => {
        callCount++;
        calls.push(chordFontFamily);
        if (chordFontFamily === 'Arial') {
          throw new Error('Network failure on Arial');
        }
        return { preferences: { chordFontFamily } };
      },
    });

    customWriter.setSession('user-1', 'monospace');

    // First write fails
    await expect(customWriter.updateFont('Arial')).rejects.toThrow('Network failure on Arial');
    expect(calls).toEqual(['Arial']);

    // Next write is NOT blocked and succeeds
    const result = await customWriter.updateFont('Verdana');
    expect(result).toBe('Verdana');
    expect(calls).toEqual(['Arial', 'Verdana']);
    expect(customWriter.getLatestConfirmedFont()).toBe('Verdana');
  });

  it('5. Last PATCH failure is reported without false confirmation', async () => {
    let errorCaught: any = null;

    const customWriter = new PreferenceWriter({
      updateUserPreferences: async () => {
        throw new Error('Backend 500');
      },
      onError: (err) => {
        errorCaught = err;
      },
    });

    customWriter.setSession('user-1', 'monospace');

    await expect(customWriter.updateFont('Georgia')).rejects.toThrow('Backend 500');
    expect(errorCaught).toBeDefined();
    // Confirmed font must remain null (not falsely confirmed as Georgia)
    expect(customWriter.getLatestConfirmedFont()).toBe('monospace');
  });

  it('6. Account switching does not apply an old user pending preference to the new account', async () => {
    const executed: { font: string; userId: string }[] = [];
    let resolveUserA: any;

    const customWriter = new PreferenceWriter({
      updateUserPreferences: async ({ chordFontFamily }) => {
        const uid = customWriter.getActiveUserId() || '';
        executed.push({ font: chordFontFamily, userId: uid });
        if (chordFontFamily === 'Arial') {
          return new Promise((r) => { resolveUserA = r; });
        }
        return { preferences: { chordFontFamily } };
      },
    });

    // User A active
    customWriter.setSession('user-a', 'monospace');
    customWriter.updateFont('Arial'); // in flight for user A
    customWriter.updateFont('Georgia'); // queued pending for user A

    expect(executed).toEqual([{ font: 'Arial', userId: 'user-a' }]);

    // User switches to User B!
    customWriter.setSession('user-b', 'monospace');

    // User A in-flight finishes
    resolveUserA({ preferences: { chordFontFamily: 'Arial' } });
    await new Promise((r) => setTimeout(r, 20));

    // Georgia must NEVER be sent for user-b!
    expect(executed).toEqual([{ font: 'Arial', userId: 'user-a' }]);

    // User B writes Verdana
    await customWriter.updateFont('Verdana');
    expect(executed).toEqual([
      { font: 'Arial', userId: 'user-a' },
      { font: 'Verdana', userId: 'user-b' },
    ]);
  });

  it('7. Both selectors and PDF preview remain synchronized', async () => {
    localStorage.setItem('praise_auth_token', 'mock-token');
    vi.mocked(api.getMe).mockResolvedValue({
      id: 'user-1',
      email: 'user1@example.com',
      name: 'User 1',
      preferences: { chordFontFamily: 'Arial' },
    });
    vi.mocked(api.updateUserPreferences).mockResolvedValue({
      preferences: { chordFontFamily: 'Verdana' },
    });

    render(<SmartChordsWorkspace ministryId="min-alpha" />);

    const createBtn = await screen.findByRole('button', { name: /Criar Cifra/i });
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(screen.getByTestId('font-family-select')).toHaveValue('Arial');
    });

    // Open print modal
    fireEvent.click(screen.getByText(/Exportar PDF/i));

    const modalSelect = screen.getByTestId('modal-font-family-select') as HTMLSelectElement;
    expect(modalSelect.value).toBe('Arial');

    // Change in modal to Verdana
    fireEvent.change(modalSelect, { target: { value: 'Verdana' } });

    // Toolbar select and modal select are synchronized
    const toolbarSelect = screen.getByTestId('font-family-select') as HTMLSelectElement;
    expect(toolbarSelect.value).toBe('Verdana');
    expect(modalSelect.value).toBe('Verdana');

    // PDF printable sheet reflects Verdana
    const modalSheet = document.getElementById('printable-sheet-pdf');
    expect(modalSheet).toHaveStyle({ fontFamily: 'Verdana, Geneva, sans-serif' });
  });
});
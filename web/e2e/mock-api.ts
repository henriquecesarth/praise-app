import type { Page, Route } from '@playwright/test';

export const mockUser = { id: 'user-1', email: 'leitura@example.test', name: 'Conta de Leitura' };
export const mockMinistry = {
  id: 'ministry-1',
  name: 'Ministério Evidência',
  slug: 'ministerio-evidencia',
  owner_user_id: 'user-1',
  subscription_status: 'active',
  role: 'admin',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-08-27T00:00:00.000Z',
};

export const mockSong = {
  id: 'song-1',
  ministry_id: 'ministry-1',
  title: 'Graça Infinita',
  artist: 'Equipe Local',
  original_key: 'G',
  bpm: 72,
  duration: '00:04:30',
  notes: 'Canção de abertura',
  versions: [{ id: 'version-1', name: 'Original', classificationIds: [], key: 'G', bpm: 72, duration: '00:04:30', links: [] }],
};

export const mockSchedule = {
  id: 'schedule-1',
  title: 'Culto de Celebração',
  date: '2027-08-27',
  time: '19:30',
  notes: 'Chegada da equipe às 18:30.',
  isVisible: true,
  colorPalette: '#2f855a',
  clothingPieces: [{ id: 'piece-1', name: 'Camisa', description: 'Tons verdes', colors: ['#2f855a'] }],
  requireConfirmation: true,
  participants: [{ id: 'user-1', name: 'Conta de Leitura', role: '🎸 Guitarra • 🎤 Vocal • Direção Musical', confirmed: true }],
  songs: [{ id: 'song-1', title: 'Graça Infinita', artist: 'Equipe Local', artistName: 'Equipe Local', originalKey: 'G', versions: [] }],
  timeline: [{ id: 'timeline-1', title: 'Louvor', time: '00:20', type: 'Música' }],
};

const members = [{
  id: 'member-1',
  user_id: 'user-1',
  name: 'Conta de Leitura',
  email: 'leitura@example.test',
  role: 'admin',
  birth_date: '1990-08-27',
  role_ids: ['role-1'],
}];

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

export async function installMockApi(page: Page) {
  const writes: Array<{ method: string; path: string }> = [];

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname.replace(/^.*\/api\/v1/, '');

    if (method !== 'GET') writes.push({ method, path });
    if (path === '/auth/login' && method === 'POST') return json(route, { user: mockUser, token: 'isolated-e2e-token' });
    if (path === '/auth/signup' && method === 'POST') return json(route, { user: mockUser, token: 'isolated-e2e-token' });
    if (path === '/auth/me') return json(route, mockUser);
    if (path === '/ministries/my-ministries') return json(route, [mockMinistry]);
    if (path.endsWith('/counts')) return json(route, { data: { songs: 1, folders: 1, artists: 1 } });
    if (path.endsWith('/classifications')) return json(route, { data: [{ id: 'class-1', ministry_id: 'ministry-1', name: 'Celebração', color: '#2f855a' }] });
    if (path.endsWith('/artists')) return json(route, { data: [{ id: 'artist-1', ministry_id: 'ministry-1', name: 'Equipe Local' }] });
    if (path.endsWith('/folders/folder-1')) return json(route, { data: { id: 'folder-1', ministry_id: 'ministry-1', name: 'Domingo', description: 'Culto principal', song_count: 1, songs: [mockSong] } });
    if (path.endsWith('/folders')) return json(route, { data: [{ id: 'folder-1', ministry_id: 'ministry-1', name: 'Domingo', description: 'Culto principal', song_count: 1, songs: [mockSong] }] });
    if (path.endsWith('/songs/song-1')) return json(route, { data: mockSong });
    if (path.includes('/songs')) return json(route, { data: [mockSong], total: 1 });
    if (path.endsWith('/schedule-templates')) return json(route, []);
    if (path.endsWith('/roles')) return json(route, [{ id: 'role-1', name: 'Guitarra', icon: '🎸' }]);
    if (path.endsWith('/teams')) return json(route, []);
    if (path.endsWith('/members')) return json(route, members);
    if (path.endsWith('/comments')) return json(route, []);
    if (path.endsWith('/confirmation')) return json(route, mockSchedule);
    if (/\/schedules\/schedule-1$/.test(path) && method !== 'DELETE') return json(route, mockSchedule);
    if (path.endsWith('/schedules')) return json(route, method === 'GET' ? [mockSchedule] : mockSchedule);
    if (path.endsWith('/liturgies')) return json(route, []);
    if (path.includes('/smart-chords')) return json(route, { data: [] });
    if (method === 'DELETE') return route.fulfill({ status: 204, body: '' });
    if (method !== 'GET') return json(route, {});
    return json(route, []);
  });

  return writes;
}

export async function seedAuthenticatedSession(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript(({ selectedTheme }) => {
    localStorage.setItem('praise_auth_token', 'isolated-e2e-token');
    localStorage.setItem('praise_theme', selectedTheme);
  }, { selectedTheme: theme });
}

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

const longSong = {
  ...mockSong,
  id: 'song-long',
  title: 'Canção Com Um Título Extraordinariamente Longo Para Validar Quebra Responsiva No Celular',
  artist: 'Comunidade Internacional de Adoração e Música Contemporânea do Bairro Central',
  notes: 'https://example.test/repertorio/uma-url-sem-quebras/abcdefghijklmnopqrstuvwxyz0123456789',
  versions: [{ id: 'version-long', name: 'Versão Especial Extraordinariamente Longa Para Celebrações Comunitárias', classificationIds: ['class-long'], key: 'F#', bpm: 128, duration: '00:08:45', links: [] }],
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
  id: 'member-1', user_id: 'user-1', name: 'Conta de Leitura', email: 'leitura@example.test', role: 'admin', birth_date: '1990-08-27', role_ids: ['role-1'],
}, {
  id: 'member-long', user_id: 'user-long', name: 'Integrante Com Nome Muito Extenso Para Validar Cartões e Cabeçalhos Responsivos', email: 'integrante.com.email.extremamente.longo.sem.quebras@subdominio.example.test', role: 'member', birth_date: '1992-02-29', role_ids: ['role-long'],
}];

const teams = [{
  id: 'team-long', ministry_id: 'ministry-1', name: 'Equipe de Celebração Comunitária Com Nome Extraordinariamente Longo', description: 'Descrição extensa da equipe para confirmar que cartões e menus permanecem dentro do viewport.', member_ids: ['member-1', 'member-long'], created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-08-27T00:00:00.000Z',
}];

const scheduleTemplates = [{
  id: 'template-long', ministry_id: 'ministry-1', name: 'Modelo de Roteiro Muito Longo Para Celebração Comunitária de Domingo à Noite', items: [{ id: 'template-item-1', type: 'event', title: 'Momento de acolhimento e comunhão com toda a comunidade presente', description: 'Descrição longa para validar o conteúdo do item.', durationSeconds: 600, icon: '📢', order: 0 }], created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-08-27T00:00:00.000Z',
}];

interface MockApiOptions {
  songListMode?: 'success' | 'empty' | 'error';
  songListDelayMs?: number;
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

export async function installMockApi(page: Page, options: MockApiOptions = {}) {
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
    if (path.endsWith('/counts')) return json(route, { data: { songs: 2, folders: 2, artists: 2 } });
    if (path.endsWith('/classifications')) return json(route, { data: [
      { id: 'class-1', ministry_id: 'ministry-1', name: 'Celebração', color: '#2f855a' },
      { id: 'class-long', ministry_id: 'ministry-1', name: 'Classificação Extraordinariamente Longa Para Momentos Especiais', description: 'Descrição extensa para validar quebra de texto.', color: '#2f855a' },
    ] });
    if (path.endsWith('/artists')) return json(route, { data: [
      { id: 'artist-1', ministry_id: 'ministry-1', name: 'Equipe Local' },
      { id: 'artist-long', ministry_id: 'ministry-1', name: 'Comunidade Internacional de Adoração e Música Contemporânea do Bairro Central' },
    ] });
    if (path.endsWith('/folders/folder-1')) return json(route, { data: { id: 'folder-1', ministry_id: 'ministry-1', name: 'Domingo', description: 'Culto principal', song_count: 1, songs: [mockSong] } });
    if (path.endsWith('/folders')) return json(route, { data: [
      { id: 'folder-1', ministry_id: 'ministry-1', name: 'Domingo', description: 'Culto principal', song_count: 1, songs: [mockSong] },
      { id: 'folder-long', ministry_id: 'ministry-1', name: 'Pasta Com Nome Extraordinariamente Longo Para Celebrações Comunitárias', description: 'Descrição extensa com https://example.test/abcdefghijklmnopqrstuvwxyz0123456789', song_count: 1, songs: [longSong] },
    ] });
    if (path.endsWith('/songs/song-1')) return json(route, { data: mockSong });
    if (path.includes('/songs')) {
      if (options.songListDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.songListDelayMs));
      }
      if (options.songListMode === 'error') {
        return json(route, { error: { message: 'Falha simulada ao carregar repertório responsivo.' } }, 500);
      }
      if (options.songListMode === 'empty') return json(route, { data: [], total: 0 });
      return json(route, { data: [mockSong, longSong], total: 2 });
    }
    if (path.endsWith('/schedule-templates')) return json(route, scheduleTemplates);
    if (path.endsWith('/roles')) return json(route, [
      { id: 'role-1', name: 'Guitarra', icon: '🎸' },
      { id: 'role-long', name: 'Direção Musical e Coordenação de Arranjos Extraordinariamente Longa', icon: '🎼' },
    ]);
    if (path.endsWith('/teams')) return json(route, teams);
    if (path.endsWith('/members')) return json(route, members);
    if (path.endsWith('/comments')) return json(route, []);
    if (path.endsWith('/confirmation')) return json(route, mockSchedule);
    if (/\/schedules\/schedule-1$/.test(path) && method !== 'DELETE') return json(route, mockSchedule);
    if (path.endsWith('/schedules')) return json(route, method === 'GET' ? [mockSchedule] : mockSchedule);
    if (path.endsWith('/liturgies')) return json(route, []);
    if (path.includes('/smart-chords')) return json(route, { data: [] });
    if (path === '/plans') return json(route, {
      plans: [
        { id: 'free', name: 'Free', baseMembers: 10, baseSongs: 50, allowMemberAddons: false, maxMemberAddonBlocks: 0 },
        { id: 'lite', name: 'Lite', baseMembers: 20, baseSongs: 100, allowMemberAddons: false, maxMemberAddonBlocks: 0 },
        { id: 'lite_plus', name: 'Lite+', baseMembers: 30, baseSongs: 150, allowMemberAddons: false, maxMemberAddonBlocks: 0 },
        { id: 'essential', name: 'Essential', baseMembers: 40, baseSongs: 200, allowMemberAddons: true, maxMemberAddonBlocks: 4 },
        { id: 'pro', name: 'Pro', baseMembers: 100, baseSongs: 500, allowMemberAddons: true, maxMemberAddonBlocks: 10 },
        { id: 'premium', name: 'Premium', baseMembers: 'unlimited', baseSongs: 'unlimited', allowMemberAddons: false, maxMemberAddonBlocks: 0 },
      ],
      addonBlockSize: 10,
      defaultGracePeriodDays: 7,
    });
    if (path.endsWith('/subscription')) return json(route, {
      plan: { id: 'essential', name: 'Essential', baseMembers: 40, baseSongs: 200, allowMemberAddons: true, maxMemberAddonBlocks: 4 },
      subscription: {
        planId: 'essential',
        memberAddonBlocks: 1,
        billingStatus: 'active',
        administrativelySuspended: false,
        suspendedAt: null,
        suspensionReason: null,
        accessMode: 'normal',
        gracePeriodExpiresAt: null,
        currentPeriodStart: '2026-08-28T12:00:00.000Z',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
      quotas: { members: 50, songs: 200 },
      usage: { membersCount: 15, songsCount: 35 },
      isOverLimit: false,
      overLimitDetails: { membersOver: false, songsOver: false },
      graceDaysRemaining: null,
    });
    if (path.endsWith('/invites') && method === 'POST') return json(route, {
      id: 'invite-1', ministry_id: 'ministry-1', code: 'PR-RESPONSIVO-2026', created_by: 'user-1', max_uses: 10, uses_count: 0, expires_at: '2026-09-04T00:00:00.000Z', created_at: '2026-08-28T00:00:00.000Z',
    });
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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, ApiError, getFriendlyErrorMessage, mapAnnouncementFromApi } from './api';

describe('API Client & Structured Error Handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deve mapear erros estruturados para mensagens amigáveis', () => {
    const memberQuotaErr = new ApiError('Quota excedida', 403, { code: 'PLAN_MEMBER_QUOTA_REACHED' });
    expect(getFriendlyErrorMessage(memberQuotaErr)).toMatch(/Você atingiu o limite de membros do seu plano/i);

    const songQuotaErr = new ApiError('Quota excedida', 403, { code: 'PLAN_SONG_QUOTA_REACHED' });
    expect(getFriendlyErrorMessage(songQuotaErr)).toMatch(/Você atingiu o limite de músicas do seu plano/i);

    const restrictedErr = new ApiError('Restricted', 403, { code: 'SUBSCRIPTION_RESTRICTED' });
    expect(getFriendlyErrorMessage(restrictedErr)).toMatch(/Seu ministério está acima dos limites do plano atual/i);

    const suspendedErr = new ApiError('Suspended', 403, { code: 'SUBSCRIPTION_SUSPENDED' });
    expect(getFriendlyErrorMessage(suspendedErr)).toMatch(/Este ministério está suspenso/i);

    const deniedErr = new ApiError('Denied', 403, { code: 'MINISTRY_ACCESS_DENIED' });
    expect(getFriendlyErrorMessage(deniedErr)).toMatch(/Acesso negado\. Você não é integrante/i);

    const genericErr = new Error('Erro genérico');
    expect(getFriendlyErrorMessage(genericErr)).toBe('Erro genérico');
  });

  it('deve consultar getPlans com sucesso', async () => {
    const mockPlans = {
      plans: [{ id: 'free', name: 'Free', baseMembers: 10, baseSongs: 50, allowMemberAddons: false, maxMemberAddonBlocks: 0 }],
      addonBlockSize: 10,
      defaultGracePeriodDays: 7,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify(mockPlans)),
    } as any);

    const result = await api.getPlans();
    expect(result.plans).toHaveLength(1);
    expect(result.addonBlockSize).toBe(10);
  });

  it('deve consultar getMinistrySubscription com sucesso', async () => {
    const mockSub = {
      plan: { id: 'essential', name: 'Essential' },
      subscription: { planId: 'essential', accessMode: 'normal' },
      quotas: { members: 40, songs: 200 },
      usage: { membersCount: 12, songsCount: 30 },
      isOverLimit: false,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify(mockSub)),
    } as any);

    const result = await api.getMinistrySubscription('min-123');
    expect(result.plan.id).toBe('essential');
    expect(result.usage.membersCount).toBe(12);
  });

  it('REGRESSÃO HTTP: createBillingCheckout deve usar POST e enviar payload correto', async () => {
    const mockResult = {
      checkoutUrl: 'https://sandbox.asaas.com/checkoutSession/show/chk_real_123',
      checkoutId: 'chk_real_123',
      expiresAt: '2026-08-31T15:00:00.000Z',
      totalPriceCents: 1490,
      currency: 'BRL',
    };

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify(mockResult)),
    } as any);
    global.fetch = fetchSpy;

    const checkoutParams = {
      planId: 'lite',
      interval: 'monthly' as const,
      addonBlocks: 0,
      successUrl: 'http://localhost:5173/ministerio/plano?status=success',
      cancelUrl: 'http://localhost:5173/ministerio/plano',
    };

    const result = await api.createBillingCheckout('min-123', checkoutParams);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOptions] = fetchSpy.mock.calls[0];

    expect(calledUrl).toMatch(/\/ministries\/min-123\/billing\/checkout$/);
    expect(calledOptions.method).toBe('POST');
    expect(calledOptions.headers).toMatchObject({
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    });
    expect(JSON.parse(calledOptions.body)).toEqual(checkoutParams);
    expect(result).toEqual(mockResult);
  });

  it('REGRESSÃO HTTP: cancelBillingSubscription e reactivateBillingSubscription devem usar POST', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify({ message: 'OK', subscription: {} })),
    } as any);
    global.fetch = fetchSpy;

    await api.cancelBillingSubscription('min-123');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\/ministries\/min-123\/billing\/cancel$/),
      expect.objectContaining({ method: 'POST' })
    );

    await api.reactivateBillingSubscription('min-123');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\/ministries\/min-123\/billing\/reactivate$/),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('reactivateBillingSubscription retorna BillingReactivationResponse com success, message e outcome', async () => {
    const mockReactivation = {
      success: true,
      message: 'Cancelamento desfeito com sucesso.',
      outcome: 'cancellation_reversed' as const,
    };
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify(mockReactivation)),
    } as any);
    global.fetch = fetchSpy;

    const res = await api.reactivateBillingSubscription('min-123');
    expect(res).toEqual(mockReactivation);
  });

  describe('Smart Chords API Client', () => {
    it('getSmartChords consulta rota canônica /smart-chords e mapeia snake_case para camelCase', async () => {
      const mockRawChords = {
        data: [
          {
            id: 'sc-1',
            user_id: 'usr-1',
            title: 'Hosana',
            artist_id: 'art-1',
            song_id: 'sng-1',
            original_key: 'E',
            content: '[E]Hosana nas alturas',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-02T00:00:00Z',
            artist: { id: 'art-1', name: 'Gabriela Rocha' },
            song: { id: 'sng-1', title: 'Hosana' },
          },
        ],
      };

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockRawChords)),
      } as any);
      global.fetch = fetchSpy;

      const result = await api.getSmartChords('min-1', 'Hosana');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [calledUrl] = fetchSpy.mock.calls[0];
      expect(calledUrl).toMatch(/\/smart-chords\?search=Hosana$/);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'sc-1',
        userId: 'usr-1',
        title: 'Hosana',
        artistId: 'art-1',
        songId: 'sng-1',
        originalKey: 'E',
        content: '[E]Hosana nas alturas',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
        artist: { id: 'art-1', name: 'Gabriela Rocha' },
        song: { id: 'sng-1', title: 'Hosana' },
      });
    });

    it('getSmartChordById consulta /smart-chords/:id', async () => {
      const mockRaw = {
        id: 'sc-42',
        user_id: 'usr-42',
        title: 'Cifra Específica',
        original_key: 'A',
        content: '[A]Aleluia',
      };

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockRaw)),
      } as any);
      global.fetch = fetchSpy;

      const result = await api.getSmartChordById('sc-42');

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\/smart-chords\/sc-42$/),
        expect.any(Object)
      );
      expect(result.id).toBe('sc-42');
      expect(result.userId).toBe('usr-42');
      expect(result.originalKey).toBe('A');
    });

    it('getSmartChordsBySongId consulta /smart-chords/song/:songId e retorna array mapeado', async () => {
      const mockRaw = {
        data: [
          { id: 'sc-10', user_id: 'u-1', song_id: 'song-77', title: 'Versão 1', original_key: 'C', content: '[C]' },
          { id: 'sc-11', user_id: 'u-1', song_id: 'song-77', title: 'Versão 2', original_key: 'D', content: '[D]' },
        ],
      };

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockRaw)),
      } as any);
      global.fetch = fetchSpy;

      const result = await api.getSmartChordsBySongId('song-77');

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\/smart-chords\/song\/song-77$/),
        expect.any(Object)
      );
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('sc-10');
      expect(result[1].id).toBe('sc-11');
    });

    it('getSmartChordBySongId retorna a primeira cifra ou null se lista estiver vazia', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify({ data: [] })),
      } as any);
      global.fetch = fetchSpy;

      const emptyResult = await api.getSmartChordBySongId('song-vazia');
      expect(emptyResult).toBeNull();

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify({
          data: [{ id: 'sc-solo', user_id: 'u-1', title: 'Solo', original_key: 'G', content: '[G]' }]
        })),
      } as any);

      const singleResult = await api.getSmartChordBySongId('song-com-cifra');
      expect(singleResult).not.toBeNull();
      expect(singleResult?.id).toBe('sc-solo');
    });

    it('createSmartChord envia POST para rota canônica /smart-chords com campos mapeados', async () => {
      const mockCreated = {
        id: 'sc-created',
        user_id: 'usr-1',
        title: 'Nova',
        artist_id: 'art-99',
        song_id: 'sng-99',
        original_key: 'F',
        content: '[F]Nova melodia',
      };

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockCreated)),
      } as any);
      global.fetch = fetchSpy;

      const result = await api.createSmartChord({
        title: 'Nova',
        artistId: 'art-99',
        songId: 'sng-99',
        originalKey: 'F',
        content: '[F]Nova melodia',
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toMatch(/\/smart-chords$/);
      expect(options.method).toBe('POST');
      const body = JSON.parse(options.body);
      expect(body).toEqual({
        title: 'Nova',
        original_key: 'F',
        content: '[F]Nova melodia',
        artist_id: 'art-99',
        song_id: 'sng-99',
      });
      expect(result.id).toBe('sc-created');
    });

    it('updateSmartChord envia PUT para /smart-chords/:id', async () => {
      const mockUpdated = {
        id: 'sc-123',
        user_id: 'usr-1',
        title: 'Atualizada',
        original_key: 'Am',
        content: '[Am]Atualizada',
      };

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockUpdated)),
      } as any);
      global.fetch = fetchSpy;

      const result = await api.updateSmartChord('sc-123', {
        title: 'Atualizada',
        originalKey: 'Am',
      });

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toMatch(/\/smart-chords\/sc-123$/);
      expect(options.method).toBe('PUT');
      const body = JSON.parse(options.body);
      expect(body.title).toBe('Atualizada');
      expect(body.original_key).toBe('Am');
      expect(result.title).toBe('Atualizada');
    });

    it('deleteSmartChord envia DELETE para /smart-chords/:id', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        text: vi.fn().mockResolvedValue(''),
      } as any);
      global.fetch = fetchSpy;

      await api.deleteSmartChord('sc-to-delete');

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toMatch(/\/smart-chords\/sc-to-delete$/);
      expect(options.method).toBe('DELETE');
    });
  });

  describe('Announcements API Client', () => {
    it('mapAnnouncementFromApi mapeia propriedades snake_case para camelCase com fallbacks seguros', () => {
      const raw = {
        id: 'ann-1',
        ministry_id: 'min-1',
        title: 'Ensaio Geral',
        content: 'Detalhes do ensaio',
        author: 'Liderança de Louvor',
        important: true,
        created_by: 'usr-admin',
        created_at: '2026-09-09T14:00:00.000Z',
        updated_at: '2026-09-09T14:30:00.000Z',
      };

      const mapped = mapAnnouncementFromApi(raw);
      expect(mapped.id).toBe('ann-1');
      expect(mapped.ministryId).toBe('min-1');
      expect(mapped.title).toBe('Ensaio Geral');
      expect(mapped.content).toBe('Detalhes do ensaio');
      expect(mapped.author).toBe('Liderança de Louvor');
      expect(mapped.important).toBe(true);
      expect(mapped.createdBy).toBe('usr-admin');
      expect(mapped.createdAt).toBe('2026-09-09T14:00:00.000Z');
      expect(mapped.updatedAt).toBe('2026-09-09T14:30:00.000Z');
    });

    it('mapAnnouncementFromApi preenche fallbacks para campos ausentes', () => {
      const mapped = mapAnnouncementFromApi({});
      expect(mapped.id).toBe('');
      expect(mapped.ministryId).toBe('');
      expect(mapped.title).toBe('');
      expect(mapped.content).toBe('');
      expect(mapped.author).toBe('Liderança');
      expect(mapped.important).toBe(false);
    });

    it('getAnnouncements envia GET para /ministries/:ministryId/announcements', async () => {
      const mockList = [
        {
          id: 'ann-1',
          ministry_id: 'min-1',
          title: 'Aviso 1',
          content: 'Mensagem 1',
          author: 'Coordenação',
          important: false,
          created_by: 'usr-1',
          created_at: '2026-09-09T10:00:00.000Z',
          updated_at: '2026-09-09T10:00:00.000Z',
        },
      ];

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockList)),
      } as any);
      global.fetch = fetchSpy;

      const result = await api.getAnnouncements('min-1');
      expect(fetchSpy).toHaveBeenCalled();
      const [url] = fetchSpy.mock.calls[0];
      expect(url).toMatch(/\/ministries\/min-1\/announcements$/);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('ann-1');
      expect(result[0].title).toBe('Aviso 1');
      expect(result[0].ministryId).toBe('min-1');
    });

    it('createAnnouncement envia POST com payload serializado e mapeia retorno', async () => {
      const mockCreated = {
        id: 'ann-new',
        ministry_id: 'min-1',
        title: 'Novo Aviso',
        content: 'Conteúdo do aviso',
        author: 'Pastor',
        important: true,
        created_by: 'usr-1',
        created_at: '2026-09-09T11:00:00.000Z',
        updated_at: '2026-09-09T11:00:00.000Z',
      };

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockCreated)),
      } as any);
      global.fetch = fetchSpy;

      const result = await api.createAnnouncement('min-1', {
        title: 'Novo Aviso',
        content: 'Conteúdo do aviso',
        author: 'Pastor',
        important: true,
      });

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toMatch(/\/ministries\/min-1\/announcements$/);
      expect(options.method).toBe('POST');
      const parsedBody = JSON.parse(options.body);
      expect(parsedBody).toEqual({
        title: 'Novo Aviso',
        content: 'Conteúdo do aviso',
        author: 'Pastor',
        important: true,
      });
      expect(result.id).toBe('ann-new');
      expect(result.important).toBe(true);
    });

    it('updateAnnouncement envia PUT com payload e mapeia retorno', async () => {
      const mockUpdated = {
        id: 'ann-1',
        ministry_id: 'min-1',
        title: 'Título Editado',
        content: 'Conteúdo Editado',
        author: 'Liderança',
        important: false,
        created_by: 'usr-1',
        created_at: '2026-09-09T10:00:00.000Z',
        updated_at: '2026-09-09T12:00:00.000Z',
      };

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockUpdated)),
      } as any);
      global.fetch = fetchSpy;

      const result = await api.updateAnnouncement('min-1', 'ann-1', {
        title: 'Título Editado',
        content: 'Conteúdo Editado',
      });

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toMatch(/\/ministries\/min-1\/announcements\/ann-1$/);
      expect(options.method).toBe('PUT');
      expect(result.title).toBe('Título Editado');
    });

    it('deleteAnnouncement envia DELETE para /ministries/:ministryId/announcements/:id', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify({ message: 'Aviso excluído com sucesso.' })),
      } as any);
      global.fetch = fetchSpy;

      await api.deleteAnnouncement('min-1', 'ann-1');

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toMatch(/\/ministries\/min-1\/announcements\/ann-1$/);
      expect(options.method).toBe('DELETE');
    });
  });

  describe('Availability Conflict Detection API (Phase 6C)', () => {
    it('checkAvailabilityConflicts envia POST com payload correto e mapeia resposta', async () => {
      const mockApiResponse = {
        scheduleWindow: {
          startsAt: '2026-09-20T19:00:00',
          endsAt: '2026-09-20T21:00:00',
          durationMinutes: 120,
          durationSource: 'explicit',
        },
        conflicts: [
          {
            participantId: 'p-1',
            memberId: 'mem-1',
            hasConflict: true,
            unavailabilities: [
              {
                id: 'un-1',
                startsAt: '2026-09-20T18:00:00',
                endsAt: '2026-09-20T20:00:00',
                allDay: false,
              },
            ],
          },
        ],
        unresolvedParticipantIds: ['p-unresolved'],
      };

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockApiResponse)),
      } as any);
      global.fetch = fetchSpy;

      const result = await api.checkAvailabilityConflicts('min-123', {
        date: '2026-09-20',
        time: '19:00',
        durationMinutes: 120,
        participantIds: ['p-1', 'p-unresolved'],
      });

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toMatch(/\/ministries\/min-123\/availability\/check-conflicts$/);
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body)).toEqual({
        date: '2026-09-20',
        time: '19:00',
        durationMinutes: 120,
        participantIds: ['p-1', 'p-unresolved'],
      });

      expect(result.scheduleWindow.startsAt).toBe('2026-09-20T19:00:00');
      expect(result.scheduleWindow.endsAt).toBe('2026-09-20T21:00:00');
      expect(result.scheduleWindow.durationMinutes).toBe(120);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].hasConflict).toBe(true);
      expect(result.conflicts[0].unavailabilities).toHaveLength(1);
      expect(result.unresolvedParticipantIds).toEqual(['p-unresolved']);
    });
  });
});

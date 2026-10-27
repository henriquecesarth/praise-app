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
        artistName: null,
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

    it('preserves original/displayed keys, capo and source without inventing a default key', async () => {
      const fetchSpy = vi.fn().mockImplementation(async () => new Response(
        JSON.stringify({ id: 'created', original_key: 'Bb', displayed_key: 'G',
          capo: 3, source_url: 'https://www.cifraclub.com.br/a/b/' }), { status: 201 },
      ));
      global.fetch = fetchSpy;
      const result = await api.createSmartChord({ title: 'Test', originalKey: 'Bb',
        content: '[Bb]Uma palavra', displayedKey: 'G', capo: 3,
        sourceUrl: 'https://www.cifraclub.com.br/a/b/' });
      expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toMatchObject({
        original_key: 'Bb', displayed_key: 'G', capo: 3,
        source_url: 'https://www.cifraclub.com.br/a/b/',
      });
      expect(result).toMatchObject({ originalKey: 'Bb', displayedKey: 'G', capo: 3,
        sourceUrl: 'https://www.cifraclub.com.br/a/b/' });
      await api.createSmartChord({ title: 'Missing key', content: '[Bb]Uma palavra' });
      expect(JSON.parse(fetchSpy.mock.calls[1][1].body)).not.toHaveProperty('original_key');
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

    it('createSmartChord envia artist_name no body', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        text: vi.fn().mockResolvedValue(JSON.stringify({ id: 'sc-new', title: 'Nova', artist_name: 'Morada' })),
      } as any);
      global.fetch = fetchSpy;

      const result = await api.createSmartChord({
        title: 'Nova',
        artistName: 'Morada',
        originalKey: 'G',
        content: '[G]Aleluia',
      });

      const [, options] = fetchSpy.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.artist_name).toBe('Morada');
      expect(result.artistName).toBe('Morada');
    });

    it('getSmartChordRepertoireLink consulta rota de ministério e mapeia resposta', async () => {
      const mockLink = {
        link: {
          id: 'usr-1_sc-1_min-1',
          user_id: 'usr-1',
          smart_chord_id: 'sc-1',
          ministry_id: 'min-1',
          song_id: 'sng-1',
          created_at: '2026-10-16T12:00:00Z',
          updated_at: '2026-10-16T12:00:00Z',
        },
        song: {
          id: 'sng-1',
          ministry_id: 'min-1',
          title: 'Canção Canônica',
          artist_id: 'art-1',
          artist_name: 'Artista',
          original_key: 'D',
        },
      };

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockLink)),
      } as any);
      global.fetch = fetchSpy;

      const result = await api.getSmartChordRepertoireLink('min-1', 'sc-1');

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toMatch(/\/ministries\/min-1\/smart-chords\/sc-1\/repertoire-link$/);
      expect(result.link?.songId).toBe('sng-1');
      expect(result.song?.title).toBe('Canção Canônica');
    });

    it('setSmartChordRepertoireLink envia PUT com song_id', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify({ link: null, song: null })),
      } as any);
      global.fetch = fetchSpy;

      await api.setSmartChordRepertoireLink('min-1', 'sc-1', 'sng-target');

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toMatch(/\/ministries\/min-1\/smart-chords\/sc-1\/repertoire-link$/);
      expect(options.method).toBe('PUT');
      expect(JSON.parse(options.body)).toEqual({ song_id: 'sng-target' });
    });

    it('removeSmartChordRepertoireLink envia DELETE', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        text: vi.fn().mockResolvedValue(''),
      } as any);
      global.fetch = fetchSpy;

      await api.removeSmartChordRepertoireLink('min-1', 'sc-1');

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toMatch(/\/ministries\/min-1\/smart-chords\/sc-1\/repertoire-link$/);
      expect(options.method).toBe('DELETE');
    });

    it('getMySmartChordsForSong consulta /ministries/:ministryId/songs/:songId/my-smart-chords', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify({ data: [{ id: 'sc-1', title: 'Minha Cifra' }] })),
      } as any);
      global.fetch = fetchSpy;

      const result = await api.getMySmartChordsForSong('min-1', 'sng-1');

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toMatch(/\/ministries\/min-1\/songs\/sng-1\/my-smart-chords$/);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Minha Cifra');
    });

    describe('SmartChord Import Hub API Client', () => {
      beforeEach(() => {
        localStorage.clear();
      });

      it.each(['url', 'image'] as const)('maps assisted %s drafts and sends only canonical authentication', async (sourceType) => {
        localStorage.setItem('praise_auth_token', 'canonical-test-token');
        localStorage.setItem('token', 'unused-legacy-test-token');
        const sourceUrl = 'https://www.cifraclub.com.br/artist/song/';
        const fetchSpy = vi.fn().mockResolvedValue({
          ok: true, status: 200,
          text: vi.fn().mockResolvedValue(JSON.stringify({
            title: 'Song', artist_name: 'Artist', original_key: null, content: '',
            warnings: [{ code: sourceType === 'url' ? 'URL_MANUAL_PASTE_REQUIRED' : 'IMAGE_MANUAL_TRANSCRIPTION_REQUIRED', message: 'Cole o texto.' }],
            source_type: sourceType, requires_manual_paste: true,
            ...(sourceType === 'url' ? { source_url: sourceUrl } : {}),
          })),
        });
        global.fetch = fetchSpy;
        const image = new File(['fixture'], 'cifra.png', { type: 'image/png' });
        const draft = sourceType === 'url' ? await api.importSmartChordUrl(sourceUrl) : await api.importSmartChordImage(image);
        const [url, init] = fetchSpy.mock.calls[0];
        expect(url).toMatch(new RegExp(`/smart-chords/import/${sourceType}$`));
        expect(init.method).toBe('POST');
        expect(init.headers.Authorization).toBe('Bearer canonical-test-token');
        if (sourceType === 'url') {
          expect(init.headers['Content-Type']).toBe('application/json');
          expect(JSON.parse(init.body)).toEqual({ url: sourceUrl });
          expect(draft.sourceUrl).toBe(sourceUrl);
        } else {
          expect(init.headers['Content-Type']).toBeUndefined();
          expect(init.body.get('file')).toBe(image);
        }
        expect(draft).toMatchObject({ title: 'Song', artistName: 'Artist', sourceType, content: '', requiresManualPaste: true });
      });

      it('importSmartChordPdf envia FormData com autenticação canônica praise_auth_token e sem token legado', async () => {
        localStorage.setItem('praise_auth_token', 'canonical-user-token-xyz');
        localStorage.removeItem('token');

        const mockResponse = {
          title: 'Certeza (Canção de Jó)',
          artist_name: 'Héber Bragança',
          original_key: 'A',
          content: '||: [A] | [A7M] | [D] | % :||',
          warnings: [{ code: 'REPEAT_STRUCTURE_AMBIGUOUS', message: 'Progressão com repetição mantida' }],
          source_type: 'pdf',
        };

        const fetchSpy = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          text: vi.fn().mockResolvedValue(JSON.stringify(mockResponse)),
        } as any);
        global.fetch = fetchSpy;

        const fakePdf = new File(['fake-pdf-content'], 'Certeza.pdf', { type: 'application/pdf' });
        const draft = await api.importSmartChordPdf(fakePdf);

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [url, init] = fetchSpy.mock.calls[0];
        expect(url).toMatch(/\/smart-chords\/import\/pdf$/);
        expect(init.method).toBe('POST');

        // Headers checks
        expect(init.headers['Authorization']).toBe('Bearer canonical-user-token-xyz');
        expect(init.headers['Accept']).toBe('application/json');
        expect(init.headers['Content-Type']).toBeUndefined(); // Never force JSON on multipart FormData

        // Body checks
        expect(init.body).toBeInstanceOf(FormData);
        expect((init.body as FormData).get('file')).toBe(fakePdf);

        // Result mapped properly
        expect(draft).toEqual({
          title: 'Certeza (Canção de Jó)',
          artistName: 'Héber Bragança',
          originalKey: 'A',
          content: '||: [A] | [A7M] | [D] | % :||',
          warnings: [{ code: 'REPEAT_STRUCTURE_AMBIGUOUS', message: 'Progressão com repetição mantida' }],
          sourceType: 'pdf',
        });
      });

      it('importSmartChordPdf falha com ApiError 401 controlado quando não há autenticação', async () => {
        localStorage.removeItem('praise_auth_token');
        localStorage.removeItem('token');

        const fetchSpy = vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          text: vi.fn().mockResolvedValue(JSON.stringify({ error: { message: 'Token de autenticação não fornecido.' } })),
        } as any);
        global.fetch = fetchSpy;

        const fakePdf = new File(['fake-pdf-content'], 'test.pdf', { type: 'application/pdf' });
        await expect(api.importSmartChordPdf(fakePdf)).rejects.toThrow('Token de autenticação não fornecido.');

        const [, init] = fetchSpy.mock.calls[0];
        expect(init.headers['Authorization']).toBeUndefined();
      });

      it('importSmartChordPdf propaga 401 controlado quando o token expira', async () => {
        localStorage.setItem('praise_auth_token', 'expired-token');

        const fetchSpy = vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          text: vi.fn().mockResolvedValue(JSON.stringify({ error: { message: 'Sessão inválida ou expirada. Faça login novamente.' } })),
        } as any);
        global.fetch = fetchSpy;

        const fakePdf = new File(['fake-pdf-content'], 'test.pdf', { type: 'application/pdf' });
        await expect(api.importSmartChordPdf(fakePdf)).rejects.toThrow('Sessão inválida ou expirada. Faça login novamente.');
      });

      it('importSmartChordText envia JSON com autenticação canônica praise_auth_token e Content-Type application/json', async () => {
        localStorage.setItem('praise_auth_token', 'canonical-user-token-xyz');

        const mockResponse = {
          title: 'Minha Cifra em Texto',
          artist_name: 'Autor',
          original_key: 'G',
          content: '[G]Graças Te dou',
          warnings: [],
          source_type: 'text',
        };

        const fetchSpy = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          text: vi.fn().mockResolvedValue(JSON.stringify(mockResponse)),
        } as any);
        global.fetch = fetchSpy;

        const draft = await api.importSmartChordText('G\nGraças Te dou');

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [url, init] = fetchSpy.mock.calls[0];
        expect(url).toMatch(/\/smart-chords\/import\/text$/);
        expect(init.method).toBe('POST');
        expect(init.headers['Authorization']).toBe('Bearer canonical-user-token-xyz');
        expect(init.headers['Content-Type']).toBe('application/json');
        expect(JSON.parse(init.body)).toEqual({ text: 'G\nGraças Te dou' });
        expect(draft.sourceType).toBe('text');
      });
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

  describe('Account Deletion & Reauthentication (PC2/PC3 Compliance)', () => {
    it('reauthenticateAndGetFreshToken chama Identity Toolkit e retorna fresh idToken sem vazar segredos em logs', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const mockSignInResponse = {
        idToken: 'initial-fresh-id-token',
        refreshToken: 'refresh-token-xyz',
        expiresIn: '3600',
      };

      const mockRefreshResponse = {
        id_token: 'fresh-id-token-with-recent-auth-time',
        refresh_token: 'new-refresh-token',
        expires_in: '3600',
      };

      const fetchSpy = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue(mockSignInResponse),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue(mockRefreshResponse),
        } as any);

      global.fetch = fetchSpy;

      const secretPassword = 'MySecretPassword#123';
      const userEmail = 'integrante@louvaio.test';

      const token = await api.reauthenticateAndGetFreshToken(userEmail, secretPassword);

      expect(token).toBe('fresh-id-token-with-recent-auth-time');
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      const [signInUrl, signInOpts] = fetchSpy.mock.calls[0];
      expect(signInUrl).toContain('identitytoolkit.googleapis.com/v1/accounts:signInWithPassword');
      expect(signInOpts.method).toBe('POST');
      expect(JSON.parse(signInOpts.body)).toEqual({
        email: userEmail,
        password: secretPassword,
        returnSecureToken: true,
      });

      const [refreshUrl, refreshOpts] = fetchSpy.mock.calls[1];
      expect(refreshUrl).toContain('securetoken.googleapis.com/v1/token');
      expect(refreshOpts.method).toBe('POST');
      expect(refreshOpts.body).toContain('grant_type=refresh_token');
      expect(refreshOpts.body).toContain(encodeURIComponent('refresh-token-xyz'));

      const allLoggedText = [
        ...consoleLogSpy.mock.calls.flat(),
        ...consoleErrorSpy.mock.calls.flat(),
        ...consoleWarnSpy.mock.calls.flat(),
      ].join(' ');
      expect(allLoggedText).not.toContain(secretPassword);
      expect(allLoggedText).not.toContain('fresh-id-token-with-recent-auth-time');
      expect(allLoggedText).not.toContain('refresh-token-xyz');

      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    it('executeAccountDeletion envia Authorization Bearer com token recente sem vazar segredos', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const mockResult = {
        success: true,
        message: 'Conta excluída com sucesso.',
        job: {
          id: 'del_100',
          user_id: 'usr-100',
          user_email: 'integrante@louvaio.test',
          status: 'completed',
          requested_at: '2026-09-30T10:00:00.000Z',
          updated_at: '2026-09-30T10:00:01.000Z',
        },
      };

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockResult)),
      } as any);
      global.fetch = fetchSpy;

      const freshIdToken = 'jwt-token-with-recent-auth-time-300s';
      const result = await api.executeAccountDeletion(freshIdToken);

      expect(result).toEqual(mockResult);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toMatch(/\/auth\/account-deletion$/);
      expect(opts.method).toBe('POST');
      expect(opts.headers).toMatchObject({
        'Authorization': `Bearer ${freshIdToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      });

      const allLoggedText = [
        ...consoleLogSpy.mock.calls.flat(),
        ...consoleErrorSpy.mock.calls.flat(),
        ...consoleWarnSpy.mock.calls.flat(),
      ].join(' ');
      expect(allLoggedText).not.toContain(freshIdToken);

      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });
  });

  describe('Song Versions API Client Mapping', () => {
    it('deve serializar e mapear versões de músicas na criação e recuperação', async () => {
      const mockApiSong = {
        id: 'song-versions-1',
        ministry_id: 'min-1',
        title: 'Hosana',
        artist: 'Hillsong Worship',
        notes: 'Observações gerais da música',
        versions: [
          {
            id: 'v1',
            name: 'Original',
            classification_ids: ['class-1'],
            notes: 'Versão principal de domingo',
            key: 'E',
            bpm: 76,
            duration: '05:30',
            links: [
              { label: 'Letra', url: 'https://letras.test/hosana' },
              { label: 'Cifra', url: 'https://cifras.test/hosana' },
              { label: 'Áudio', url: 'https://audio.test/hosana.mp3' },
              { label: 'Vídeo', url: 'https://youtube.com/watch?v=123' },
              { label: 'Partitura', url: 'https://drive.test/score.pdf', isCustom: true },
            ],
          },
          {
            id: 'v2',
            name: 'Acústico',
            classification_ids: ['class-2'],
            notes: 'Versão voz e violão',
            key: 'D',
            bpm: 72,
            duration: '04:45',
            links: [
              { label: 'Áudio', url: 'https://audio.test/acustico.mp3' },
            ],
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify({ data: mockApiSong })),
      } as any);

      const song = await api.getSongById('song-versions-1', 'min-1');

      expect(song.id).toBe('song-versions-1');
      expect(song.title).toBe('Hosana');
      expect(song.versions).toHaveLength(2);
      expect(song.versions[0].name).toBe('Original');
      expect(song.versions[0].key).toBe('E');
      expect(song.versions[0].classificationIds).toEqual(['class-1']);
      expect(song.versions[0].links).toHaveLength(5);
      expect(song.versions[1].name).toBe('Acústico');
      expect(song.versions[1].key).toBe('D');
    });

    it('deve sintetizar versão padrão para músicas legadas sem array de versões', async () => {
      const legacyApiSong = {
        id: 'legacy-1',
        ministry_id: 'min-1',
        title: 'Música Antiga',
        artist: 'Cantor Legado',
        classification_id: 'class-legada',
        original_key: 'A',
        bpm: 100,
        duration: '03:30',
        chord_sheet_url: 'https://cifras.test/legada',
        youtube_url: 'https://youtube.com/watch?v=legada',
        lyrics: 'Letra legada',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify({ data: legacyApiSong })),
      } as any);

      const song = await api.getSongById('legacy-1', 'min-1');

      expect(song.versions).toHaveLength(1);
      expect(song.versions[0].name).toBe('Original');
      expect(song.versions[0].key).toBe('A');
      expect(song.versions[0].classificationIds).toEqual(['class-legada']);
      expect(song.versions[0].bpm).toBe(100);
      expect(song.versions[0].links.some((l) => l.label === 'Cifra')).toBe(true);
      expect(song.versions[0].links.some((l) => l.label === 'Vídeo')).toBe(true);
    });

    it('deve sempre normalizar song.artist e song.artistName para string mesmo se backend retornar objeto artist (F-R1-01)', async () => {
      const apiSongWithObjectArtist = {
        id: 'song-obj-artist',
        ministry_id: 'min-1',
        title: 'Lugar Secreto',
        artist: { id: 'art-99', name: 'Gabriela Rocha' }, // Objeto do backend
        artist_name: 'Gabriela Rocha',
        versions: [{ id: 'v1', name: 'Original', key: 'C', links: [] }],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify({ data: apiSongWithObjectArtist })),
      } as any);

      const song = await api.getSongById('song-obj-artist', 'min-1');

      // Garante que é string primitiva, NUNCA objeto
      expect(typeof song.artist).toBe('string');
      expect(song.artist).toBe('Gabriela Rocha');
      expect(typeof song.artistName).toBe('string');
      expect(song.artistName).toBe('Gabriela Rocha');
    });

    it('deve serializar clearing explícito de campos opcionais em mapSongToApi (F-R1-04)', async () => {
      let capturedBody: any = null;
      global.fetch = vi.fn().mockImplementation(async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ data: { id: 'song-1', ...capturedBody } }),
        };
      });

      await api.updateSong('song-1', {
        title: 'Música Atualizada',
        artist: 'Cantor',
        versions: [
          {
            id: 'v1',
            name: 'Original',
            key: 'C',
            bpm: '',
            notes: '',
            duration: '',
            classificationIds: [],
            links: [],
          },
        ],
      }, 'min-1');

      expect(capturedBody.versions[0].bpm).toBeNull();
      expect(capturedBody.versions[0].notes).toBeNull();
      expect(capturedBody.versions[0].duration).toBeNull();
      expect(capturedBody.versions[0].classificationIds).toEqual([]);
    });

    it('R3-03: deve preservar key: null e originalKey: null sem converter para "C" no round-trip Web', async () => {
      const apiSongWithClearedKey = {
        id: 'song-cleared-key',
        ministry_id: 'min-1',
        title: 'Música Sem Tom',
        original_key: null,
        versions: [{ id: 'v1', name: 'Original', key: null, links: [] }],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify({ data: apiSongWithClearedKey })),
      } as any);

      const song = await api.getSongById('song-cleared-key', 'min-1');

      // Falha esperada antes do fix: key é 'C' e originalKey é 'C' em vez de null
      expect(song.versions[0].key).toBeNull();
      expect(song.originalKey).toBeNull();
    });
  });

  describe('User Preferences API', () => {
    it('deve mapear preferences.chord_font_family para chordFontFamily em getMe', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify({
          id: 'user-123',
          email: 'user@example.com',
          name: 'Usuário Teste',
          preferences: {
            chord_font_family: 'Arial',
          },
        })),
      } as any);

      const user = await api.getMe();
      expect(user.id).toBe('user-123');
      expect(user.preferences?.chordFontFamily).toBe('Arial');
    });

    it('deve utilizar fallback monospace quando preferences.chord_font_family for nulo ou ausente em getMe', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify({
          id: 'user-456',
          email: 'user2@example.com',
          name: 'Usuário Sem Pref',
        })),
      } as any);

      const user = await api.getMe();
      expect(user.id).toBe('user-456');
      expect(user.preferences?.chordFontFamily).toBe('monospace');
    });

    it('deve enviar PATCH /auth/me/preferences e mapear resposta corretamente', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify({
          preferences: {
            chord_font_family: 'Georgia',
          },
        })),
      } as any);
      global.fetch = fetchSpy;

      const result = await api.updateUserPreferences({ chordFontFamily: 'Georgia' });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toMatch(/\/auth\/me\/preferences$/);
      expect(options.method).toBe('PATCH');
      expect(JSON.parse(options.body)).toEqual({ chord_font_family: 'Georgia' });
      expect(result.preferences.chordFontFamily).toBe('Georgia');
    });
  });
});

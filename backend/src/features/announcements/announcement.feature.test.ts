import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnnouncementRepository, AnnouncementRecord } from '../../repositories/AnnouncementRepository';
import { AnnouncementService } from './announcement.service';
import { AnnouncementController } from './announcement.controller';
import announcementRouter from './announcement.routes';
import { createAnnouncementSchema, updateAnnouncementSchema } from './announcement.types';
import { AppError } from '../../middleware/error-handler';

describe('Announcement Feature Test Suite', () => {
  let repo: AnnouncementRepository;
  let service: AnnouncementService;
  let controller: AnnouncementController;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new AnnouncementRepository();
    service = new AnnouncementService(repo);
    controller = new AnnouncementController(service);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Multi-tenant List Isolation (Ministry A vs Ministry B)', () => {
    it('retorna apenas avisos do ministério solicitado', async () => {
      const mockAnnouncementsMinA: AnnouncementRecord[] = [
        {
          id: 'ann-1',
          ministry_id: 'min-a',
          title: 'Ensaio Geral',
          content: 'Ensaio Quinta às 19h30',
          author: 'Liderança',
          important: true,
          created_by: 'user-admin',
          created_at: '2026-09-09T12:00:00.000Z',
          updated_at: '2026-09-09T12:00:00.000Z',
        },
      ];

      vi.spyOn(repo, 'getAnnouncementsByMinistry').mockImplementation(async (ministryId: string) => {
        if (ministryId === 'min-a') return mockAnnouncementsMinA;
        return [];
      });

      const resultMinA = await service.getAnnouncements('min-a');
      expect(resultMinA).toHaveLength(1);
      expect(resultMinA[0].id).toBe('ann-1');
      expect(resultMinA[0].ministry_id).toBe('min-a');

      const resultMinB = await service.getAnnouncements('min-b');
      expect(resultMinB).toHaveLength(0);
    });
  });

  describe('2. Anti-IDOR & Cross-tenant fail-closed protection', () => {
    it('lança 404 se o aviso não existir', async () => {
      vi.spyOn((repo as any).announcementsCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({ exists: false }),
      });

      await expect(service.getAnnouncementById('ann-missing', 'min-a')).rejects.toThrow(
        expect.objectContaining({ statusCode: 404, message: 'Aviso não encontrado.' })
      );
    });

    it('lança 404 (sem revelar existência) se o aviso pertencer a outro ministério', async () => {
      vi.spyOn((repo as any).announcementsCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'ann-other-min',
          data: () => ({
            ministry_id: 'min-b',
            title: 'Aviso Confidencial',
            content: 'Texto B',
            author: 'Pastor',
            important: false,
            created_by: 'user-b',
            created_at: '2026-09-01T00:00:00.000Z',
            updated_at: '2026-09-01T00:00:00.000Z',
          }),
        }),
      });

      // Tentativa de acesso via min-a deve falhar fechado com 404
      await expect(service.getAnnouncementById('ann-other-min', 'min-a')).rejects.toThrow(
        expect.objectContaining({ statusCode: 404, message: 'Aviso não encontrado.' })
      );
    });

    it('impede atualização de aviso entre ministérios diferentes com 404', async () => {
      vi.spyOn((repo as any).announcementsCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'ann-other',
          data: () => ({
            ministry_id: 'min-other',
            title: 'Original',
            content: 'Original',
            author: 'Original',
            important: false,
            created_by: 'user-other',
            created_at: '2026-09-01T00:00:00.000Z',
            updated_at: '2026-09-01T00:00:00.000Z',
          }),
        }),
      });

      await expect(
        service.updateAnnouncement('ann-other', 'min-attacker', { title: 'Hacked' })
      ).rejects.toThrow(expect.objectContaining({ statusCode: 404 }));
    });

    it('impede exclusão de aviso entre ministérios diferentes com 404', async () => {
      vi.spyOn((repo as any).announcementsCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'ann-other',
          data: () => ({
            ministry_id: 'min-other',
            title: 'Original',
          }),
        }),
      });

      await expect(service.deleteAnnouncement('ann-other', 'min-attacker')).rejects.toThrow(
        expect.objectContaining({ statusCode: 404 })
      );
    });
  });

  describe('3. Server-side Derivation & Immutability', () => {
    it('deriva ministry_id da rota e created_by da sessão, aplicando fallback de autor', async () => {
      const setMock = vi.fn().mockResolvedValue(undefined);
      vi.spyOn((repo as any).announcementsCol, 'doc').mockReturnValue({
        id: 'new-ann-id',
        set: setMock,
      });

      const created = await service.createAnnouncement(
        'min-canonical',
        {
          title: 'Novo Aviso',
          content: 'Descrição completa',
          author: undefined,
          important: true,
        },
        'user-authenticated',
        'Pastor João'
      );

      expect(created.id).toBe('new-ann-id');
      expect(created.ministry_id).toBe('min-canonical');
      expect(created.created_by).toBe('user-authenticated');
      expect(created.author).toBe('Pastor João');
      expect(created.important).toBe(true);

      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'new-ann-id',
          ministry_id: 'min-canonical',
          created_by: 'user-authenticated',
          author: 'Pastor João',
          important: true,
        })
      );
    });

    it('usa Liderança como fallback de autor se nem author nem fallbackAuthorName forem informados', async () => {
      const setMock = vi.fn().mockResolvedValue(undefined);
      vi.spyOn((repo as any).announcementsCol, 'doc').mockReturnValue({
        id: 'new-ann-id',
        set: setMock,
      });

      const created = await service.createAnnouncement(
        'min-canonical',
        {
          title: 'Aviso sem autor',
          content: 'Conteúdo aqui',
        },
        'user-authenticated'
      );

      expect(created.author).toBe('Liderança');
    });

    it('preserva campos imutáveis (ministry_id, created_by, created_at) no update', async () => {
      const existing: AnnouncementRecord = {
        id: 'ann-100',
        ministry_id: 'min-original',
        title: 'Título Original',
        content: 'Conteúdo Original',
        author: 'Autor Original',
        important: false,
        created_by: 'creator-original',
        created_at: '2026-08-01T10:00:00.000Z',
        updated_at: '2026-08-01T10:00:00.000Z',
      };

      vi.spyOn(repo, 'getAnnouncementById').mockResolvedValue(existing);
      const updateMock = vi.fn().mockResolvedValue(undefined);
      vi.spyOn((repo as any).announcementsCol, 'doc').mockReturnValue({
        update: updateMock,
      });

      const updated = await repo.updateAnnouncement('ann-100', 'min-original', {
        title: 'Título Modificado',
        content: 'Conteúdo Modificado',
        author: 'Novo Autor',
        important: true,
        // Tentativa maliciosa de sobrescrever:
        ...({ ministry_id: 'min-malicious', created_by: 'attacker', created_at: '1970-01-01' } as any),
      });

      expect(updated.title).toBe('Título Modificado');
      expect(updated.author).toBe('Novo Autor');
      expect(updated.important).toBe(true);

      const updateArgs = updateMock.mock.calls[0][0];
      expect(updateArgs.ministry_id).toBeUndefined();
      expect(updateArgs.created_by).toBeUndefined();
      expect(updateArgs.created_at).toBeUndefined();
      expect(updateArgs.updated_at).toBeDefined();
    });
  });

  describe('4. Query bounds & limit clamp', () => {
    it('restringe o limite de busca entre 1 e 50 itens', async () => {
      const getMock = vi.fn().mockResolvedValue({ docs: [] });
      const limitMock = vi.fn().mockReturnValue({ get: getMock });
      const orderByMock = vi.fn().mockReturnValue({ limit: limitMock });
      const whereMock = vi.fn().mockReturnValue({ orderBy: orderByMock });

      vi.spyOn((repo as any).announcementsCol, 'where').mockImplementation(whereMock);

      await repo.getAnnouncementsByMinistry('min-a', 100);
      expect(limitMock).toHaveBeenCalledWith(50);

      await repo.getAnnouncementsByMinistry('min-a', -5);
      expect(limitMock).toHaveBeenCalledWith(1);

      await repo.getAnnouncementsByMinistry('min-a', 15);
      expect(limitMock).toHaveBeenCalledWith(15);
    });
  });

  describe('5. Zod Schema Validations', () => {
    it('valida payload de criação com sucesso', () => {
      const validPayload = {
        title: 'Culto Especial',
        content: 'Texto descritivo do culto',
        author: 'Coordenação',
        important: true,
      };

      const result = createAnnouncementSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe('Culto Especial');
        expect(result.data.important).toBe(true);
      }
    });

    it('rejeita título vazio ou ausente na criação', () => {
      const result = createAnnouncementSchema.safeParse({
        title: '   ',
        content: 'Conteúdo válido',
      });
      expect(result.success).toBe(false);
    });

    it('rejeita conteúdo vazio ou ausente na criação', () => {
      const result = createAnnouncementSchema.safeParse({
        title: 'Título válido',
        content: '   ',
      });
      expect(result.success).toBe(false);
    });

    it('rejeita payload de atualização vazio (sem nenhum campo alterado)', () => {
      const result = updateAnnouncementSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('aceita atualização parcial com apenas um campo', () => {
      const result = updateAnnouncementSchema.safeParse({ important: true });
      expect(result.success).toBe(true);
    });
  });

  describe('6. Controller Responses & HTTP Contracts', () => {
    let mockReq: any;
    let mockRes: any;
    let mockNext: any;

    beforeEach(() => {
      mockReq = {
        user: { id: 'usr-123', name: 'Administrador' },
        params: { ministryId: 'min-alpha' },
        query: {},
        body: {},
      };
      mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      };
      mockNext = vi.fn();
    });

    it('getAnnouncements responde status 200 com array de avisos', async () => {
      const sampleList: AnnouncementRecord[] = [
        {
          id: 'ann-1',
          ministry_id: 'min-alpha',
          title: 'Aviso 1',
          content: 'Conteúdo 1',
          author: 'Liderança',
          important: false,
          created_by: 'usr-123',
          created_at: '2026-09-09T10:00:00.000Z',
          updated_at: '2026-09-09T10:00:00.000Z',
        },
      ];

      vi.spyOn(service, 'getAnnouncements').mockResolvedValue(sampleList);

      await controller.getAnnouncements(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(sampleList);
    });

    it('createAnnouncement responde status 201 com o recurso criado', async () => {
      mockReq.body = {
        title: 'Novo Aviso',
        content: 'Conteúdo do aviso',
        important: true,
      };

      const createdRecord: AnnouncementRecord = {
        id: 'ann-created',
        ministry_id: 'min-alpha',
        title: 'Novo Aviso',
        content: 'Conteúdo do aviso',
        author: 'Administrador',
        important: true,
        created_by: 'usr-123',
        created_at: '2026-09-09T10:00:00.000Z',
        updated_at: '2026-09-09T10:00:00.000Z',
      };

      vi.spyOn(service, 'createAnnouncement').mockResolvedValue(createdRecord);

      await controller.createAnnouncement(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith(createdRecord);
    });

    it('updateAnnouncement responde status 200 com o recurso atualizado', async () => {
      mockReq.params.announcementId = 'ann-to-update';
      mockReq.body = { title: 'Título Atualizado' };

      const updatedRecord: AnnouncementRecord = {
        id: 'ann-to-update',
        ministry_id: 'min-alpha',
        title: 'Título Atualizado',
        content: 'Conteúdo mantido',
        author: 'Administrador',
        important: false,
        created_by: 'usr-123',
        created_at: '2026-09-09T10:00:00.000Z',
        updated_at: '2026-09-09T11:00:00.000Z',
      };

      vi.spyOn(service, 'updateAnnouncement').mockResolvedValue(updatedRecord);

      await controller.updateAnnouncement(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(updatedRecord);
    });

    it('deleteAnnouncement responde status 200 com mensagem de confirmação', async () => {
      mockReq.params.announcementId = 'ann-to-delete';
      vi.spyOn(service, 'deleteAnnouncement').mockResolvedValue(undefined);

      await controller.deleteAnnouncement(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({ message: 'Aviso excluído com sucesso.' });
    });

    it('createAnnouncement rejeita com 401 se req.user não estiver autenticado', async () => {
      mockReq.user = undefined;

      await controller.createAnnouncement(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 401, message: 'Usuário não autenticado.' })
      );
    });
  });

  describe('7. Route Definition & RBAC Guards', () => {
    it('garante que o router registra rotas com os métodos HTTP canônicos', () => {
      const routes = announcementRouter.stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => ({
          path: layer.route.path,
          method: Object.keys(layer.route.methods)[0].toUpperCase(),
        }));

      expect(routes).toContainEqual({ path: '/', method: 'GET' });
      expect(routes).toContainEqual({ path: '/:announcementId', method: 'GET' });
      expect(routes).toContainEqual({ path: '/', method: 'POST' });
      expect(routes).toContainEqual({ path: '/:announcementId', method: 'PUT' });
      expect(routes).toContainEqual({ path: '/:announcementId', method: 'DELETE' });
    });
  });
});

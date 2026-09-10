import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AvailabilityRepository,
  MemberUnavailabilityRecord,
} from '../../repositories/AvailabilityRepository';
import { AvailabilityService } from './availability.service';
import { AvailabilityController } from './availability.controller';
import {
  createUnavailabilitySchema,
  updateUnavailabilitySchema,
} from './availability.types';
import { AppError } from '../../middleware/error-handler';
import { db } from '../../lib/firebase';

describe('Manual Member Availability Feature Test Suite (Phase 6D-2)', () => {
  let repo: AvailabilityRepository;
  let service: AvailabilityService;
  let controller: AvailabilityController;

  const mockMinistryId = 'min-alpha';
  const mockAdminUserId = 'user-admin-999';
  const mockManualMemberId = 'member-manual-111';
  const mockAuthMemberId = 'member-auth-222';
  const mockAuthUserId = 'user-auth-222';

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new AvailabilityRepository();
    service = new AvailabilityService(repo);
    controller = new AvailabilityController(service);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Manual Member Eligibility Resolution (resolveEligibleManualMembership)', () => {
    it('resolve com sucesso quando o membro existe, pertence ao ministério, is_manual === true e user_id é nulo', async () => {
      vi.spyOn((service as any).membersCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: mockManualMemberId,
          data: () => ({
            ministry_id: mockMinistryId,
            is_manual: true,
            user_id: null,
            name: 'Membro Manual Teste',
          }),
        }),
      } as any);

      const membership = await service.resolveEligibleManualMembership(mockMinistryId, mockManualMemberId);
      expect(membership.id).toBe(mockManualMemberId);
      expect(membership.is_manual).toBe(true);
      expect(membership.user_id).toBeNull();
    });

    it('rejeita com 404 MEMBER_NOT_FOUND quando o membro não existe no Firestore', async () => {
      vi.spyOn((service as any).membersCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: false,
        }),
      } as any);

      await expect(
        service.resolveEligibleManualMembership(mockMinistryId, 'non-existent-id')
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 404,
          details: expect.objectContaining({ code: 'MEMBER_NOT_FOUND' }),
        })
      );
    });

    it('rejeita com 404 MEMBER_NOT_FOUND quando o membro pertence a outro ministério (anti-IDOR cross-tenant)', async () => {
      vi.spyOn((service as any).membersCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: mockManualMemberId,
          data: () => ({
            ministry_id: 'other-ministry-xyz',
            is_manual: true,
            user_id: null,
          }),
        }),
      } as any);

      await expect(
        service.resolveEligibleManualMembership(mockMinistryId, mockManualMemberId)
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 404,
          details: expect.objectContaining({ code: 'MEMBER_NOT_FOUND' }),
        })
      );
    });

    it('rejeita com 403 AUTHENTICATED_MEMBER_MUTATION_PROHIBITED quando is_manual !== true', async () => {
      vi.spyOn((service as any).membersCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: mockAuthMemberId,
          data: () => ({
            ministry_id: mockMinistryId,
            is_manual: false,
            user_id: mockAuthUserId,
          }),
        }),
      } as any);

      await expect(
        service.resolveEligibleManualMembership(mockMinistryId, mockAuthMemberId)
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 403,
          details: expect.objectContaining({ code: 'AUTHENTICATED_MEMBER_MUTATION_PROHIBITED' }),
        })
      );
    });

    it('rejeita com 403 AUTHENTICATED_MEMBER_MUTATION_PROHIBITED quando is_manual === true mas possui user_id vinculado', async () => {
      vi.spyOn((service as any).membersCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: mockAuthMemberId,
          data: () => ({
            ministry_id: mockMinistryId,
            is_manual: true,
            user_id: 'linked-user-123',
          }),
        }),
      } as any);

      await expect(
        service.resolveEligibleManualMembership(mockMinistryId, mockAuthMemberId)
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 403,
          details: expect.objectContaining({ code: 'AUTHENTICATED_MEMBER_MUTATION_PROHIBITED' }),
        })
      );
    });
  });

  describe('2. Delegated Creation (createManualMemberUnavailability)', () => {
    beforeEach(() => {
      vi.spyOn(service, 'resolveEligibleManualMembership').mockResolvedValue({
        exists: true,
        id: mockManualMemberId,
        data: () => ({
          ministry_id: mockMinistryId,
          is_manual: true,
          user_id: null,
        }),
      } as any);
    });

    it('cria indisponibilidade de membro manual com persistência correta dos campos de auditoria', async () => {
      const createSpy = vi.spyOn(repo, 'createManualUnavailability').mockImplementation(async (data) => ({
        ...data,
        id: 'rec-manual-1',
      }));

      const payload = {
        startDate: '2026-09-25',
        endDate: '2026-09-25',
        allDay: true,
        reason: 'Viagem de trabalho',
      };

      const result = await service.createManualMemberUnavailability(
        mockMinistryId,
        mockManualMemberId,
        mockAdminUserId,
        payload
      );

      expect(createSpy).toHaveBeenCalledTimes(1);
      const passedData = createSpy.mock.calls[0][0];

      // Verificação dos invariantes de Phase 6D-2
      expect(passedData.ministry_id).toBe(mockMinistryId);
      expect(passedData.member_id).toBe(mockManualMemberId);
      expect(passedData.user_id).toBeNull();
      expect(passedData.management_source).toBe('admin_manual');
      expect(passedData.created_by_user_id).toBe(mockAdminUserId);
      expect(passedData.updated_by_user_id).toBe(mockAdminUserId);
      expect(passedData.start_date).toBe('2026-09-25');
      expect(passedData.end_date).toBe('2026-09-25');
      expect(passedData.all_day).toBe(true);
      expect(passedData.starts_at).toBe('2026-09-25T00:00:00');
      expect(passedData.ends_at).toBe('2026-09-26T00:00:00');
      expect(passedData.reason).toBe('Viagem de trabalho');

      // Verificação do retorno DTO
      expect(result.id).toBe('rec-manual-1');
      expect(result.memberId).toBe(mockManualMemberId);
      expect(result.reason).toBe('Viagem de trabalho');
    });

    it('cria indisponibilidade com horários específicos (timed interval) para membro manual', async () => {
      const createSpy = vi.spyOn(repo, 'createManualUnavailability').mockImplementation(async (data) => ({
        id: 'rec-manual-2',
        ...data,
      }));

      const payload = {
        startDate: '2026-09-26',
        endDate: '2026-09-26',
        allDay: false,
        startTime: '14:00',
        endTime: '18:00',
        reason: 'Compromisso particular',
      };

      const result = await service.createManualMemberUnavailability(
        mockMinistryId,
        mockManualMemberId,
        mockAdminUserId,
        payload
      );

      expect(result.allDay).toBe(false);
      expect(result.startTime).toBe('14:00');
      expect(result.endTime).toBe('18:00');
      expect(result.startsAt).toBe('2026-09-26T14:00:00');
      expect(result.endsAt).toBe('2026-09-26T18:00:00');
    });

    it('ignora tentativas de forjar user_id ou management_source pelo payload do cliente', async () => {
      const createSpy = vi.spyOn(repo, 'createManualUnavailability').mockImplementation(async (data) => ({
        id: 'rec-manual-3',
        ...data,
      }));

      const payload = {
        startDate: '2026-09-27',
        endDate: '2026-09-27',
        allDay: true,
        // Tentativas maliciosas
        userId: 'forged-user-id',
        managementSource: 'self_service',
        createdByUserId: 'forged-admin',
      } as any;

      await service.createManualMemberUnavailability(
        mockMinistryId,
        mockManualMemberId,
        mockAdminUserId,
        payload
      );

      const passedData = createSpy.mock.calls[0][0];
      expect(passedData.user_id).toBeNull();
      expect(passedData.management_source).toBe('admin_manual');
      expect(passedData.created_by_user_id).toBe(mockAdminUserId);
      expect(passedData.updated_by_user_id).toBe(mockAdminUserId);
    });

    it('rejeita com 400 quando a data inicial é posterior à final', async () => {
      const payload = {
        startDate: '2026-09-28',
        endDate: '2026-09-27',
        allDay: true,
      };

      await expect(
        service.createManualMemberUnavailability(mockMinistryId, mockManualMemberId, mockAdminUserId, payload)
      ).rejects.toThrow(expect.objectContaining({ statusCode: 400 }));
    });
  });

  describe('3. Delegated Listing (listManualMemberUnavailabilities)', () => {
    beforeEach(() => {
      vi.spyOn(service, 'resolveEligibleManualMembership').mockResolvedValue({
        exists: true,
        id: mockManualMemberId,
        data: () => ({
          ministry_id: mockMinistryId,
          is_manual: true,
          user_id: null,
        }),
      } as any);
    });

    it('lista indisponibilidades do membro manual e preserva o campo reason', async () => {
      const mockRecord: MemberUnavailabilityRecord = {
        id: 'rec-manual-1',
        ministry_id: mockMinistryId,
        member_id: mockManualMemberId,
        user_id: null,
        management_source: 'admin_manual',
        created_by_user_id: mockAdminUserId,
        updated_by_user_id: mockAdminUserId,
        start_date: '2026-09-25',
        end_date: '2026-09-25',
        start_time: null,
        end_time: null,
        all_day: true,
        starts_at: '2026-09-25T00:00:00',
        ends_at: '2026-09-25T23:59:59',
        reason: 'Motivo visível para o admin neste contexto',
        created_at: '2026-09-10T12:00:00.000Z',
        updated_at: '2026-09-10T12:00:00.000Z',
      };

      vi.spyOn(repo, 'listByMember').mockResolvedValue({
        data: [mockRecord],
        nextCursor: null,
      });

      const result = await service.listManualMemberUnavailabilities(
        mockMinistryId,
        mockManualMemberId,
        20
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('rec-manual-1');
      expect(result.data[0].memberId).toBe(mockManualMemberId);
      expect(result.data[0].reason).toBe('Motivo visível para o admin neste contexto');
      expect(result.nextCursor).toBeNull();
    });

    it('rejeita com 403 se o membro solicitado for autenticado', async () => {
      vi.spyOn(service, 'resolveEligibleManualMembership').mockRejectedValue(
        new AppError(403, 'Membro autenticado', { code: 'AUTHENTICATED_MEMBER_MUTATION_PROHIBITED' })
      );

      await expect(
        service.listManualMemberUnavailabilities(mockMinistryId, mockAuthMemberId, 20)
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 403,
          details: expect.objectContaining({ code: 'AUTHENTICATED_MEMBER_MUTATION_PROHIBITED' }),
        })
      );
    });
  });

  describe('4. Delegated Update (updateManualMemberUnavailability)', () => {
    const existingManualRecord: MemberUnavailabilityRecord = {
      id: 'rec-manual-1',
      ministry_id: mockMinistryId,
      member_id: mockManualMemberId,
      user_id: null,
      management_source: 'admin_manual',
      created_by_user_id: mockAdminUserId,
      updated_by_user_id: mockAdminUserId,
      start_date: '2026-09-25',
      end_date: '2026-09-25',
      start_time: null,
      end_time: null,
      all_day: true,
      starts_at: '2026-09-25T00:00:00',
      ends_at: '2026-09-25T23:59:59',
      reason: 'Motivo original',
      created_at: '2026-09-10T12:00:00.000Z',
      updated_at: '2026-09-10T12:00:00.000Z',
    };

    beforeEach(() => {
      vi.spyOn(service, 'resolveEligibleManualMembership').mockResolvedValue({
        exists: true,
        id: mockManualMemberId,
        data: () => ({
          ministry_id: mockMinistryId,
          is_manual: true,
          user_id: null,
        }),
      } as any);
    });

    it('atualiza indisponibilidade manual preservando imutabilidade de ID, tenant, autoria original e user_id', async () => {
      vi.spyOn(repo, 'getManualById').mockResolvedValue(existingManualRecord);
      const updateSpy = vi.spyOn(repo, 'updateManualUnavailability').mockImplementation(
        async (id, ministryId, memberId, updates) => ({
          ...existingManualRecord,
          ...updates,
          updated_at: '2026-09-10T13:00:00.000Z',
        })
      );

      const payload = {
        startDate: '2026-09-26',
        endDate: '2026-09-26',
        allDay: false,
        startTime: '10:00',
        endTime: '12:00',
        reason: 'Novo motivo atualizado',
      };

      const result = await service.updateManualMemberUnavailability(
        'rec-manual-1',
        mockMinistryId,
        mockManualMemberId,
        mockAdminUserId,
        payload
      );

      expect(updateSpy).toHaveBeenCalledTimes(1);
      const passedUpdates = updateSpy.mock.calls[0][3];

      // Verificação de campos atualizados e auditoria
      expect(passedUpdates.start_date).toBe('2026-09-26');
      expect(passedUpdates.end_date).toBe('2026-09-26');
      expect(passedUpdates.all_day).toBe(false);
      expect(passedUpdates.start_time).toBe('10:00');
      expect(passedUpdates.end_time).toBe('12:00');
      expect(passedUpdates.starts_at).toBe('2026-09-26T10:00:00');
      expect(passedUpdates.ends_at).toBe('2026-09-26T12:00:00');
      expect(passedUpdates.reason).toBe('Novo motivo atualizado');

      // Verificação que imutáveis não foram passados nos updates
      expect((passedUpdates as any).id).toBeUndefined();
      expect((passedUpdates as any).ministry_id).toBeUndefined();
      expect((passedUpdates as any).member_id).toBeUndefined();
      expect((passedUpdates as any).user_id).toBeUndefined();
      expect((passedUpdates as any).management_source).toBeUndefined();
      expect((passedUpdates as any).created_at).toBeUndefined();
      expect((passedUpdates as any).created_by_user_id).toBeUndefined();

      expect(result.reason).toBe('Novo motivo atualizado');
      expect(result.startTime).toBe('10:00');
    });

    it('falha com 404 quando o registro não pertence a este membro ou ministério (anti-IDOR)', async () => {
      vi.spyOn(repo, 'getManualById').mockRejectedValue(
        new AppError(404, 'Indisponibilidade não encontrada.')
      );

      await expect(
        service.updateManualMemberUnavailability(
          'non-existent-rec',
          mockMinistryId,
          mockManualMemberId,
          mockAdminUserId,
          { allDay: true }
        )
      ).rejects.toThrow(expect.objectContaining({ statusCode: 404 }));
    });

    it('falha com 403 (anti-takeover) se o registro pertencer a membro autenticado', async () => {
      vi.spyOn(repo, 'getManualById').mockRejectedValue(
        new AppError(403, 'Acesso negado: este registro pertence a um integrante autenticado self-service.', {
          code: 'AUTHENTICATED_MEMBER_MUTATION_PROHIBITED',
        })
      );

      await expect(
        service.updateManualMemberUnavailability(
          'rec-auth-member',
          mockMinistryId,
          mockManualMemberId,
          mockAdminUserId,
          { allDay: true }
        )
      ).rejects.toThrow(expect.objectContaining({ statusCode: 403 }));
    });
  });

  describe('5. Delegated Delete (deleteManualMemberUnavailability)', () => {
    const existingManualRecord: MemberUnavailabilityRecord = {
      id: 'rec-manual-1',
      ministry_id: mockMinistryId,
      member_id: mockManualMemberId,
      user_id: null,
      management_source: 'admin_manual',
      created_by_user_id: mockAdminUserId,
      updated_by_user_id: mockAdminUserId,
      start_date: '2026-09-25',
      end_date: '2026-09-25',
      start_time: null,
      end_time: null,
      all_day: true,
      starts_at: '2026-09-25T00:00:00',
      ends_at: '2026-09-25T23:59:59',
      reason: 'Motivo',
      created_at: '2026-09-10T12:00:00.000Z',
      updated_at: '2026-09-10T12:00:00.000Z',
    };

    beforeEach(() => {
      vi.spyOn(service, 'resolveEligibleManualMembership').mockResolvedValue({
        exists: true,
        id: mockManualMemberId,
        data: () => ({
          ministry_id: mockMinistryId,
          is_manual: true,
          user_id: null,
        }),
      } as any);
    });

    it('exclui indisponibilidade manual existente com sucesso', async () => {
      vi.spyOn(repo, 'getManualById').mockResolvedValue(existingManualRecord);
      const deleteSpy = vi.spyOn(repo, 'deleteManualUnavailability').mockResolvedValue();

      await service.deleteManualMemberUnavailability(
        'rec-manual-1',
        mockMinistryId,
        mockManualMemberId,
        mockAdminUserId
      );

      expect(deleteSpy).toHaveBeenCalledWith('rec-manual-1', mockMinistryId, mockManualMemberId);
    });

    it('falha com 404 quando o registro a excluir não existe ou é de outro tenant', async () => {
      vi.spyOn(repo, 'deleteManualUnavailability').mockRejectedValue(
        new AppError(404, 'Indisponibilidade não encontrada.')
      );

      await expect(
        service.deleteManualMemberUnavailability(
          'non-existent-rec',
          mockMinistryId,
          mockManualMemberId,
          mockAdminUserId
        )
      ).rejects.toThrow(expect.objectContaining({ statusCode: 404 }));
    });
  });

  describe('6. AvailabilityRepository Anti-Takeover Guard (getManualById)', () => {
    it('rejeita com 403 se o registro encontrado possuir user_id preenchido (membro autenticado)', async () => {
      vi.spyOn((repo as any).unavailabilitiesCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'rec-auth',
          data: () => ({
            ministry_id: mockMinistryId,
            member_id: mockManualMemberId,
            user_id: 'some-user-id',
            management_source: 'self_service',
          }),
        }),
      } as any);

      await expect(
        repo.getManualById('rec-auth', mockMinistryId, mockManualMemberId)
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 403,
          details: expect.objectContaining({ code: 'AUTHENTICATED_MEMBER_MUTATION_PROHIBITED' }),
        })
      );
    });

    it('rejeita com 403 se o registro tiver management_source diferente de admin_manual', async () => {
      vi.spyOn((repo as any).unavailabilitiesCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'rec-wrong-source',
          data: () => ({
            ministry_id: mockMinistryId,
            member_id: mockManualMemberId,
            user_id: null,
            management_source: 'self_service',
          }),
        }),
      } as any);

      await expect(
        repo.getManualById('rec-wrong-source', mockMinistryId, mockManualMemberId)
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 403,
          details: expect.objectContaining({ code: 'AUTHENTICATED_MEMBER_MUTATION_PROHIBITED' }),
        })
      );
    });

    it('rejeita com 404 se o registro pertencer a outro ministério ou membro', async () => {
      vi.spyOn((repo as any).unavailabilitiesCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'rec-other-tenant',
          data: () => ({
            ministry_id: 'other-min',
            member_id: mockManualMemberId,
            user_id: null,
            management_source: 'admin_manual',
          }),
        }),
      } as any);

      await expect(
        repo.getManualById('rec-other-tenant', mockMinistryId, mockManualMemberId)
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 404,
        })
      );
    });

    it('retorna o registro quando atende a todas as condições de membro manual', async () => {
      vi.spyOn((repo as any).unavailabilitiesCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'rec-valid-manual',
          data: () => ({
            ministry_id: mockMinistryId,
            member_id: mockManualMemberId,
            user_id: null,
            management_source: 'admin_manual',
            start_date: '2026-09-25',
            end_date: '2026-09-25',
            start_time: null,
            end_time: null,
            all_day: true,
            starts_at: '2026-09-25T00:00:00',
            ends_at: '2026-09-25T23:59:59',
            reason: 'Válido',
            created_at: '2026-09-10T12:00:00.000Z',
            updated_at: '2026-09-10T12:00:00.000Z',
          }),
        }),
      } as any);

      const result = await repo.getManualById('rec-valid-manual', mockMinistryId, mockManualMemberId);
      expect(result).not.toBeNull();
      expect(result.id).toBe('rec-valid-manual');
      expect(result.management_source).toBe('admin_manual');
      expect(result.user_id).toBeNull();
    });
  });

  describe('7. Controller Handlers (Delegated Endpoints)', () => {
    it('listManualMemberUnavailabilities: responde com 200 e dados paginados', async () => {
      const mockDto = {
        id: 'rec-1',
        ministryId: mockMinistryId,
        memberId: mockManualMemberId,
        startDate: '2026-09-25',
        endDate: '2026-09-25',
        startTime: null,
        endTime: null,
        allDay: true,
        startsAt: '2026-09-25T00:00:00',
        endsAt: '2026-09-25T23:59:59',
        reason: 'Motivo',
        createdAt: '2026-09-10T12:00:00.000Z',
        updatedAt: '2026-09-10T12:00:00.000Z',
      };

      vi.spyOn(service, 'listManualMemberUnavailabilities').mockResolvedValue({
        data: [mockDto],
        nextCursor: null,
      });

      const req: any = {
        params: { ministryId: mockMinistryId, memberId: mockManualMemberId },
        query: { limit: '20' },
        user: { id: mockAdminUserId },
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await controller.listManualMemberUnavailabilities(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: [mockDto],
        nextCursor: null,
      });
    });

    it('createManualMemberUnavailability: responde com 201 e recurso criado', async () => {
      const mockDto = {
        id: 'rec-created-1',
        ministryId: mockMinistryId,
        memberId: mockManualMemberId,
        startDate: '2026-09-25',
        endDate: '2026-09-25',
        startTime: null,
        endTime: null,
        allDay: true,
        startsAt: '2026-09-25T00:00:00',
        endsAt: '2026-09-25T23:59:59',
        reason: 'Criado pelo admin',
        createdAt: '2026-09-10T12:00:00.000Z',
        updatedAt: '2026-09-10T12:00:00.000Z',
      };

      vi.spyOn(service, 'createManualMemberUnavailability').mockResolvedValue(mockDto);

      const req: any = {
        params: { ministryId: mockMinistryId, memberId: mockManualMemberId },
        body: {
          startDate: '2026-09-25',
          endDate: '2026-09-25',
          allDay: true,
          reason: 'Criado pelo admin',
        },
        user: { id: mockAdminUserId },
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await controller.createManualMemberUnavailability(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(mockDto);
    });

    it('updateManualMemberUnavailability: responde com 200 e recurso atualizado', async () => {
      const mockDto = {
        id: 'rec-created-1',
        ministryId: mockMinistryId,
        memberId: mockManualMemberId,
        startDate: '2026-09-26',
        endDate: '2026-09-26',
        startTime: null,
        endTime: null,
        allDay: true,
        startsAt: '2026-09-26T00:00:00',
        endsAt: '2026-09-26T23:59:59',
        reason: 'Atualizado pelo admin',
        createdAt: '2026-09-10T12:00:00.000Z',
        updatedAt: '2026-09-10T13:00:00.000Z',
      };

      vi.spyOn(service, 'updateManualMemberUnavailability').mockResolvedValue(mockDto);

      const req: any = {
        params: { ministryId: mockMinistryId, memberId: mockManualMemberId, id: 'rec-created-1' },
        body: {
          startDate: '2026-09-26',
          endDate: '2026-09-26',
          allDay: true,
          reason: 'Atualizado pelo admin',
        },
        user: { id: mockAdminUserId },
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await controller.updateManualMemberUnavailability(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(mockDto);
    });

    it('deleteManualMemberUnavailability: responde com 204 No Content', async () => {
      vi.spyOn(service, 'deleteManualMemberUnavailability').mockResolvedValue();

      const req: any = {
        params: { ministryId: mockMinistryId, memberId: mockManualMemberId, id: 'rec-created-1' },
        user: { id: mockAdminUserId },
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      };
      const next = vi.fn();

      await controller.deleteManualMemberUnavailability(req, res, next);

      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalled();
    });
  });

  describe('8. Interoperability with Schedule Conflict and Consolidated Views', () => {
    it('indisponibilidade de membro manual detecta conflito em escala sem expor reason', async () => {
      // Setup schedule conflict check targeting mockManualMemberId
      const manualRecord: MemberUnavailabilityRecord = {
        id: 'rec-manual-conflict',
        ministry_id: mockMinistryId,
        member_id: mockManualMemberId,
        user_id: null,
        management_source: 'admin_manual',
        created_by_user_id: mockAdminUserId,
        updated_by_user_id: mockAdminUserId,
        start_date: '2026-09-20',
        end_date: '2026-09-20',
        start_time: '18:00',
        end_time: '21:00',
        all_day: false,
        starts_at: '2026-09-20T18:00:00',
        ends_at: '2026-09-20T21:00:00',
        reason: 'Segredo de saúde do membro manual',
        created_at: '2026-09-10T12:00:00.000Z',
        updated_at: '2026-09-10T12:00:00.000Z',
      };

      vi.spyOn(service, 'resolveMinistryMemberIds').mockResolvedValue({
        canonicalMemberIds: [mockManualMemberId],
        resolutionMap: new Map([[mockManualMemberId, mockManualMemberId]]),
        unresolvedParticipantIds: [],
      });
      vi.spyOn(repo, 'findConflictCandidates').mockResolvedValue([manualRecord]);

      const result = await service.checkScheduleConflicts(mockMinistryId, {
        date: '2026-09-20',
        time: '19:00',
        durationMinutes: 60,
        participantIds: [mockManualMemberId],
      });

      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].memberId).toBe(mockManualMemberId);
      // Privacy invariant: Phase 6C contract strictly guarantees reason is never leaked in conflict checks
      expect((result.conflicts[0] as any).reason).toBeUndefined();
    });

    it('indisponibilidade de membro manual aparece na listagem consolidada do admin com nome e sem reason', async () => {
      const manualRecord: MemberUnavailabilityRecord = {
        id: 'rec-manual-consolidated',
        ministry_id: mockMinistryId,
        member_id: mockManualMemberId,
        user_id: null,
        management_source: 'admin_manual',
        created_by_user_id: mockAdminUserId,
        updated_by_user_id: mockAdminUserId,
        start_date: '2026-09-20',
        end_date: '2026-09-20',
        start_time: null,
        end_time: null,
        all_day: true,
        starts_at: '2026-09-20T00:00:00',
        ends_at: '2026-09-20T23:59:59',
        reason: 'Motivo confidencial',
        created_at: '2026-09-10T12:00:00.000Z',
        updated_at: '2026-09-10T12:00:00.000Z',
      };

      vi.spyOn(repo, 'listConsolidated').mockResolvedValue({
        data: [manualRecord],
        nextCursor: null,
        scannedCandidatesCount: 1,
      });

      vi.spyOn(db, 'getAll').mockResolvedValue([
        {
          id: mockManualMemberId,
          exists: true,
          data: () => ({ ministry_id: mockMinistryId, name: 'João Silva (Manual)', is_manual: true }),
        },
      ] as any);

      const result = await service.listConsolidatedAvailability(mockMinistryId, {
        from: '2026-09-01',
        to: '2026-09-30',
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].memberId).toBe(mockManualMemberId);
      expect(result.data[0].memberName).toBe('João Silva (Manual)');
      // Privacy invariant: Phase 6D-1 contract strictly guarantees reason is omitted in consolidated views
      expect((result.data[0] as any).reason).toBeUndefined();
    });
  });
});
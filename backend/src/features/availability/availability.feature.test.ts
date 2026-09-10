import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AvailabilityRepository,
  MemberUnavailabilityRecord,
  encodeAvailabilityCursor,
  decodeAvailabilityCursor,
} from '../../repositories/AvailabilityRepository';
import { AvailabilityService } from './availability.service';
import { AvailabilityController } from './availability.controller';
import {
  createUnavailabilitySchema,
  updateUnavailabilitySchema,
  listUnavailabilityQuerySchema,
  checkAvailabilityConflictsSchema,
} from './availability.types';
import { AppError } from '../../middleware/error-handler';

describe('Member Availability Feature Test Suite (Phase 6B)', () => {
  let repo: AvailabilityRepository;
  let service: AvailabilityService;
  let controller: AvailabilityController;

  const mockMinistryId = 'min-alpha';
  const mockUserId = 'user-test-123';
  const mockMemberId = 'member-alpha-456';

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new AvailabilityRepository();
    service = new AvailabilityService(repo);
    controller = new AvailabilityController(service);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Cursor Encoding, Decoding & Anti-Tampering', () => {
    it('codifica e decodifica cursor determinístico corretamente', () => {
      const cursor = encodeAvailabilityCursor({
        id: 'rec-1',
        s: '2026-09-20T18:00:00',
        m: mockMinistryId,
        mem: mockMemberId,
      });

      expect(typeof cursor).toBe('string');
      const decoded = decodeAvailabilityCursor(cursor, mockMinistryId, mockMemberId);
      expect(decoded.id).toBe('rec-1');
      expect(decoded.s).toBe('2026-09-20T18:00:00');
      expect(decoded.m).toBe(mockMinistryId);
      expect(decoded.mem).toBe(mockMemberId);
    });

    it('rejeita cursor com ministryId divergente (anti-IDOR cross-tenant)', () => {
      const cursor = encodeAvailabilityCursor({
        id: 'rec-1',
        s: '2026-09-20T18:00:00',
        m: 'other-min',
        mem: mockMemberId,
      });

      expect(() => decodeAvailabilityCursor(cursor, mockMinistryId, mockMemberId)).toThrow(
        expect.objectContaining({ statusCode: 403 })
      );
    });

    it('rejeita cursor com memberId divergente (anti-IDOR cross-member)', () => {
      const cursor = encodeAvailabilityCursor({
        id: 'rec-1',
        s: '2026-09-20T18:00:00',
        m: mockMinistryId,
        mem: 'other-member',
      });

      expect(() => decodeAvailabilityCursor(cursor, mockMinistryId, mockMemberId)).toThrow(
        expect.objectContaining({ statusCode: 403 })
      );
    });

    it('rejeita token malformado ou adulterado com 400', () => {
      expect(() => decodeAvailabilityCursor('invalid-token', mockMinistryId, mockMemberId)).toThrow(
        expect.objectContaining({ statusCode: 400 })
      );
    });
  });

  describe('2. Canonical Identity & Membership Derivation', () => {
    it('resolve membership do usuário no ministério e retorna o memberId canônico', async () => {
      vi.spyOn((service as any).membersCol, 'where').mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              empty: false,
              docs: [{ id: mockMemberId, data: () => ({ role: 'member' }) }],
            }),
          }),
        }),
      } as any);

      const membership = await service.resolveCanonicalMembership(mockMinistryId, mockUserId);
      expect(membership.memberId).toBe(mockMemberId);
      expect(membership.role).toBe('member');
    });

    it('falha fechado com 403 se o usuário não pertencer ao ministério', async () => {
      vi.spyOn((service as any).membersCol, 'where').mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              empty: true,
              docs: [],
            }),
          }),
        }),
      } as any);

      await expect(service.resolveCanonicalMembership(mockMinistryId, mockUserId)).rejects.toThrow(
        expect.objectContaining({
          statusCode: 403,
          details: expect.objectContaining({ code: 'MINISTRY_ACCESS_DENIED' }),
        })
      );
    });

    it('permite que administradores autenticados gerenciem sua própria disponibilidade', async () => {
      vi.spyOn((service as any).membersCol, 'where').mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              empty: false,
              docs: [{ id: 'admin-member-id', data: () => ({ role: 'admin' }) }],
            }),
          }),
        }),
      } as any);

      const membership = await service.resolveCanonicalMembership(mockMinistryId, 'admin-user-id');
      expect(membership.memberId).toBe('admin-member-id');
      expect(membership.role).toBe('admin');
    });

    it('mesmo usuário Firebase em dois ministérios tem registros e identidades isoladas', async () => {
      const minA = 'min-a';
      const minB = 'min-b';
      const user = 'user-dual';

      vi.spyOn((service as any).membersCol, 'where').mockImplementation((...args: any[]) => {
        const [field, , val] = args;
        if (field === 'ministry_id' && val === minA) {
          return {
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                  empty: false,
                  docs: [{ id: 'mem-a', data: () => ({ role: 'member' }) }],
                }),
              }),
            }),
          } as any;
        }
        if (field === 'ministry_id' && val === minB) {
          return {
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                  empty: false,
                  docs: [{ id: 'mem-b', data: () => ({ role: 'admin' }) }],
                }),
              }),
            }),
          } as any;
        }
        return { where: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ empty: true }) }) }) } as any;
      });

      const memberInA = await service.resolveCanonicalMembership(minA, user);
      const memberInB = await service.resolveCanonicalMembership(minB, user);

      expect(memberInA.memberId).toBe('mem-a');
      expect(memberInB.memberId).toBe('mem-b');
      expect(memberInA.memberId).not.toBe(memberInB.memberId);
    });
  });

  describe('3. Create Unavailability (Self-Service)', () => {
    beforeEach(() => {
      vi.spyOn(service, 'resolveCanonicalMembership').mockResolvedValue({
        memberId: mockMemberId,
        role: 'member',
      });
    });

    it('cria indisponibilidade de dia inteiro derivando identidades no servidor', async () => {
      const saveSpy = vi.spyOn(repo, 'createUnavailability').mockImplementation(async (r) => ({
        ...r,
        id: 'new-rec-id',
      }));

      const result = await service.createMyUnavailability(mockMinistryId, mockUserId, {
        startDate: '2026-09-20',
        endDate: '2026-09-20',
        allDay: true,
        reason: 'Viagem em família',
      });

      expect(saveSpy).toHaveBeenCalledTimes(1);
      const savedRecord = saveSpy.mock.calls[0][0];

      expect(savedRecord.ministry_id).toBe(mockMinistryId);
      expect(savedRecord.user_id).toBe(mockUserId);
      expect(savedRecord.member_id).toBe(mockMemberId);
      expect(savedRecord.all_day).toBe(true);
      expect(savedRecord.start_time).toBeNull();
      expect(savedRecord.end_time).toBeNull();
      expect(savedRecord.starts_at).toBe('2026-09-20T00:00:00');
      expect(savedRecord.ends_at).toBe('2026-09-21T00:00:00');
      expect(savedRecord.starts_at.endsWith('Z')).toBe(false);
      expect(savedRecord.ends_at.endsWith('Z')).toBe(false);

      expect(result.id).toBe('new-rec-id');
      expect(result.ministryId).toBe(mockMinistryId);
      expect(result.memberId).toBe(mockMemberId);
      expect(result.allDay).toBe(true);
      expect(result.startsAt).toBe('2026-09-20T00:00:00');
      expect(result.endsAt).toBe('2026-09-21T00:00:00');
      expect(result.reason).toBe('Viagem em família');
    });

    it('cria indisponibilidade timed e rejeita/ignora campos de identidade forjados no payload', async () => {
      const saveSpy = vi.spyOn(repo, 'createUnavailability').mockImplementation(async (r) => ({
        ...r,
        id: 'new-rec-timed',
      }));

      const forgedInput: any = {
        startDate: '2026-09-20',
        endDate: '2026-09-20',
        startTime: '18:00',
        endTime: '21:00',
        allDay: false,
        reason: null,
        // Tentativas de forjar tenant e autoria
        userId: 'attacker-id',
        memberId: 'attacker-member',
        ministryId: 'attacker-min',
      };

      const result = await service.createMyUnavailability(mockMinistryId, mockUserId, forgedInput);

      const saved = saveSpy.mock.calls[0][0];
      expect(saved.user_id).toBe(mockUserId);
      expect(saved.member_id).toBe(mockMemberId);
      expect(saved.ministry_id).toBe(mockMinistryId);
      expect(result.startsAt).toBe('2026-09-20T18:00:00');
      expect(result.endsAt).toBe('2026-09-20T21:00:00');
    });

    it('rejeita criação com período superior a 90 dias contínuos', async () => {
      await expect(
        service.createMyUnavailability(mockMinistryId, mockUserId, {
          startDate: '2026-01-01',
          endDate: '2026-04-05', // 95 dias
          allDay: true,
        })
      ).rejects.toThrow('O período de indisponibilidade não pode exceder 90 dias contínuos.');
    });
  });

  describe('4. List Unavailabilities (Bounded & Deterministic Pagination)', () => {
    beforeEach(() => {
      vi.spyOn(service, 'resolveCanonicalMembership').mockResolvedValue({
        memberId: mockMemberId,
        role: 'member',
      });
    });

    it('consulta de listagem utiliza escopo de ministério e membro com ordenação decrescente', async () => {
      const mockRecord: MemberUnavailabilityRecord = {
        id: 'rec-1',
        ministry_id: mockMinistryId,
        member_id: mockMemberId,
        user_id: mockUserId,
        start_date: '2026-09-20',
        end_date: '2026-09-20',
        start_time: '18:00',
        end_time: '21:00',
        all_day: false,
        starts_at: '2026-09-20T18:00:00',
        ends_at: '2026-09-20T21:00:00',
        reason: null,
        created_at: '2026-09-09T00:00:00.000Z',
        updated_at: '2026-09-09T00:00:00.000Z',
      };

      vi.spyOn(repo, 'listByMember').mockResolvedValue({
        data: [mockRecord],
        nextCursor: null,
      });

      const response = await service.listMyUnavailabilities(mockMinistryId, mockUserId, 20);
      expect(response.data).toHaveLength(1);
      expect(response.data[0].id).toBe('rec-1');
      expect(response.data[0].memberId).toBe(mockMemberId);
      expect(response.nextCursor).toBeNull();
    });

    it('repassa e decodifica cursor válido para carregar próxima página', async () => {
      const cursor = encodeAvailabilityCursor({
        id: 'rec-1',
        s: '2026-09-20T18:00:00',
        m: mockMinistryId,
        mem: mockMemberId,
      });

      const listSpy = vi.spyOn(repo, 'listByMember').mockResolvedValue({
        data: [],
        nextCursor: null,
      });

      await service.listMyUnavailabilities(mockMinistryId, mockUserId, 50, cursor);
      expect(listSpy).toHaveBeenCalledWith(mockMinistryId, mockMemberId, 50, cursor);
    });

    it('sanitiza limitCount NaN no repositório caindo no limite padrão com segurança', async () => {
      const limitFn = vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: [] }),
      });
      const orderByDocIdFn = vi.fn().mockReturnValue({ limit: limitFn });
      const orderByStartsAtFn = vi.fn().mockReturnValue({ orderBy: orderByDocIdFn });
      const whereMemberFn = vi.fn().mockReturnValue({ orderBy: orderByStartsAtFn });
      const whereMinFn = vi.fn().mockReturnValue({ where: whereMemberFn });

      vi.spyOn((repo as any).unavailabilitiesCol, 'where').mockImplementation(whereMinFn);

      const result = await repo.listByMember(mockMinistryId, mockMemberId, NaN);
      expect(result.data).toEqual([]);
      expect(limitFn).toHaveBeenCalledWith(51); // 50 default + 1
    });
  });

  describe('5. PATCH Unavailability (Ownership, Anti-IDOR & Invariant Re-validation)', () => {
    const existingRecord: MemberUnavailabilityRecord = {
      id: 'avail-existing',
      ministry_id: mockMinistryId,
      member_id: mockMemberId,
      user_id: mockUserId,
      start_date: '2026-09-20',
      end_date: '2026-09-20',
      start_time: '18:00',
      end_time: '21:00',
      all_day: false,
      starts_at: '2026-09-20T18:00:00',
      ends_at: '2026-09-20T21:00:00',
      reason: 'Motivo antigo',
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
    };

    beforeEach(() => {
      vi.spyOn(service, 'resolveCanonicalMembership').mockResolvedValue({
        memberId: mockMemberId,
        role: 'member',
      });
      vi.spyOn(repo, 'getById').mockResolvedValue(existingRecord);
    });

    it('atualiza apenas o motivo preservando horários existentes', async () => {
      const updateSpy = vi.spyOn(repo, 'updateUnavailability').mockImplementation(async (_id, _minId, up) => ({
        ...existingRecord,
        ...up,
      } as MemberUnavailabilityRecord));

      const result = await service.updateMyUnavailability('avail-existing', mockMinistryId, mockUserId, {
        reason: 'Novo motivo atualizado',
      });

      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(result.reason).toBe('Novo motivo atualizado');
      expect(result.startsAt).toBe(existingRecord.starts_at);
      expect(result.endsAt).toBe(existingRecord.ends_at);
    });

    it('falha fechado com 404 se o registro pertencer a outro usuário no mesmo ministério', async () => {
      vi.spyOn(repo, 'getById').mockResolvedValue({
        ...existingRecord,
        user_id: 'other-user-999',
        member_id: 'other-member-888',
      });

      await expect(
        service.updateMyUnavailability('avail-existing', mockMinistryId, mockUserId, {
          reason: 'Ataque IDOR',
        })
      ).rejects.toThrow(expect.objectContaining({ statusCode: 404, message: 'Indisponibilidade não encontrada.' }));
    });

    it('falha fechado com 404 se o registro pertencer a outro ministério', async () => {
      vi.spyOn(repo, 'getById').mockRejectedValue(new AppError(404, 'Indisponibilidade não encontrada.'));

      await expect(
        service.updateMyUnavailability('avail-other-min', mockMinistryId, mockUserId, {
          reason: 'Ataque IDOR Cross-tenant',
        })
      ).rejects.toThrow(expect.objectContaining({ statusCode: 404 }));
    });

    it('executa validação COMPLETA no merge e rejeita patch que resulte em end_date anterior a start_date', async () => {
      await expect(
        service.updateMyUnavailability('avail-existing', mockMinistryId, mockUserId, {
          endDate: '2026-09-10', // Anterior ao startDate existente (2026-09-20)
        })
      ).rejects.toThrow('O término da indisponibilidade deve ser estritamente posterior ao início');
    });

    it('executa validação COMPLETA no merge e rejeita patch que resulte em período > 90 dias', async () => {
      await expect(
        service.updateMyUnavailability('avail-existing', mockMinistryId, mockUserId, {
          endDate: '2026-12-31', // > 90 dias
        })
      ).rejects.toThrow('O período de indisponibilidade não pode exceder 90 dias contínuos');
    });

    it('permite transição limpa de timed para allDay limpando os horários', async () => {
      const updateSpy = vi.spyOn(repo, 'updateUnavailability').mockImplementation(async (_id, _minId, up) => ({
        ...existingRecord,
        ...up,
      } as MemberUnavailabilityRecord));

      const result = await service.updateMyUnavailability('avail-existing', mockMinistryId, mockUserId, {
        allDay: true,
        startTime: null,
        endTime: null,
      });

      expect(updateSpy).toHaveBeenCalledTimes(1);
      const appliedUpdates = updateSpy.mock.calls[0][2];
      expect(appliedUpdates.all_day).toBe(true);
      expect(appliedUpdates.start_time).toBeNull();
      expect(appliedUpdates.end_time).toBeNull();
      expect(appliedUpdates.starts_at).toBe('2026-09-20T00:00:00');
      expect(appliedUpdates.ends_at).toBe('2026-09-21T00:00:00');
      expect(result.allDay).toBe(true);
    });
  });

  describe('6. DELETE Unavailability (Ownership & Anti-IDOR)', () => {
    const existingRecord: MemberUnavailabilityRecord = {
      id: 'avail-del',
      ministry_id: mockMinistryId,
      member_id: mockMemberId,
      user_id: mockUserId,
      start_date: '2026-09-20',
      end_date: '2026-09-20',
      start_time: '18:00',
      end_time: '21:00',
      all_day: false,
      starts_at: '2026-09-20T18:00:00',
      ends_at: '2026-09-20T21:00:00',
      reason: null,
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
    };

    beforeEach(() => {
      vi.spyOn(service, 'resolveCanonicalMembership').mockResolvedValue({
        memberId: mockMemberId,
        role: 'member',
      });
      vi.spyOn(repo, 'getById').mockResolvedValue(existingRecord);
    });

    it('exclui com sucesso quando o registro pertence ao usuário autenticado', async () => {
      const delSpy = vi.spyOn(repo, 'deleteUnavailability').mockResolvedValue();

      await service.deleteMyUnavailability('avail-del', mockMinistryId, mockUserId);
      expect(delSpy).toHaveBeenCalledWith('avail-del', mockMinistryId);
    });

    it('falha fechado com 404 se tentar excluir registro de outro usuário', async () => {
      vi.spyOn(repo, 'getById').mockResolvedValue({
        ...existingRecord,
        user_id: 'someone-else',
        member_id: 'member-else',
      });

      await expect(
        service.deleteMyUnavailability('avail-del', mockMinistryId, mockUserId)
      ).rejects.toThrow(expect.objectContaining({ statusCode: 404, message: 'Indisponibilidade não encontrada.' }));
    });

    it('falha fechado com 404 se tentar excluir registro de outro ministério', async () => {
      vi.spyOn(repo, 'getById').mockRejectedValue(new AppError(404, 'Indisponibilidade não encontrada.'));

      await expect(
        service.deleteMyUnavailability('avail-cross-min', mockMinistryId, mockUserId)
      ).rejects.toThrow(expect.objectContaining({ statusCode: 404 }));
    });
  });

  describe('7. Controller Handlers & Status Codes', () => {
    it('createMyUnavailability responde com HTTP 201 Created', async () => {
      vi.spyOn(service, 'createMyUnavailability').mockResolvedValue({
        id: 'new-id',
        ministryId: mockMinistryId,
        memberId: mockMemberId,
        startDate: '2026-09-20',
        endDate: '2026-09-20',
        startTime: null,
        endTime: null,
        allDay: true,
        startsAt: '2026-09-20T00:00:00',
        endsAt: '2026-09-21T00:00:00',
        reason: null,
        createdAt: '2026-09-09T00:00:00.000Z',
        updatedAt: '2026-09-09T00:00:00.000Z',
      });

      const req: any = {
        params: { ministryId: mockMinistryId },
        user: { id: mockUserId },
        body: { startDate: '2026-09-20', endDate: '2026-09-20', allDay: true },
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await controller.createMyUnavailability(req, res, next);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-id' }));
    });

    it('deleteMyUnavailability responde com HTTP 204 No Content', async () => {
      vi.spyOn(service, 'deleteMyUnavailability').mockResolvedValue();

      const req: any = {
        params: { ministryId: mockMinistryId, id: 'del-id' },
        user: { id: mockUserId },
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      };
      const next = vi.fn();

      await controller.deleteMyUnavailability(req, res, next);
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalled();
    });

    it('rejeita requisições não autenticadas com 401', async () => {
      const req: any = {
        params: { ministryId: mockMinistryId },
        user: null,
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await controller.listMyUnavailabilities(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    it('listMyUnavailabilities rejeita limit inválido ou não numérico com HTTP 400', async () => {
      const invalidLimits = ['abc', 'NaN', '0', '-5', '101', ''];
      for (const lim of invalidLimits) {
        const req: any = {
          params: { ministryId: mockMinistryId },
          user: { id: mockUserId },
          query: { limit: lim },
        };
        const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
        const next = vi.fn();

        await controller.listMyUnavailabilities(req, res, next);
        expect(next).toHaveBeenCalledWith(
          expect.objectContaining({
            statusCode: 400,
            message: 'O parâmetro limit deve ser um número inteiro entre 1 e 100.',
            details: expect.objectContaining({ code: 'LIMIT_INVALID' }),
          })
        );
      }
    });

    it('listMyUnavailabilities aceita limit válido e repassa como inteiro ao serviço', async () => {
      const listSpy = vi.spyOn(service, 'listMyUnavailabilities').mockResolvedValue({
        data: [],
        nextCursor: null,
      });

      const req: any = {
        params: { ministryId: mockMinistryId },
        user: { id: mockUserId },
        query: { limit: '25' },
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await controller.listMyUnavailabilities(req, res, next);
      expect(listSpy).toHaveBeenCalledWith(mockMinistryId, mockUserId, 25, undefined);
      expect(res.json).toHaveBeenCalledWith({ data: [], nextCursor: null });
    });

    it('listMyUnavailabilities usa limit padrão 50 quando omitido', async () => {
      const listSpy = vi.spyOn(service, 'listMyUnavailabilities').mockResolvedValue({
        data: [],
        nextCursor: null,
      });

      const req: any = {
        params: { ministryId: mockMinistryId },
        user: { id: mockUserId },
        query: {},
      };
      const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await controller.listMyUnavailabilities(req, res, next);
      expect(listSpy).toHaveBeenCalledWith(mockMinistryId, mockUserId, 50, undefined);
      expect(res.json).toHaveBeenCalledWith({ data: [], nextCursor: null });
    });
  });

  describe('8. Zod Schema Validation', () => {
    it('valida input de criação com sucesso', () => {
      const valid = createUnavailabilitySchema.safeParse({
        startDate: '2026-09-20',
        endDate: '2026-09-20',
        allDay: true,
      });
      expect(valid.success).toBe(true);
    });

    it('rejeita datas mal formatadas no schema', () => {
      const invalid = createUnavailabilitySchema.safeParse({
        startDate: '20-09-2026',
        endDate: '2026-09-20',
        allDay: true,
      });
      expect(invalid.success).toBe(false);
    });

    it('rejeita motivo com mais de 255 caracteres', () => {
      const invalid = createUnavailabilitySchema.safeParse({
        startDate: '2026-09-20',
        endDate: '2026-09-20',
        allDay: true,
        reason: 'a'.repeat(256),
      });
      expect(invalid.success).toBe(false);
    });

    it('valida query parameters de listagem com listUnavailabilityQuerySchema', () => {
      // Casos inválidos
      const invalidCases = [
        { limit: 'abc' },
        { limit: 'NaN' },
        { limit: '0' },
        { limit: '-1' },
        { limit: '101' },
        { limit: '1.5' },
      ];
      for (const query of invalidCases) {
        const result = listUnavailabilityQuerySchema.safeParse(query);
        expect(result.success).toBe(false);
      }

      // Casos válidos
      const validEmpty = listUnavailabilityQuerySchema.safeParse({});
      expect(validEmpty.success).toBe(true);
      if (validEmpty.success) {
        expect(validEmpty.data.limit).toBe(50);
      }

      const validCustom = listUnavailabilityQuerySchema.safeParse({ limit: '20', cursor: 'tok-123' });
      expect(validCustom.success).toBe(true);
      if (validCustom.success) {
        expect(validCustom.data.limit).toBe(20);
        expect(validCustom.data.cursor).toBe('tok-123');
      }
    });

    it('valida checkAvailabilityConflictsSchema com sucesso', () => {
      const validWithDuration = checkAvailabilityConflictsSchema.safeParse({
        date: '2026-09-20',
        time: '19:00',
        durationMinutes: 90,
        participantIds: ['mem-1', 'mem-2'],
      });
      expect(validWithDuration.success).toBe(true);

      const validWithoutDuration = checkAvailabilityConflictsSchema.safeParse({
        date: '2026-09-20',
        time: '19:00',
        participantIds: ['mem-1'],
      });
      expect(validWithoutDuration.success).toBe(true);
    });

    it('rejeita checkAvailabilityConflictsSchema com inputs inválidos', () => {
      // Data inválida
      expect(
        checkAvailabilityConflictsSchema.safeParse({
          date: '20-09-2026',
          time: '19:00',
          participantIds: ['mem-1'],
        }).success
      ).toBe(false);

      // Hora inválida
      expect(
        checkAvailabilityConflictsSchema.safeParse({
          date: '2026-09-20',
          time: '25:00',
          participantIds: ['mem-1'],
        }).success
      ).toBe(false);

      // Duração abaixo de 15 min
      expect(
        checkAvailabilityConflictsSchema.safeParse({
          date: '2026-09-20',
          time: '19:00',
          durationMinutes: 14,
          participantIds: ['mem-1'],
        }).success
      ).toBe(false);

      // Duração acima de 1440 min
      expect(
        checkAvailabilityConflictsSchema.safeParse({
          date: '2026-09-20',
          time: '19:00',
          durationMinutes: 1441,
          participantIds: ['mem-1'],
        }).success
      ).toBe(false);

      // Mais de 50 participantes
      const tooMany = Array.from({ length: 51 }, (_, i) => `mem-${i}`);
      expect(
        checkAvailabilityConflictsSchema.safeParse({
          date: '2026-09-20',
          time: '19:00',
          participantIds: tooMany,
        }).success
      ).toBe(false);
    });
  });

  describe('9. resolveMinistryMemberIds (Canonical Normalization & Tenant Boundary)', () => {
    it('retorna vazio se a lista de participantes for vazia', async () => {
      const res = await service.resolveMinistryMemberIds(mockMinistryId, []);
      expect(res.canonicalMemberIds).toEqual([]);
      expect(res.unresolvedParticipantIds).toEqual([]);
      expect(res.resolutionMap.size).toBe(0);
    });

    it('rejeita mais de 50 participantes com AppError 400', async () => {
      const ids = Array.from({ length: 51 }, (_, i) => `id-${i}`);
      await expect(service.resolveMinistryMemberIds(mockMinistryId, ids)).rejects.toThrow(
        expect.objectContaining({ statusCode: 400 })
      );
    });

    it('resolve documentos de membros diretamente via doc ID quando pertencem ao ministério', async () => {
      const { db } = await import('../../lib/firebase');
      const spyGetAll = vi.spyOn(db, 'getAll').mockResolvedValue([
        {
          id: 'mem-1',
          exists: true,
          data: () => ({ ministry_id: mockMinistryId, name: 'Alice' }),
        },
      ] as any);

      const res = await service.resolveMinistryMemberIds(mockMinistryId, ['mem-1']);
      expect(res.canonicalMemberIds).toContain('mem-1');
      expect(res.resolutionMap.get('mem-1')).toBe('mem-1');
      expect(res.unresolvedParticipantIds).toEqual([]);
      spyGetAll.mockRestore();
    });

    it('NÃO resolve doc ID que pertence a outro ministério (Anti-IDOR Cross-Tenant)', async () => {
      const { db } = await import('../../lib/firebase');
      const spyGetAll = vi.spyOn(db, 'getAll').mockResolvedValue([
        {
          id: 'mem-foreign',
          exists: true,
          data: () => ({ ministry_id: 'other-ministry', name: 'Bob' }),
        },
      ] as any);

      // E a busca por user_id também não encontra nada
      vi.spyOn((service as any).membersCol, 'where').mockReturnValue({
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ docs: [] }),
        }),
      } as any);

      const res = await service.resolveMinistryMemberIds(mockMinistryId, ['mem-foreign']);
      expect(res.canonicalMemberIds).not.toContain('mem-foreign');
      expect(res.unresolvedParticipantIds).toContain('mem-foreign');
      spyGetAll.mockRestore();
    });

    it('resolve user_id do Firebase Auth para o member_id correspondente no ministério', async () => {
      const { db } = await import('../../lib/firebase');
      // doc snap não existe para 'auth-uid-123'
      const spyGetAll = vi.spyOn(db, 'getAll').mockResolvedValue([
        {
          id: 'auth-uid-123',
          exists: false,
        },
      ] as any);

      // Query por user_id encontra o membro
      vi.spyOn((service as any).membersCol, 'where').mockReturnValue({
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            docs: [
              {
                id: 'mem-resolved-123',
                data: () => ({
                  ministry_id: mockMinistryId,
                  user_id: 'auth-uid-123',
                  name: 'Carol',
                }),
              },
            ],
          }),
        }),
      } as any);

      const res = await service.resolveMinistryMemberIds(mockMinistryId, ['auth-uid-123']);
      expect(res.canonicalMemberIds).toContain('mem-resolved-123');
      expect(res.resolutionMap.get('auth-uid-123')).toBe('mem-resolved-123');
      expect(res.unresolvedParticipantIds).toEqual([]);
      spyGetAll.mockRestore();
    });
  });

  describe('10. checkScheduleConflicts (Pure Overlap, Fallbacks, Privacy & Pagination)', () => {
    it('detecta conflitos e OMITI RIGOROSAMENTE o campo reason da resposta', async () => {
      vi.spyOn(service, 'resolveMinistryMemberIds').mockResolvedValue({
        canonicalMemberIds: ['mem-1'],
        resolutionMap: new Map([['mem-1', 'mem-1']]),
        unresolvedParticipantIds: [],
      });

      const mockCandidate: MemberUnavailabilityRecord = {
        id: 'unavail-1',
        ministry_id: mockMinistryId,
        member_id: 'mem-1',
        user_id: 'user-1',
        start_date: '2026-09-20',
        end_date: '2026-09-20',
        start_time: '18:00',
        end_time: '20:00',
        all_day: false,
        starts_at: '2026-09-20T18:00:00',
        ends_at: '2026-09-20T20:00:00',
        reason: 'CONFIDENTIAL MEDICAL REASON',
        created_at: '2026-09-01T00:00:00Z',
        updated_at: '2026-09-01T00:00:00Z',
      };

      vi.spyOn(repo, 'findConflictCandidates').mockResolvedValue([mockCandidate]);

      const result = await service.checkScheduleConflicts(mockMinistryId, {
        date: '2026-09-20',
        time: '19:00',
        durationMinutes: 120,
        participantIds: ['mem-1'],
      });

      expect(result.scheduleWindow.startsAt).toBe('2026-09-20T19:00:00');
      expect(result.scheduleWindow.endsAt).toBe('2026-09-20T21:00:00');
      expect(result.scheduleWindow.durationMinutes).toBe(120);
      expect(result.scheduleWindow.durationSource).toBe('explicit');

      expect(result.conflicts.length).toBe(1);
      const c = result.conflicts[0];
      expect(c.participantId).toBe('mem-1');
      expect(c.hasConflict).toBe(true);
      expect(c.unavailabilities.length).toBe(1);

      // PRIVACIDADE: O campo 'reason' NUNCA deve estar presente
      expect((c.unavailabilities[0] as any).reason).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain('CONFIDENTIAL MEDICAL REASON');
    });

    it('aplica fallback de duração não-mutante (120 min) quando durationMinutes for omitido', async () => {
      vi.spyOn(service, 'resolveMinistryMemberIds').mockResolvedValue({
        canonicalMemberIds: ['mem-1'],
        resolutionMap: new Map([['mem-1', 'mem-1']]),
        unresolvedParticipantIds: [],
      });
      vi.spyOn(repo, 'findConflictCandidates').mockResolvedValue([]);

      const result = await service.checkScheduleConflicts(mockMinistryId, {
        date: '2026-09-20',
        time: '10:00',
        participantIds: ['mem-1'],
      });

      expect(result.scheduleWindow.startsAt).toBe('2026-09-20T10:00:00');
      expect(result.scheduleWindow.endsAt).toBe('2026-09-20T12:00:00');
      expect(result.scheduleWindow.durationMinutes).toBe(120);
      expect(result.scheduleWindow.durationSource).toBe('legacy_fallback');
    });

    it('não reporta conflito para participante sem sobreposição (adjacência exata)', async () => {
      vi.spyOn(service, 'resolveMinistryMemberIds').mockResolvedValue({
        canonicalMemberIds: ['mem-1'],
        resolutionMap: new Map([['mem-1', 'mem-1']]),
        unresolvedParticipantIds: [],
      });

      // Indisponibilidade termina exatamente quando a escala começa (19:00)
      const mockCandidate: MemberUnavailabilityRecord = {
        id: 'unavail-adjacent',
        ministry_id: mockMinistryId,
        member_id: 'mem-1',
        user_id: 'user-1',
        start_date: '2026-09-20',
        end_date: '2026-09-20',
        start_time: '17:00',
        end_time: '19:00',
        all_day: false,
        starts_at: '2026-09-20T17:00:00',
        ends_at: '2026-09-20T19:00:00',
        reason: null,
        created_at: '2026-09-01T00:00:00Z',
        updated_at: '2026-09-01T00:00:00Z',
      };

      vi.spyOn(repo, 'findConflictCandidates').mockResolvedValue([mockCandidate]);

      const result = await service.checkScheduleConflicts(mockMinistryId, {
        date: '2026-09-20',
        time: '19:00',
        durationMinutes: 120,
        participantIds: ['mem-1'],
      });

      expect(result.conflicts[0].hasConflict).toBe(false);
      expect(result.conflicts[0].unavailabilities).toHaveLength(0);
    });

    it('lida com participantes não resolvidos marcando hasConflict: false', async () => {
      vi.spyOn(service, 'resolveMinistryMemberIds').mockResolvedValue({
        canonicalMemberIds: [],
        resolutionMap: new Map(),
        unresolvedParticipantIds: ['unknown-id'],
      });
      vi.spyOn(repo, 'findConflictCandidates').mockResolvedValue([]);

      const result = await service.checkScheduleConflicts(mockMinistryId, {
        date: '2026-09-20',
        time: '19:00',
        participantIds: ['unknown-id'],
      });

      expect(result.conflicts[0].participantId).toBe('unknown-id');
      expect(result.conflicts[0].memberId).toBeNull();
      expect(result.conflicts[0].hasConflict).toBe(false);
      expect(result.unresolvedParticipantIds).toContain('unknown-id');
    });
  });

  describe('11. AvailabilityRepository.findConflictCandidates (Pagination & DoS Protection)', () => {
    it('executa loop de paginação quando a primeira página atinge PAGE_SIZE para evitar falsos-negativos', async () => {
      // Simula 100 itens na primeira página e 20 na segunda
      const page1Docs = Array.from({ length: 100 }, (_, i) => ({
        id: `doc-${i}`,
        data: () => ({
          ministry_id: mockMinistryId,
          member_id: 'mem-1',
          starts_at: '2026-09-20T18:00:00',
          ends_at: '2026-09-20T20:00:00',
        }),
      }));
      const page2Docs = Array.from({ length: 20 }, (_, i) => ({
        id: `doc-${100 + i}`,
        data: () => ({
          ministry_id: mockMinistryId,
          member_id: 'mem-1',
          starts_at: '2026-09-20T18:30:00',
          ends_at: '2026-09-20T20:30:00',
        }),
      }));

      let queryCallCount = 0;
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        startAfter: vi.fn().mockReturnThis(),
        get: vi.fn().mockImplementation(async () => {
          queryCallCount++;
          if (queryCallCount === 1) {
            return { docs: page1Docs };
          }
          return { docs: page2Docs };
        }),
      };

      (repo as any).unavailabilitiesCol = mockQuery;

      const candidates = await repo.findConflictCandidates(
        mockMinistryId,
        ['mem-1'],
        '2026-09-20T19:00:00',
        '2026-09-20T21:00:00'
      );

      // Deve ter paginado 2 vezes e retornado todos os 120 candidatos
      expect(queryCallCount).toBe(2);
      expect(candidates.length).toBe(120);
    });

    it('dispara erro 400 AVAILABILITY_CONFLICT_CHECK_TOO_LARGE se ultrapassar 1000 candidatos', async () => {
      const largeBatchDocs = Array.from({ length: 100 }, (_, i) => ({
        id: `large-doc-${i}`,
        data: () => ({
          ministry_id: mockMinistryId,
          member_id: 'mem-1',
          starts_at: '2026-09-20T18:00:00',
          ends_at: '2026-09-20T20:00:00',
        }),
      }));

      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        startAfter: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({ docs: largeBatchDocs }),
      };

      (repo as any).unavailabilitiesCol = mockQuery;

      await expect(
        repo.findConflictCandidates(
          mockMinistryId,
          ['mem-1'],
          '2026-09-20T19:00:00',
          '2026-09-20T21:00:00'
        )
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          details: expect.objectContaining({ code: 'AVAILABILITY_CONFLICT_CHECK_TOO_LARGE' }),
        })
      );
    });
  });

  describe('12. AvailabilityController.checkScheduleConflicts Integration', () => {
    it('responde 200 com resultado do serviço', async () => {
      const checkSpy = vi.spyOn(service, 'checkScheduleConflicts').mockResolvedValue({
        scheduleWindow: {
          startsAt: '2026-09-20T19:00:00',
          endsAt: '2026-09-20T21:00:00',
          durationMinutes: 120,
          durationSource: 'explicit',
        },
        conflicts: [],
        unresolvedParticipantIds: [],
      });

      const req: any = {
        user: { id: mockUserId },
        params: { ministryId: mockMinistryId },
        body: {
          date: '2026-09-20',
          time: '19:00',
          durationMinutes: 120,
          participantIds: ['mem-1'],
        },
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await controller.checkScheduleConflicts(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduleWindow: expect.any(Object),
          conflicts: [],
        })
      );
      expect(checkSpy).toHaveBeenCalledWith(mockMinistryId, req.body);
    });

    it('propaga erro para o middleware de erro quando serviço falhar', async () => {
      vi.spyOn(service, 'checkScheduleConflicts').mockRejectedValue(new AppError(400, 'Erro de validação'));

      const req: any = {
        user: { id: mockUserId },
        params: { ministryId: mockMinistryId },
        body: { date: '2026-09-20', time: '19:00', participantIds: [] },
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await controller.checkScheduleConflicts(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(AppError));
    });
  });
});

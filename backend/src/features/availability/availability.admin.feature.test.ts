import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AvailabilityRepository,
  MemberUnavailabilityRecord,
  encodeAdminAvailabilityCursor,
  decodeAdminAvailabilityCursor,
  AdminAvailabilityCursorData,
} from '../../repositories/AvailabilityRepository';
import { AvailabilityService } from './availability.service';
import { AvailabilityController } from './availability.controller';
import { listConsolidatedAvailabilityQuerySchema } from './availability.types';
import { AppError } from '../../middleware/error-handler';
import { db } from '../../lib/firebase';
import { requireMinistryRole } from '../../middleware/rbac';
import { MinistryRepository } from '../../repositories/MinistryRepository';

describe('Admin Consolidated Availability Feature Test Suite (Phase 6D-1)', () => {
  let repo: AvailabilityRepository;
  let service: AvailabilityService;
  let controller: AvailabilityController;

  const mockMinistryId = 'min-alpha';
  const mockUserId = 'user-admin-123';
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

  // =========================================================================
  // 1. CURSOR ENCODING, DECODING & ANTI-TAMPERING
  // =========================================================================
  describe('1. Admin Availability Cursor Encoding, Decoding & Anti-Tampering', () => {
    const validCursorData: AdminAvailabilityCursorData = {
      id: 'rec-123',
      s: '2026-09-15T00:00:00',
      m: mockMinistryId,
      wStart: '2026-09-01T00:00:00',
      wEnd: '2026-10-01T00:00:00',
      mem: null,
    };

    it('codifica e decodifica cursor administrativo determinístico com sucesso', () => {
      const cursor = encodeAdminAvailabilityCursor(validCursorData);
      expect(typeof cursor).toBe('string');

      const decoded = decodeAdminAvailabilityCursor(
        cursor,
        mockMinistryId,
        '2026-09-01T00:00:00',
        '2026-10-01T00:00:00'
      );

      expect(decoded.id).toBe('rec-123');
      expect(decoded.s).toBe('2026-09-15T00:00:00');
      expect(decoded.m).toBe(mockMinistryId);
      expect(decoded.wStart).toBe('2026-09-01T00:00:00');
      expect(decoded.wEnd).toBe('2026-10-01T00:00:00');
      expect(decoded.mem).toBeNull();
    });

    it('suporta cursor com filtro por memberId', () => {
      const dataWithMember: AdminAvailabilityCursorData = {
        ...validCursorData,
        mem: mockMemberId,
      };
      const cursor = encodeAdminAvailabilityCursor(dataWithMember);

      const decoded = decodeAdminAvailabilityCursor(
        cursor,
        mockMinistryId,
        '2026-09-01T00:00:00',
        '2026-10-01T00:00:00',
        mockMemberId
      );

      expect(decoded.mem).toBe(mockMemberId);
    });

    it('rejeita cursor com ministryId divergente (anti-IDOR cross-tenant)', () => {
      const cursor = encodeAdminAvailabilityCursor({
        ...validCursorData,
        m: 'other-ministry',
      });

      expect(() =>
        decodeAdminAvailabilityCursor(
          cursor,
          mockMinistryId,
          '2026-09-01T00:00:00',
          '2026-10-01T00:00:00'
        )
      ).toThrow(
        expect.objectContaining({
          statusCode: 400,
          details: expect.objectContaining({ code: 'CROSS_CONTEXT_CURSOR_REJECTED' }),
        })
      );
    });

    it('rejeita cursor com janela temporal inicial alterada (windowStart)', () => {
      const cursor = encodeAdminAvailabilityCursor({
        ...validCursorData,
        wStart: '2026-08-01T00:00:00',
      });

      expect(() =>
        decodeAdminAvailabilityCursor(
          cursor,
          mockMinistryId,
          '2026-09-01T00:00:00',
          '2026-10-01T00:00:00'
        )
      ).toThrow(
        expect.objectContaining({
          statusCode: 400,
          details: expect.objectContaining({ code: 'CROSS_CONTEXT_CURSOR_REJECTED' }),
        })
      );
    });

    it('rejeita cursor com janela temporal final alterada (windowEndExclusive)', () => {
      const cursor = encodeAdminAvailabilityCursor({
        ...validCursorData,
        wEnd: '2026-10-15T00:00:00',
      });

      expect(() =>
        decodeAdminAvailabilityCursor(
          cursor,
          mockMinistryId,
          '2026-09-01T00:00:00',
          '2026-10-01T00:00:00'
        )
      ).toThrow(
        expect.objectContaining({
          statusCode: 400,
          details: expect.objectContaining({ code: 'CROSS_CONTEXT_CURSOR_REJECTED' }),
        })
      );
    });

    it('rejeita cursor com memberId divergente do filtro atual', () => {
      const cursor = encodeAdminAvailabilityCursor({
        ...validCursorData,
        mem: 'other-member',
      });

      expect(() =>
        decodeAdminAvailabilityCursor(
          cursor,
          mockMinistryId,
          '2026-09-01T00:00:00',
          '2026-10-01T00:00:00',
          mockMemberId
        )
      ).toThrow(
        expect.objectContaining({
          statusCode: 400,
          details: expect.objectContaining({ code: 'CROSS_CONTEXT_CURSOR_REJECTED' }),
        })
      );
    });

    it('rejeita token malformado ou payload adulterado com INVALID_CURSOR', () => {
      expect(() =>
        decodeAdminAvailabilityCursor(
          'bad-base64-token-1234',
          mockMinistryId,
          '2026-09-01T00:00:00',
          '2026-10-01T00:00:00'
        )
      ).toThrow(
        expect.objectContaining({
          statusCode: 400,
          details: expect.objectContaining({ code: 'INVALID_CURSOR' }),
        })
      );

      // JSON incompleto
      const incompleteToken = Buffer.from(JSON.stringify({ id: '1' }), 'utf8').toString('base64url');
      expect(() =>
        decodeAdminAvailabilityCursor(
          incompleteToken,
          mockMinistryId,
          '2026-09-01T00:00:00',
          '2026-10-01T00:00:00'
        )
      ).toThrow(
        expect.objectContaining({
          statusCode: 400,
          details: expect.objectContaining({ code: 'INVALID_CURSOR' }),
        })
      );
    });
  });

  // =========================================================================
  // 2. QUERY SCHEMA VALIDATION (ZOD)
  // =========================================================================
  describe('2. Query Schema Validation (listConsolidatedAvailabilityQuerySchema)', () => {
    it('aceita consulta válida e aplica valor padrão de limit = 50', () => {
      const parsed = listConsolidatedAvailabilityQuerySchema.parse({
        from: '2026-09-01',
        to: '2026-09-30',
      });

      expect(parsed.from).toBe('2026-09-01');
      expect(parsed.to).toBe('2026-09-30');
      expect(parsed.limit).toBe(50);
      expect(parsed.memberId).toBeUndefined();
      expect(parsed.cursor).toBeUndefined();
    });

    it('converte limit string para número inteiro validado', () => {
      const parsed = listConsolidatedAvailabilityQuerySchema.parse({
        from: '2026-09-01',
        to: '2026-09-30',
        limit: '25',
      });
      expect(parsed.limit).toBe(25);
    });

    it('aceita filtros opcionais de memberId e cursor', () => {
      const parsed = listConsolidatedAvailabilityQuerySchema.parse({
        from: '2026-09-01',
        to: '2026-09-30',
        memberId: 'mem-123',
        cursor: 'some-cursor',
      });
      expect(parsed.memberId).toBe('mem-123');
      expect(parsed.cursor).toBe('some-cursor');
    });

    it('rejeita quando from estiver ausente', () => {
      expect(
        listConsolidatedAvailabilityQuerySchema.safeParse({
          to: '2026-09-30',
        }).success
      ).toBe(false);
    });

    it('rejeita quando to estiver ausente', () => {
      expect(
        listConsolidatedAvailabilityQuerySchema.safeParse({
          from: '2026-09-01',
        }).success
      ).toBe(false);
    });

    it('rejeita formato de data inválido', () => {
      expect(
        listConsolidatedAvailabilityQuerySchema.safeParse({
          from: '01/09/2026',
          to: '2026-09-30',
        }).success
      ).toBe(false);

      expect(
        listConsolidatedAvailabilityQuerySchema.safeParse({
          from: '2026-09-01',
          to: 'invalid',
        }).success
      ).toBe(false);
    });

    it('rejeita limit fora dos limites permitidos (1..100)', () => {
      expect(
        listConsolidatedAvailabilityQuerySchema.safeParse({
          from: '2026-09-01',
          to: '2026-09-30',
          limit: '0',
        }).success
      ).toBe(false);

      expect(
        listConsolidatedAvailabilityQuerySchema.safeParse({
          from: '2026-09-01',
          to: '2026-09-30',
          limit: '101',
        }).success
      ).toBe(false);
    });
  });

  // =========================================================================
  // 3. REPOSITORY: LIST CONSOLIDATED & OVERLAP MATH
  // =========================================================================
  describe('3. AvailabilityRepository.listConsolidated (Interval Overlap & Continuous Scan)', () => {
    const windowStart = '2026-09-01T00:00:00';
    const windowEndExclusive = '2026-10-01T00:00:00';
    const lookbackStart = '2026-06-03T00:00:00';

    it('filtra corretamente por sobreposição canônica [starts_at, ends_at)', async () => {
      const mockDocs = [
        {
          id: 'doc-1-before',
          data: () => ({
            ministry_id: mockMinistryId,
            member_id: 'mem-1',
            user_id: 'u-1',
            start_date: '2026-08-01',
            end_date: '2026-08-15',
            starts_at: '2026-08-01T00:00:00',
            ends_at: '2026-08-16T00:00:00',
            all_day: true,
            reason: 'Segredo 1',
          }),
        },
        {
          id: 'doc-2-overlap-start',
          data: () => ({
            ministry_id: mockMinistryId,
            member_id: 'mem-2',
            user_id: 'u-2',
            start_date: '2026-08-25',
            end_date: '2026-09-05',
            starts_at: '2026-08-25T00:00:00',
            ends_at: '2026-09-06T00:00:00',
            all_day: true,
            reason: 'Segredo 2',
          }),
        },
        {
          id: 'doc-3-inside',
          data: () => ({
            ministry_id: mockMinistryId,
            member_id: 'mem-3',
            user_id: 'u-3',
            start_date: '2026-09-10',
            end_date: '2026-09-12',
            starts_at: '2026-09-10T00:00:00',
            ends_at: '2026-09-13T00:00:00',
            all_day: true,
            reason: 'Segredo 3',
          }),
        },
        {
          id: 'doc-4-overlap-end',
          data: () => ({
            ministry_id: mockMinistryId,
            member_id: 'mem-4',
            user_id: 'u-4',
            start_date: '2026-09-25',
            end_date: '2026-10-05',
            starts_at: '2026-09-25T00:00:00',
            ends_at: '2026-10-06T00:00:00',
            all_day: true,
            reason: 'Segredo 4',
          }),
        },
        {
          id: 'doc-5-spans-all',
          data: () => ({
            ministry_id: mockMinistryId,
            member_id: 'mem-5',
            user_id: 'u-5',
            start_date: '2026-08-15',
            end_date: '2026-10-15',
            starts_at: '2026-08-15T00:00:00',
            ends_at: '2026-10-16T00:00:00',
            all_day: true,
            reason: 'Segredo 5',
          }),
        },
        {
          id: 'doc-6-exact-start-boundary',
          data: () => ({
            ministry_id: mockMinistryId,
            member_id: 'mem-6',
            user_id: 'u-6',
            start_date: '2026-08-20',
            end_date: '2026-08-31',
            starts_at: '2026-08-20T00:00:00',
            ends_at: '2026-09-01T00:00:00',
            all_day: true,
            reason: 'Segredo 6',
          }),
        },
      ];

      const queryMock = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({ docs: mockDocs }),
      };

      vi.spyOn((repo as any).unavailabilitiesCol, 'where').mockReturnValue(queryMock as any);

      const result = await repo.listConsolidated({
        ministryId: mockMinistryId,
        windowStart,
        windowEndExclusive,
        lookbackStart,
        limitCount: 50,
      });

      const returnedIds = result.data.map((r) => r.id);
      expect(returnedIds).toContain('doc-2-overlap-start');
      expect(returnedIds).toContain('doc-3-inside');
      expect(returnedIds).toContain('doc-4-overlap-end');
      expect(returnedIds).toContain('doc-5-spans-all');

      expect(returnedIds).not.toContain('doc-1-before');
      expect(returnedIds).not.toContain('doc-6-exact-start-boundary');
      expect(result.data.length).toBe(4);
    });

    it('suporta filtro opcional por memberId na consulta ao Firestore', async () => {
      const queryMock = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({ docs: [] }),
      };

      vi.spyOn((repo as any).unavailabilitiesCol, 'where').mockReturnValue(queryMock as any);

      await repo.listConsolidated({
        ministryId: mockMinistryId,
        windowStart,
        windowEndExclusive,
        lookbackStart,
        memberId: mockMemberId,
      });

      expect(queryMock.where).toHaveBeenCalledWith('member_id', '==', mockMemberId);
    });

    it('executa varredura contínua entre lotes para evitar páginas falsamente vazias', async () => {
      const batch1Docs = Array.from({ length: 50 }, (_, i) => ({
        id: `b1-doc-${i}`,
        data: () => ({
          ministry_id: mockMinistryId,
          member_id: `mem-${i}`,
          user_id: `u-${i}`,
          start_date: '2026-07-01',
          end_date: '2026-07-10',
          starts_at: `2026-07-01T${String(i).padStart(2, '0')}:00:00`,
          ends_at: '2026-07-11T00:00:00',
          all_day: true,
          reason: 'Lote 1',
        }),
      }));

      const batch2Docs = [
        {
          id: 'b2-doc-1',
          data: () => ({
            ministry_id: mockMinistryId,
            member_id: 'mem-target',
            user_id: 'u-target',
            start_date: '2026-09-10',
            end_date: '2026-09-12',
            starts_at: '2026-09-10T00:00:00',
            ends_at: '2026-09-13T00:00:00',
            all_day: true,
            reason: 'Lote 2',
          }),
        },
      ];

      let callCount = 0;
      const queryMock = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        startAfter: vi.fn().mockReturnThis(),
        get: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) {
            return { docs: batch1Docs };
          } else {
            return { docs: batch2Docs };
          }
        }),
      };

      vi.spyOn((repo as any).unavailabilitiesCol, 'where').mockReturnValue(queryMock as any);

      const result = await repo.listConsolidated({
        ministryId: mockMinistryId,
        windowStart,
        windowEndExclusive,
        lookbackStart,
        limitCount: 10,
      });

      expect(callCount).toBe(2);
      expect(result.data.length).toBe(1);
      expect(result.data[0].id).toBe('b2-doc-1');
      expect(result.scannedCandidatesCount).toBe(51);
    });

    it('dispara erro AVAILABILITY_QUERY_TOO_LARGE se ultrapassar o teto de 1000 candidatos', async () => {
      const massiveBatch = Array.from({ length: 100 }, (_, i) => ({
        id: `massive-doc-${i}`,
        data: () => ({
          ministry_id: mockMinistryId,
          member_id: `mem-${i}`,
          user_id: `u-${i}`,
          start_date: '2026-07-01',
          end_date: '2026-07-10',
          starts_at: '2026-07-01T00:00:00',
          ends_at: '2026-07-11T00:00:00',
          all_day: true,
        }),
      }));

      const queryMock = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        startAfter: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({ docs: massiveBatch }),
      };

      vi.spyOn((repo as any).unavailabilitiesCol, 'where').mockReturnValue(queryMock as any);

      await expect(
        repo.listConsolidated({
          ministryId: mockMinistryId,
          windowStart,
          windowEndExclusive,
          lookbackStart,
          limitCount: 10,
        })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          details: expect.objectContaining({ code: 'AVAILABILITY_QUERY_TOO_LARGE' }),
        })
      );
    });
  });

  // =========================================================================
  // 4. SERVICE: WINDOW VALIDATION, TENANT BOUNDARY, ENRICHMENT & PRIVACY
  // =========================================================================
  describe('4. AvailabilityService.listConsolidatedAvailability (Security, Enrichment & Privacy)', () => {
    it('rejeita período superior a 90 dias com MAX_PLANNING_WINDOW_EXCEEDED', async () => {
      await expect(
        service.listConsolidatedAvailability(mockMinistryId, {
          from: '2026-01-01',
          to: '2026-04-01',
        })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          details: expect.objectContaining({ code: 'MAX_PLANNING_WINDOW_EXCEEDED' }),
        })
      );
    });

    it('rejeita to anterior a from com INVALID_DATE_RANGE', async () => {
      await expect(
        service.listConsolidatedAvailability(mockMinistryId, {
          from: '2026-09-30',
          to: '2026-09-01',
        })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          details: expect.objectContaining({ code: 'INVALID_DATE_RANGE' }),
        })
      );
    });

    it('valida isolamento do integrante (memberId) e falha com 404 se pertencer a outro ministério (Anti-IDOR)', async () => {
      vi.spyOn((service as any).membersCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ ministry_id: 'foreign-ministry' }),
        }),
      } as any);

      await expect(
        service.listConsolidatedAvailability(mockMinistryId, {
          from: '2026-09-01',
          to: '2026-09-15',
          memberId: 'foreign-member-id',
        })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 404,
          details: expect.objectContaining({ code: 'MEMBER_NOT_FOUND' }),
        })
      );
    });

    it('falha fechado com 404 se o integrante filtrado não existir', async () => {
      vi.spyOn((service as any).membersCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: false,
        }),
      } as any);

      await expect(
        service.listConsolidatedAvailability(mockMinistryId, {
          from: '2026-09-01',
          to: '2026-09-15',
          memberId: 'nonexistent-member',
        })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 404,
          details: expect.objectContaining({ code: 'MEMBER_NOT_FOUND' }),
        })
      );
    });

    it('enriquece nomes dos integrantes em lote sem N+1 e com guarda multi-tenant', async () => {
      const mockRecord: MemberUnavailabilityRecord = {
        id: 'rec-1',
        ministry_id: mockMinistryId,
        member_id: 'mem-valid-1',
        user_id: 'user-1',
        start_date: '2026-09-10',
        end_date: '2026-09-12',
        start_time: null,
        end_time: null,
        all_day: true,
        starts_at: '2026-09-10T00:00:00',
        ends_at: '2026-09-13T00:00:00',
        reason: 'Motivo Confidencial do Integrante',
        created_at: '2026-09-01T00:00:00Z',
        updated_at: '2026-09-01T00:00:00Z',
      };

      vi.spyOn(repo, 'listConsolidated').mockResolvedValue({
        data: [mockRecord],
        nextCursor: null,
        scannedCandidatesCount: 1,
      });

      const spyGetAll = vi.spyOn(db, 'getAll').mockResolvedValue([
        {
          id: 'mem-valid-1',
          exists: true,
          data: () => ({ ministry_id: mockMinistryId, name: 'Carlos Vocal' }),
        },
      ] as any);

      const response = await service.listConsolidatedAvailability(mockMinistryId, {
        from: '2026-09-01',
        to: '2026-09-30',
      });

      expect(response.data.length).toBe(1);
      const item = response.data[0];
      expect(item.id).toBe('rec-1');
      expect(item.memberId).toBe('mem-valid-1');
      expect(item.memberName).toBe('Carlos Vocal');

      expect((item as any).reason).toBeUndefined();
      expect((item as any).user_id).toBeUndefined();
      expect((item as any).userId).toBeUndefined();

      spyGetAll.mockRestore();
    });

    it('guarda multi-tenant no enriquecimento: documento corrompido ou de outro ministério não vaza nome', async () => {
      const mockRecord: MemberUnavailabilityRecord = {
        id: 'rec-leak',
        ministry_id: mockMinistryId,
        member_id: 'mem-foreign',
        user_id: 'user-foreign',
        start_date: '2026-09-10',
        end_date: '2026-09-12',
        start_time: null,
        end_time: null,
        all_day: true,
        starts_at: '2026-09-10T00:00:00',
        ends_at: '2026-09-13T00:00:00',
        reason: 'Segredo',
        created_at: '2026-09-01T00:00:00Z',
        updated_at: '2026-09-01T00:00:00Z',
      };

      vi.spyOn(repo, 'listConsolidated').mockResolvedValue({
        data: [mockRecord],
        nextCursor: null,
        scannedCandidatesCount: 1,
      });

      const spyGetAll = vi.spyOn(db, 'getAll').mockResolvedValue([
        {
          id: 'mem-foreign',
          exists: true,
          data: () => ({ ministry_id: 'other-min', name: 'Nome Secreto de Outro Ministério' }),
        },
      ] as any);

      const response = await service.listConsolidatedAvailability(mockMinistryId, {
        from: '2026-09-01',
        to: '2026-09-30',
      });

      expect(response.data[0].memberName).toBe('Integrante');
      spyGetAll.mockRestore();
    });

    it('enriquece através da coleção users se o integrante não tiver campo name direto', async () => {
      const mockRecord: MemberUnavailabilityRecord = {
        id: 'rec-user',
        ministry_id: mockMinistryId,
        member_id: 'mem-user-only',
        user_id: 'u-firebase-1',
        start_date: '2026-09-10',
        end_date: '2026-09-12',
        start_time: null,
        end_time: null,
        all_day: true,
        starts_at: '2026-09-10T00:00:00',
        ends_at: '2026-09-13T00:00:00',
        reason: 'Privado',
        created_at: '2026-09-01T00:00:00Z',
        updated_at: '2026-09-01T00:00:00Z',
      };

      vi.spyOn(repo, 'listConsolidated').mockResolvedValue({
        data: [mockRecord],
        nextCursor: null,
        scannedCandidatesCount: 1,
      });

      let callIndex = 0;
      const spyGetAll = vi.spyOn(db, 'getAll').mockImplementation(async (...refs: any[]) => {
        callIndex++;
        if (callIndex === 1) {
          return [
            {
              id: 'mem-user-only',
              exists: true,
              data: () => ({ ministry_id: mockMinistryId, user_id: 'u-firebase-1' }),
            },
          ] as any;
        } else {
          return [
            {
              id: 'u-firebase-1',
              exists: true,
              data: () => ({ name: 'Lucas Guitarra' }),
            },
          ] as any;
        }
      });

      const response = await service.listConsolidatedAvailability(mockMinistryId, {
        from: '2026-09-01',
        to: '2026-09-30',
      });

      expect(response.data[0].memberName).toBe('Lucas Guitarra');
      spyGetAll.mockRestore();
    });
  });

  // =========================================================================
  // 5. CONTROLLER: REQUEST TRANSLATION, ALIASES & ERROR PROPAGATION
  // =========================================================================
  describe('5. AvailabilityController.listConsolidatedAvailability', () => {
    it('responde 200 com resultado retornado pelo serviço', async () => {
      const mockResult = {
        window: { from: '2026-09-01', to: '2026-09-30' },
        data: [],
        nextCursor: null,
      };

      const serviceSpy = vi.spyOn(service, 'listConsolidatedAvailability').mockResolvedValue(mockResult);

      const req: any = {
        user: { id: mockUserId },
        params: { ministryId: mockMinistryId },
        query: { from: '2026-09-01', to: '2026-09-30', limit: '50' },
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await controller.listConsolidatedAvailability(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(mockResult);
      expect(serviceSpy).toHaveBeenCalledWith(mockMinistryId, req.query);
    });

    it('suporta parâmetro de rota legado groupId (alias parity)', async () => {
      const serviceSpy = vi.spyOn(service, 'listConsolidatedAvailability').mockResolvedValue({
        window: { from: '2026-09-01', to: '2026-09-30' },
        data: [],
        nextCursor: null,
      });

      const req: any = {
        user: { id: mockUserId },
        params: { groupId: 'grp-legacy-123' },
        query: { from: '2026-09-01', to: '2026-09-30' },
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await controller.listConsolidatedAvailability(req, res, next);

      expect(serviceSpy).toHaveBeenCalledWith('grp-legacy-123', req.query);
    });

    it('rejeita com 401 se usuário não estiver autenticado (sem req.user)', async () => {
      const req: any = {
        user: null,
        params: { ministryId: mockMinistryId },
        query: { from: '2026-09-01', to: '2026-09-30' },
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await controller.listConsolidatedAvailability(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: 'Usuário não autenticado.',
        })
      );
    });

    it('propaga erro de validação ou de serviço para o next (error handler)', async () => {
      vi.spyOn(service, 'listConsolidatedAvailability').mockRejectedValue(
        new AppError(400, 'Período inválido')
      );

      const req: any = {
        user: { id: mockUserId },
        params: { ministryId: mockMinistryId },
        query: { from: '2026-09-01', to: '2026-09-30' },
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await controller.listConsolidatedAvailability(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(AppError));
    });
  });

  // =========================================================================
  // 6. RBAC MIDDLEWARE INTEGRATION (ADMIN-ONLY ACCESS GUARD)
  // =========================================================================
  describe('6. RBAC Guard requireMinistryRole(admin) for Consolidated Availability', () => {
    it('permite acesso a administrador do ministério (role = admin)', async () => {
      const middleware = requireMinistryRole('admin');

      vi.spyOn(MinistryRepository.prototype, 'getMinistryById').mockResolvedValue({
        id: mockMinistryId,
        name: 'Louvor Alpha',
        role: 'admin',
        subscription_status: 'active',
      } as any);

      const req: any = {
        user: { id: mockUserId },
        params: { ministryId: mockMinistryId },
      };
      const res: any = {};
      const next = vi.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('bloqueia membro comum (role = member) com 403 Forbidden', async () => {
      const middleware = requireMinistryRole('admin');

      vi.spyOn(MinistryRepository.prototype, 'getMinistryById').mockResolvedValue({
        id: mockMinistryId,
        name: 'Louvor Alpha',
        role: 'member',
        subscription_status: 'active',
      } as any);

      const req: any = {
        user: { id: mockUserId },
        params: { ministryId: mockMinistryId },
      };
      const res: any = {};
      const next = vi.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          message: expect.stringContaining('Ação restrita a administradores do ministério'),
        })
      );
    });

    it('falha com 404 se o usuário não pertencer ao ministério', async () => {
      const middleware = requireMinistryRole('admin');

      vi.spyOn(MinistryRepository.prototype, 'getMinistryById').mockRejectedValue(
        new AppError(404, 'Ministério não encontrado.')
      );

      const req: any = {
        user: { id: 'unauthorized-user' },
        params: { ministryId: mockMinistryId },
      };
      const res: any = {};
      const next = vi.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          message: 'Ministério não encontrado.',
        })
      );
    });
  });
});

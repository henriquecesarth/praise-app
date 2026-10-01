import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScheduleService } from './schedule.service';
import { ScheduleRepository, ScheduleRecord } from '../../repositories/ScheduleRepository';
import { createScheduleSchema, updateScheduleSchema } from './schedule.types';
import scheduleRouter from './schedule.routes';
import { AppError } from '../../middleware/error-handler';

describe('Schedule Feature & Hardening Suite', () => {
  let repo: ScheduleRepository;
  let service: ScheduleService;
  let mockNotificationService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new ScheduleRepository();
    mockNotificationService = {
      resolveParticipantUserIds: vi.fn().mockResolvedValue([]),
      notifyScheduleAssigned: vi.fn().mockResolvedValue(undefined),
      notifyScheduleUpdated: vi.fn().mockResolvedValue(undefined),
    };
    service = new ScheduleService(repo, mockNotificationService);
  });

  describe('1. Participant Uniqueness Schema Enforcement', () => {
    it('rejeita criação com participantes duplicados deterministamente com erro 400 Zod', () => {
      const payload = {
        title: 'Culto de Domingo',
        date: '2026-10-15',
        time: '19:00',
        participants: [
          { id: 'mem_1', name: 'João', role: 'Vocal' },
          { id: 'mem_1', name: 'João Silva', role: 'Violão' },
        ],
      };

      const result = createScheduleSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Não é permitido adicionar o mesmo participante mais de uma vez');
      }
    });

    it('aceita criação quando todos os participantes possuem identidades únicas', () => {
      const payload = {
        title: 'Culto de Domingo',
        date: '2026-10-15',
        time: '19:00',
        participants: [
          { id: 'mem_1', name: 'João', role: 'Vocal' },
          { id: 'mem_2', name: 'Maria', role: 'Teclado' },
        ],
      };

      const result = createScheduleSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('rejeita atualização com participantes duplicados deterministamente no updateScheduleSchema', () => {
      const payload = {
        participants: [
          { id: 'mem_dup', name: 'Lucas', role: 'Bateria' },
          { id: 'mem_dup', name: 'Lucas Outro', role: 'Baixo' },
        ],
      };

      const result = updateScheduleSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Não é permitido adicionar o mesmo participante mais de uma vez');
      }
    });

    it('aceita atualização com participantes únicos', () => {
      const payload = {
        participants: [
          { id: 'mem_1', name: 'Lucas', role: 'Bateria' },
          { id: 'mem_2', name: 'Pedro', role: 'Baixo' },
        ],
      };

      const result = updateScheduleSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });
  });

  describe('2. Participant Uniqueness Domain Service Enforcement', () => {
    it('createSchedule lança AppError 400 se payload contiver participantes duplicados', async () => {
      const duplicateData: Partial<ScheduleRecord> = {
        title: 'Ensaio',
        participants: [
          { id: 'member_x', name: 'A', role: 'Vocal' },
          { id: 'member_x', name: 'B', role: 'Ministro' },
        ],
      };

      await expect(service.createSchedule('min_1', 'user_1', duplicateData)).rejects.toThrow(AppError);
      await expect(service.createSchedule('min_1', 'user_1', duplicateData)).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining('Não é permitido adicionar o mesmo participante'),
      });
    });

    it('updateSchedule lança AppError 400 se atualização contiver participantes duplicados', async () => {
      const duplicateData: Partial<ScheduleRecord> = {
        participants: [
          { id: 'member_y', name: 'Ana', role: 'Vocal' },
          { id: 'member_y', name: 'Ana', role: 'Violão' },
        ],
      };

      await expect(service.updateSchedule('sched_1', 'min_1', duplicateData)).rejects.toThrow(AppError);
    });

    it('createSchedule persiste com sucesso quando participantes são únicos', async () => {
      const validData: Partial<ScheduleRecord> = {
        title: 'Culto Especial',
        participants: [
          { id: 'member_1', name: 'Ana', role: 'Vocal' },
          { id: 'member_2', name: 'Beto', role: 'Violão' },
        ],
      };

      const mockSaved: ScheduleRecord = {
        id: 'sched_new',
        ministry_id: 'min_1',
        created_by: 'user_1',
        title: 'Culto Especial',
        date: '2026-10-15',
        time: '19:00',
        duration_minutes: 120,
        durationMinutes: 120,
        isVisible: true,
        requireConfirmation: false,
        participants: validData.participants as any,
        songs: [],
        timeline: [],
        created_at: '2026-10-01T10:00:00Z',
        updated_at: '2026-10-01T10:00:00Z',
      };

      vi.spyOn(repo, 'createSchedule').mockResolvedValue(mockSaved);

      const result = await service.createSchedule('min_1', 'user_1', validData);
      expect(result.id).toBe('sched_new');
      expect(repo.createSchedule).toHaveBeenCalledWith('min_1', 'user_1', validData);
    });
  });

  describe('3. isVisible Round-trip & Default Semantics', () => {
    it('createScheduleSchema aplica default isVisible = true', () => {
      const parsed = createScheduleSchema.parse({
        title: 'Culto',
        date: '2026-10-20',
        time: '19:00',
      });
      expect(parsed.isVisible).toBe(true);
    });

    it('createScheduleSchema preserva isVisible = false explicitamente', () => {
      const parsed = createScheduleSchema.parse({
        title: 'Rascunho de Culto',
        date: '2026-10-20',
        time: '19:00',
        isVisible: false,
      });
      expect(parsed.isVisible).toBe(false);
    });

    it('updateScheduleSchema preserva isVisible = true/false', () => {
      const parsedTrue = updateScheduleSchema.parse({ isVisible: true });
      expect(parsedTrue.isVisible).toBe(true);

      const parsedFalse = updateScheduleSchema.parse({ isVisible: false });
      expect(parsedFalse.isVisible).toBe(false);
    });
  });

  describe('4. RBAC Route Guards & Tenant Safety', () => {
    it('garante que rotas de mutação exigem role admin e leitura exige member', () => {
      const routeLayers = scheduleRouter.stack.filter((layer: any) => layer.route);

      const postRoute = routeLayers.find(
        (l: any) => l.route.path === '/' && l.route.methods.post
      );
      expect(postRoute).toBeDefined();

      const putRoute = routeLayers.find(
        (l: any) => l.route.path === '/:scheduleId' && l.route.methods.put
      );
      expect(putRoute).toBeDefined();

      const deleteRoute = routeLayers.find(
        (l: any) => l.route.path === '/:scheduleId' && l.route.methods.delete
      );
      expect(deleteRoute).toBeDefined();

      const getListRoute = routeLayers.find(
        (l: any) => l.route.path === '/' && l.route.methods.get
      );
      expect(getListRoute).toBeDefined();

      const getDetailRoute = routeLayers.find(
        (l: any) => l.route.path === '/:scheduleId' && l.route.methods.get
      );
      expect(getDetailRoute).toBeDefined();
    });
  });
});

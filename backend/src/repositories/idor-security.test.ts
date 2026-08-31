import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SmartChordRepository } from './SmartChordRepository';
import { RepertoireRepository } from './RepertoireRepository';
import { ScheduleRepository } from './ScheduleRepository';
import { LiturgyRepository } from './LiturgyRepository';
import { MinistryRepository } from './MinistryRepository';
import { AppError } from '../middleware/error-handler';
import { db } from '../lib/firebase';

describe('Security Hardening: IDOR and Tenant Isolation Repositories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('SmartChordRepository (User-scoped isolation)', () => {
    const repo = new SmartChordRepository();

    it('deve retornar 404 ao tentar buscar uma cifra de outro usuário', async () => {
      vi.spyOn((repo as any).smartChordsCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'chord-1',
          data: () => ({ user_id: 'usr-victim', title: 'Cifra Secreta' }),
        }),
      });

      await expect(repo.getSmartChordById('chord-1', 'usr-attacker')).rejects.toThrow(
        expect.objectContaining({ statusCode: 404 })
      );
    });

    it('deve retornar 404 ao tentar atualizar uma cifra de outro usuário', async () => {
      vi.spyOn((repo as any).smartChordsCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'chord-1',
          data: () => ({ user_id: 'usr-victim', title: 'Cifra Secreta' }),
        }),
        update: vi.fn(),
      });

      await expect(repo.updateSmartChord('chord-1', 'usr-attacker', { title: 'Hacked' })).rejects.toThrow(
        expect.objectContaining({ statusCode: 404 })
      );
    });
  });

  describe('RepertoireRepository (Ministry-scoped isolation & IDOR guard)', () => {
    const repo = new RepertoireRepository();

    it('deve retornar 404 ao tentar acessar música de outro ministério', async () => {
      vi.spyOn((repo as any).songsCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'song-victim',
          data: () => ({ ministry_id: 'min-victim', title: 'Música Alheia' }),
        }),
      });

      await expect(repo.getSongById('song-victim', 'min-attacker')).rejects.toThrow(
        expect.objectContaining({ statusCode: 404 })
      );
    });

    it('deve retornar 404 ao tentar acessar pasta de outro ministério', async () => {
      vi.spyOn((repo as any).foldersCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'folder-victim',
          data: () => ({ ministry_id: 'min-victim', name: 'Pasta Alheia' }),
        }),
      });

      await expect(repo.getFolderById('folder-victim', 'min-attacker')).rejects.toThrow(
        expect.objectContaining({ statusCode: 404 })
      );
    });
  });

  describe('ScheduleRepository (Tenant isolation & Confirmation bypass protection)', () => {
    const repo = new ScheduleRepository();

    it('deve retornar 404 ao tentar acessar escala de outro ministério', async () => {
      vi.spyOn((repo as any).schedulesCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'sched-victim',
          data: () => ({ ministry_id: 'min-victim', title: 'Escala Alheia' }),
        }),
      });

      await expect(repo.getScheduleById('sched-victim', 'min-attacker')).rejects.toThrow(
        expect.objectContaining({ statusCode: 404 })
      );
    });

    it('deve rejeitar com 403 e NÃO confirmar outro participante se o usuário não fizer parte da escala', async () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString().split('T')[0];
      const mockSchedule = {
        id: 'sched-1',
        ministry_id: 'min-1',
        date: futureDate,
        participants: [
          { id: 'p1', user_id: 'usr-valid-1', name: 'João', confirmed: undefined },
          { id: 'p2', user_id: 'usr-valid-2', name: 'Maria', confirmed: undefined },
        ],
      };

      vi.spyOn((repo as any).schedulesCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'sched-1',
          data: () => mockSchedule,
        }),
        update: vi.fn(),
      });

      vi.spyOn(db, 'collection').mockReturnValue({
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ exists: false }),
        }),
      } as any);

      await expect(
        repo.updateParticipantConfirmation('sched-1', 'min-1', 'usr-unknown', 'Estranho', true)
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 403,
          message: expect.stringMatching(/Você não está listado como participante desta escala/i),
        })
      );
    });
  });

  describe('LiturgyRepository (Tenant isolation & Update validation)', () => {
    const repo = new LiturgyRepository();

    it('deve retornar 404 ao tentar acessar liturgia de outro ministério', async () => {
      vi.spyOn((repo as any).liturgiesCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'lit-victim',
          data: () => ({ group_id: 'min-victim', title: 'Culto Alheio' }),
        }),
      });

      await expect(repo.getLiturgyById('lit-victim', 'min-attacker')).rejects.toThrow(
        expect.objectContaining({ statusCode: 404 })
      );
    });
  });

  describe('MinistryRepository (Last Admin Protection & Security Rules)', () => {
    const repo = new MinistryRepository();

    it('deve impedir rebaixar o único administrador do ministério', async () => {
      vi.spyOn((repo as any).membersCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          ref: { update: vi.fn(), get: vi.fn() },
          data: () => ({ ministry_id: 'min-1', user_id: 'usr-admin', role: 'admin' }),
        }),
      });

      vi.spyOn((repo as any).membersCol, 'where').mockReturnValue({
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ size: 1, docs: [{ id: 'admin-doc' }] }),
        }),
      } as any);

      await expect(
        repo.updateMemberDetails('min-1', 'usr-admin', { role: 'member' })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          message: expect.stringMatching(/Não é possível rebaixar o único administrador/i),
        })
      );
    });
  });
});

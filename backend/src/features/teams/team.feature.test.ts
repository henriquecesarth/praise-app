import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TeamRepository } from '../../repositories/TeamRepository';
import { TeamService } from './team.service';
import { createTeamSchema, updateTeamSchema } from './team.types';
import { AppError } from '../../middleware/error-handler';
import { db } from '../../lib/firebase';

describe('Team Feature & Authority Hardening (M18)', () => {
  let repo: TeamRepository;
  let service: TeamService;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new TeamRepository();
    service = new TeamService(repo);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Zod Validation Schemas', () => {
    it('deve validar e formatar payload válido de criação', () => {
      const parsed = createTeamSchema.parse({
        name: '  Equipe de Louvor  ',
        description: '  Descrição da equipe  ',
        memberIds: ['mem-1', 'mem-2'],
      });
      expect(parsed.name).toBe('Equipe de Louvor');
      expect(parsed.description).toBe('Descrição da equipe');
      expect(parsed.memberIds).toEqual(['mem-1', 'mem-2']);
    });

    it('deve permitir criação com equipe vazia (EMPTY_TEAM_ALLOWED = YES)', () => {
      const parsed = createTeamSchema.parse({
        name: 'Equipe Sem Integrantes',
      });
      expect(parsed.memberIds).toEqual([]);
    });

    it('deve permitir descrição nula ou opcional', () => {
      const parsed = createTeamSchema.parse({
        name: 'Equipe Teste',
        description: null,
      });
      expect(parsed.description).toBeNull();
    });

    it('deve rejeitar nome vazio ou em branco', () => {
      expect(() => createTeamSchema.parse({ name: '   ' })).toThrow();
    });

    it('deve rejeitar nome maior que 100 caracteres', () => {
      expect(() => createTeamSchema.parse({ name: 'a'.repeat(101) })).toThrow();
    });

    it('deve rejeitar descrição maior que 300 caracteres', () => {
      expect(() => createTeamSchema.parse({ name: 'Equipe', description: 'a'.repeat(301) })).toThrow();
    });
  });

  describe('Authoritative Member Validation & Anti-IDOR', () => {
    it('create Team com integrantes locais ativos deve ter sucesso', async () => {
      const mockDoc = { id: 'team-new-1', set: vi.fn().mockResolvedValue(undefined) };
      vi.spyOn((repo as any).teamsCol, 'doc').mockReturnValue(mockDoc);

      const mockMember1 = {
        exists: true,
        id: 'mem-alpha-1',
        data: () => ({ ministry_id: 'min-alpha', status: 'active', name: 'Alice' }),
      };
      const mockMember2 = {
        exists: true,
        id: 'mem-alpha-2',
        data: () => ({ ministry_id: 'min-alpha', status: 'active', name: 'Bob' }),
      };

      vi.spyOn((repo as any).membersCol, 'doc').mockImplementation(((id: any) => ({
        get: vi.fn().mockResolvedValue(id === 'mem-alpha-1' ? mockMember1 : mockMember2),
      })) as any);

      const created = await repo.createTeam('min-alpha', 'usr-admin', {
        name: 'Banda Principal',
        description: 'Vocal e instrumental',
        memberIds: ['mem-alpha-1', 'mem-alpha-2'],
      });

      expect(created.id).toBe('team-new-1');
      expect(created.ministry_id).toBe('min-alpha');
      expect(created.name).toBe('Banda Principal');
      expect(created.member_ids).toEqual(['mem-alpha-1', 'mem-alpha-2']);
      expect(mockDoc.set).toHaveBeenCalledTimes(1);
    });

    it('create Team com rota Alpha + integrante Beta deve ser rejeitado (FOREIGN_TEAM_MEMBER_REFERENCE = REJECTED)', async () => {
      const mockBetaMember = {
        exists: true,
        id: 'mem-beta-1',
        data: () => ({ ministry_id: 'min-beta', status: 'active', name: 'Carlos Beta' }),
      };

      vi.spyOn((repo as any).membersCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue(mockBetaMember),
      });

      await expect(
        repo.createTeam('min-alpha', 'usr-admin', {
          name: 'Equipe Infiltrada',
          memberIds: ['mem-beta-1'],
        })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          message: 'Um ou mais integrantes selecionados são inválidos ou não pertencem a este ministério.',
        })
      );
    });

    it('update Team com integrante estrangeiro deve ser rejeitado', async () => {
      // Mock existing team in min-alpha
      vi.spyOn((repo as any).teamsCol, 'doc').mockImplementation(((id: any) => ({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'team-alpha-1',
          data: () => ({
            id: 'team-alpha-1',
            ministry_id: 'min-alpha',
            name: 'Equipe Alpha',
            member_ids: ['mem-alpha-1'],
            created_at: new Date().toISOString(),
          }),
        }),
        update: vi.fn(),
      })) as any);

      // Foreign member
      vi.spyOn((repo as any).membersCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'mem-beta-1',
          data: () => ({ ministry_id: 'min-beta', status: 'active' }),
        }),
      });

      await expect(
        repo.updateTeam('team-alpha-1', 'min-alpha', {
          memberIds: ['mem-beta-1'],
        })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          message: 'Um ou mais integrantes selecionados são inválidos ou não pertencem a este ministério.',
        })
      );
    });

    it('payload misto com IDs locais + estrangeiros deve rejeitar a mutação inteira atomicamente', async () => {
      const mockDoc = { id: 'team-new-1', set: vi.fn() };
      vi.spyOn((repo as any).teamsCol, 'doc').mockReturnValue(mockDoc);

      vi.spyOn((repo as any).membersCol, 'doc').mockImplementation(((id: any) => ({
        get: vi.fn().mockResolvedValue(
          id === 'mem-alpha-1'
            ? { exists: true, id: 'mem-alpha-1', data: () => ({ ministry_id: 'min-alpha', status: 'active' }) }
            : { exists: true, id: 'mem-beta-1', data: () => ({ ministry_id: 'min-beta', status: 'active' }) }
        ),
      })) as any);

      await expect(
        repo.createTeam('min-alpha', 'usr-admin', {
          name: 'Equipe Mista',
          memberIds: ['mem-alpha-1', 'mem-beta-1'],
        })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          message: 'Um ou mais integrantes selecionados são inválidos ou não pertencem a este ministério.',
        })
      );

      // Verify no write was executed
      expect(mockDoc.set).not.toHaveBeenCalled();
    });

    it('integrante com status "removed" submetido em nova mutação deve ser rejeitado', async () => {
      vi.spyOn((repo as any).membersCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'mem-alpha-removed',
          data: () => ({ ministry_id: 'min-alpha', status: 'removed', name: 'Ex-Membro' }),
        }),
      });

      await expect(
        repo.createTeam('min-alpha', 'usr-admin', {
          name: 'Equipe com Removido',
          memberIds: ['mem-alpha-removed'],
        })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          message: 'Um ou mais integrantes selecionados são inválidos ou não pertencem a este ministério.',
        })
      );
    });

    it('IDs duplicados no payload devem ser canonicalizados com unicidade determinística (TEAM_MEMBER_IDS_UNIQUE = PASS)', async () => {
      const mockDoc = { id: 'team-new-2', set: vi.fn().mockResolvedValue(undefined) };
      vi.spyOn((repo as any).teamsCol, 'doc').mockReturnValue(mockDoc);

      vi.spyOn((repo as any).membersCol, 'doc').mockImplementation(((id: any) => ({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id,
          data: () => ({ ministry_id: 'min-alpha', status: 'active' }),
        }),
      })) as any);

      const created = await repo.createTeam('min-alpha', 'usr-admin', {
        name: 'Equipe com Duplicados no Payload',
        memberIds: ['mem-1', 'mem-2', 'mem-1', 'mem-2', 'mem-3'],
      });

      expect(created.member_ids).toEqual(['mem-1', 'mem-2', 'mem-3']);
      expect(mockDoc.set).toHaveBeenCalledWith(
        expect.objectContaining({
          member_ids: ['mem-1', 'mem-2', 'mem-3'],
        })
      );
    });
  });

  describe('Non-Enumerating Foreign Team ID IDOR Guards', () => {
    it('Alpha route + Beta teamId GET → non-enumerating 404 (TEAM_EXISTENCE_ORACLE = CLOSED)', async () => {
      vi.spyOn((repo as any).teamsCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'team-beta-99',
          data: () => ({ ministry_id: 'min-beta', name: 'Beta Team' }),
        }),
      });

      await expect(repo.getTeamById('team-beta-99', 'min-alpha')).rejects.toThrow(
        expect.objectContaining({ statusCode: 404, message: 'Equipe não encontrada.' })
      );
    });

    it('Alpha route + Beta teamId UPDATE → non-enumerating 404', async () => {
      vi.spyOn((repo as any).teamsCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'team-beta-99',
          data: () => ({ ministry_id: 'min-beta', name: 'Beta Team' }),
        }),
        update: vi.fn(),
      });

      await expect(repo.updateTeam('team-beta-99', 'min-alpha', { name: 'New Name' })).rejects.toThrow(
        expect.objectContaining({ statusCode: 404, message: 'Equipe não encontrada.' })
      );
    });

    it('Alpha route + Beta teamId DELETE → non-enumerating 404', async () => {
      vi.spyOn((repo as any).teamsCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'team-beta-99',
          data: () => ({ ministry_id: 'min-beta', name: 'Beta Team' }),
        }),
        delete: vi.fn(),
      });

      await expect(repo.deleteTeam('team-beta-99', 'min-alpha')).rejects.toThrow(
        expect.objectContaining({ statusCode: 404, message: 'Equipe não encontrada.' })
      );
    });
  });

  describe('Delete Semantics (No Cascade)', () => {
    it('deve excluir o documento da equipe sem cascata', async () => {
      const mockDelete = vi.fn().mockResolvedValue(undefined);
      vi.spyOn((repo as any).teamsCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'team-alpha-1',
          data: () => ({ ministry_id: 'min-alpha', name: 'Equipe Alpha' }),
        }),
        delete: mockDelete,
      });

      await repo.deleteTeam('team-alpha-1', 'min-alpha');
      expect(mockDelete).toHaveBeenCalledTimes(1);
    });
  });
});

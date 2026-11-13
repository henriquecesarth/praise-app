import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import { describe, expect, it, vi } from 'vitest';
import { ClassificationController } from '../classifications/classification.controller';
import { RoleController } from '../roles/role.controller';
import { TeamController } from '../teams/team.controller';
import { TemplateController } from '../templates/template.controller';
import { MinistryController } from './ministry.controller';

async function withServer(
  app: express.Express,
  fn: (baseUrl: string) => Promise<void>
): Promise<void> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('M04: groupId alias compatibility across active controllers', () => {
  it('routes /api/v1/groups/:groupId/{classifications,schedule-templates,roles,teams} forward req.params.groupId', async () => {
    const mockClassificationService = {
      getClassifications: vi.fn().mockResolvedValue([]),
      getClassificationById: vi.fn().mockResolvedValue({ id: 'cls-1' }),
      createClassification: vi.fn().mockResolvedValue({ id: 'cls-1' }),
      updateClassification: vi.fn().mockResolvedValue({ id: 'cls-1' }),
      deleteClassification: vi.fn().mockResolvedValue(undefined),
    };
    const mockTemplateService = {
      getTemplates: vi.fn().mockResolvedValue([]),
      getTemplateById: vi.fn().mockResolvedValue({ id: 'tpl-1' }),
      createTemplate: vi.fn().mockResolvedValue({ id: 'tpl-1' }),
      updateTemplate: vi.fn().mockResolvedValue({ id: 'tpl-1' }),
      deleteTemplate: vi.fn().mockResolvedValue(undefined),
    };
    const mockRoleService = {
      getRoles: vi.fn().mockResolvedValue([]),
      getRoleById: vi.fn().mockResolvedValue({ id: 'role-1' }),
      createRole: vi.fn().mockResolvedValue({ id: 'role-1' }),
      updateRole: vi.fn().mockResolvedValue({ id: 'role-1' }),
      deleteRole: vi.fn().mockResolvedValue(undefined),
    };
    const mockTeamService = {
      getTeams: vi.fn().mockResolvedValue([]),
      getTeamById: vi.fn().mockResolvedValue({ id: 'team-1' }),
      createTeam: vi.fn().mockResolvedValue({ id: 'team-1' }),
      updateTeam: vi.fn().mockResolvedValue({ id: 'team-1' }),
      deleteTeam: vi.fn().mockResolvedValue(undefined),
    };

    const classCtrl = new ClassificationController(mockClassificationService as any);
    const tplCtrl = new TemplateController(mockTemplateService as any);
    const roleCtrl = new RoleController(mockRoleService as any);
    const teamCtrl = new TeamController(mockTeamService as any);

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).user = { uid: 'user-1', email: 'u1@test.com' };
      next();
    });

    const classRouter = express.Router({ mergeParams: true });
    classRouter.get('/', classCtrl.getClassifications);
    app.use('/api/v1/groups/:groupId/classifications', classRouter);

    const tplRouter = express.Router({ mergeParams: true });
    tplRouter.get('/', tplCtrl.getTemplates);
    app.use('/api/v1/groups/:groupId/schedule-templates', tplRouter);

    const roleRouter = express.Router({ mergeParams: true });
    roleRouter.get('/', roleCtrl.getRoles);
    app.use('/api/v1/groups/:groupId/roles', roleRouter);

    const teamRouter = express.Router({ mergeParams: true });
    teamRouter.get('/', teamCtrl.getTeams);
    teamRouter.get('/:teamId', teamCtrl.getTeamById);
    app.use('/api/v1/groups/:groupId/teams', teamRouter);

    await withServer(app, async (baseUrl) => {
      const paths = [
        '/api/v1/groups/grp-alias-1/classifications',
        '/api/v1/groups/grp-alias-2/schedule-templates',
        '/api/v1/groups/grp-alias-3/roles',
        '/api/v1/groups/grp-alias-4/teams',
        '/api/v1/groups/grp-alias-5/teams/team-xyz',
      ];
      for (const path of paths) {
        const res = await fetch(`${baseUrl}${path}`);
        expect(res.status).toBe(200);
      }
    });

    expect(mockClassificationService.getClassifications).toHaveBeenCalledWith('grp-alias-1');
    expect(mockTemplateService.getTemplates).toHaveBeenCalledWith('grp-alias-2');
    expect(mockRoleService.getRoles).toHaveBeenCalledWith('grp-alias-3');
    expect(mockTeamService.getTeams).toHaveBeenCalledWith('grp-alias-4');
    expect(mockTeamService.getTeamById).toHaveBeenCalledWith('team-xyz', 'grp-alias-5');
  });

  it('forwards groupId fallback on write/delete handlers across Classification, Template, Role, Team, and Ministry controllers', async () => {
    const classService = {
      createClassification: vi.fn().mockResolvedValue({ id: 'c1' }),
      updateClassification: vi.fn().mockResolvedValue({ id: 'c1' }),
      deleteClassification: vi.fn().mockResolvedValue(undefined),
      getClassificationById: vi.fn().mockResolvedValue({ id: 'c1' }),
      getClassifications: vi.fn().mockResolvedValue([]),
    };
    const tplService = {
      createTemplate: vi.fn().mockResolvedValue({ id: 't1' }),
      updateTemplate: vi.fn().mockResolvedValue({ id: 't1' }),
      deleteTemplate: vi.fn().mockResolvedValue(undefined),
      getTemplateById: vi.fn().mockResolvedValue({ id: 't1' }),
      getTemplates: vi.fn().mockResolvedValue([]),
    };
    const roleService = {
      createRole: vi.fn().mockResolvedValue({ id: 'r1' }),
      updateRole: vi.fn().mockResolvedValue({ id: 'r1' }),
      deleteRole: vi.fn().mockResolvedValue(undefined),
      getRoleById: vi.fn().mockResolvedValue({ id: 'r1' }),
      getRoles: vi.fn().mockResolvedValue([]),
    };
    const teamService = {
      createTeam: vi.fn().mockResolvedValue({ id: 'tm1' }),
      updateTeam: vi.fn().mockResolvedValue({ id: 'tm1' }),
      deleteTeam: vi.fn().mockResolvedValue(undefined),
      getTeamById: vi.fn().mockResolvedValue({ id: 'tm1' }),
      getTeams: vi.fn().mockResolvedValue([]),
    };
    const minService = {
      updateMinistry: vi.fn().mockResolvedValue({ id: 'm1' }),
      deleteMinistry: vi.fn().mockResolvedValue(undefined),
      removeMember: vi.fn().mockResolvedValue(undefined),
      updateMemberDetails: vi.fn().mockResolvedValue({ id: 'u2' }),
      addMemberManually: vi.fn().mockResolvedValue({ id: 'u3' }),
      leaveMinistry: vi.fn().mockResolvedValue(undefined),
    };

    const classCtrl = new ClassificationController(classService as any);
    const tplCtrl = new TemplateController(tplService as any);
    const roleCtrl = new RoleController(roleService as any);
    const teamCtrl = new TeamController(teamService as any);
    const minCtrl = new MinistryController(minService as any);

    const makeRes = () => {
      const res: any = { statusCode: 200 };
      res.status = vi.fn().mockReturnValue(res);
      res.json = vi.fn().mockReturnValue(res);
      res.send = vi.fn().mockReturnValue(res);
      return res;
    };
    const next = vi.fn();

    await classCtrl.getClassificationById({ params: { groupId: 'g-1', classificationId: 'c1' } } as any, makeRes(), next);
    await classCtrl.createClassification({ params: { groupId: 'g-1' }, body: { name: 'Vocal' } } as any, makeRes(), next);
    await classCtrl.updateClassification({ params: { groupId: 'g-1', classificationId: 'c1' }, body: { name: 'A' } } as any, makeRes(), next);
    await classCtrl.deleteClassification({ params: { groupId: 'g-1', classificationId: 'c1' } } as any, makeRes(), next);

    await tplCtrl.getTemplateById({ params: { groupId: 'g-2', templateId: 't1' } } as any, makeRes(), next);
    await tplCtrl.createTemplate({ params: { groupId: 'g-2' }, body: { name: 'T' } } as any, makeRes(), next);
    await tplCtrl.updateTemplate({ params: { groupId: 'g-2', templateId: 't1' }, body: { name: 'T2' } } as any, makeRes(), next);
    await tplCtrl.deleteTemplate({ params: { groupId: 'g-2', templateId: 't1' } } as any, makeRes(), next);

    await roleCtrl.getRoleById({ params: { groupId: 'g-3', roleId: 'r1' } } as any, makeRes(), next);
    await roleCtrl.createRole({ params: { groupId: 'g-3' }, body: { name: 'R' } } as any, makeRes(), next);
    await roleCtrl.updateRole({ params: { groupId: 'g-3', roleId: 'r1' }, body: { name: 'R2' } } as any, makeRes(), next);
    await roleCtrl.deleteRole({ params: { groupId: 'g-3', roleId: 'r1' } } as any, makeRes(), next);

    await teamCtrl.createTeam({ params: { groupId: 'g-4' }, user: { id: 'u1' }, body: { name: 'TM' } } as any, makeRes(), next);
    await teamCtrl.updateTeam({ params: { groupId: 'g-4', teamId: 'tm1' }, user: { id: 'u1' }, body: { name: 'TM2' } } as any, makeRes(), next);
    await teamCtrl.deleteTeam({ params: { groupId: 'g-4', teamId: 'tm1' }, user: { id: 'u1' } } as any, makeRes(), next);

    await minCtrl.updateMinistry({ params: { groupId: 'g-5' }, user: { id: 'u1' }, body: { name: 'M' } } as any, makeRes(), next);
    await minCtrl.deleteMinistry({ params: { groupId: 'g-5' }, user: { id: 'u1' } } as any, makeRes(), next);
    await minCtrl.removeMember({ params: { groupId: 'g-5', memberId: 'u2' }, user: { id: 'u1' } } as any, makeRes(), next);
    await minCtrl.updateMemberRole({ params: { groupId: 'g-5', memberId: 'u2' }, user: { id: 'u1' }, body: { role: 'admin' } } as any, makeRes(), next);
    await minCtrl.addMemberManually({ params: { groupId: 'g-5' }, user: { id: 'u1' }, body: { email: 'a@b.com' } } as any, makeRes(), next);
    await minCtrl.leaveMinistry({ params: { groupId: 'g-5' }, user: { id: 'u1' } } as any, makeRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(classService.deleteClassification).toHaveBeenCalledWith('c1', 'g-1');
    expect(tplService.deleteTemplate).toHaveBeenCalledWith('t1', 'g-2');
    expect(roleService.deleteRole).toHaveBeenCalledWith('r1', 'g-3');
    expect(teamService.deleteTeam).toHaveBeenCalledWith('tm1', 'g-4');
    expect(minService.updateMinistry).toHaveBeenCalledWith('g-5', 'u1', { name: 'M' });
    expect(minService.deleteMinistry).toHaveBeenCalledWith('g-5', 'u1');
    expect(minService.removeMember).toHaveBeenCalledWith('g-5', 'u2', 'u1');
    expect(minService.updateMemberDetails).toHaveBeenCalledWith('g-5', 'u2', { role: 'admin' }, 'u1');
    expect(minService.addMemberManually).toHaveBeenCalledWith('g-5', { email: 'a@b.com' }, 'u1');
    expect(minService.leaveMinistry).toHaveBeenCalledWith('g-5', 'u1');
  });
});

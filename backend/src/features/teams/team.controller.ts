import { Response, NextFunction } from 'express';
import { BaseController } from '../../controllers/BaseController';
import { AuthenticatedRequest } from '../../middleware/auth';
import { TeamService } from './team.service';

export class TeamController extends BaseController {
  constructor(private readonly teamService: TeamService = new TeamService()) {
    super();
  }

  getTeams = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ministryId = req.params.ministryId as string;
      const teams = await this.teamService.getTeams(ministryId);
      this.handleSuccess(res, teams);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  getTeamById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { ministryId, teamId } = req.params;
      const team = await this.teamService.getTeamById(teamId as string, ministryId as string);
      this.handleSuccess(res, team);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  createTeam = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ministryId = req.params.ministryId as string;
      const userId = req.user!.id;
      const team = await this.teamService.createTeam(ministryId, userId, req.body);
      this.handleCreated(res, team);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  updateTeam = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ministryId = req.params.ministryId as string;
      const teamId = req.params.teamId as string;
      const team = await this.teamService.updateTeam(teamId, ministryId, req.body);
      this.handleSuccess(res, team);
    } catch (err) {
      this.handleError(err, res, next);
    }
  };

  deleteTeam = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ministryId = req.params.ministryId as string;
      const teamId = req.params.teamId as string;
      await this.teamService.deleteTeam(teamId, ministryId);
      this.handleSuccess(res, { message: 'Equipe excluída com sucesso.' });
    } catch (err) {
      this.handleError(err, res, next);
    }
  };
}

const instance = new TeamController();
export const getTeams = instance.getTeams;
export const getTeamById = instance.getTeamById;
export const createTeam = instance.createTeam;
export const updateTeam = instance.updateTeam;
export const deleteTeam = instance.deleteTeam;

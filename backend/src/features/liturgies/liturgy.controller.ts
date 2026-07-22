import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { LiturgyService } from './liturgy.service';

export async function listLiturgies(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const groupId = (req.params.groupId || req.params.ministryId) as string;
    const liturgies = await LiturgyService.listLiturgies(groupId);
    res.json(liturgies);
  } catch (err) {
    next(err);
  }
}

export async function getLiturgyById(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const groupId = (req.params.groupId || req.params.ministryId) as string;
    const liturgyId = req.params.liturgyId as string;
    const liturgy = await LiturgyService.getLiturgyById(groupId, liturgyId);
    res.json(liturgy);
  } catch (err) {
    next(err);
  }
}

export async function createLiturgy(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const groupId = (req.params.groupId || req.params.ministryId) as string;
    const userId = req.user!.id;
    const liturgy = await LiturgyService.createLiturgy(groupId, userId, req.body);
    res.status(201).json(liturgy);
  } catch (err) {
    next(err);
  }
}

export async function updateLiturgy(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const groupId = (req.params.groupId || req.params.ministryId) as string;
    const liturgyId = req.params.liturgyId as string;
    const liturgy = await LiturgyService.updateLiturgy(groupId, liturgyId, req.body);
    res.json(liturgy);
  } catch (err) {
    next(err);
  }
}

export async function deleteLiturgy(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const groupId = (req.params.groupId || req.params.ministryId) as string;
    const liturgyId = req.params.liturgyId as string;
    const result = await LiturgyService.deleteLiturgy(groupId, liturgyId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

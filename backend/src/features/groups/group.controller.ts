import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { GroupService } from './group.service';

export async function getUserGroups(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;
    const groups = await GroupService.getUserGroups(userId);
    res.json(groups);
  } catch (err) {
    next(err);
  }
}

export async function getGroupById(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;
    const groupId = req.params.groupId as string;
    const group = await GroupService.getGroupById(groupId, userId);
    res.json(group);
  } catch (err) {
    next(err);
  }
}

export async function createGroup(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;
    const group = await GroupService.createGroup(userId, req.body);
    res.status(201).json(group);
  } catch (err) {
    next(err);
  }
}

export async function createInviteCode(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;
    const groupId = req.params.groupId as string;
    const invite = await GroupService.createInviteCode(groupId, userId, req.body);
    res.status(201).json(invite);
  } catch (err) {
    next(err);
  }
}

export async function joinGroupByCode(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;
    const result = await GroupService.joinGroupByCode(userId, req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getGroupMembers(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const groupId = req.params.groupId as string;
    const members = await GroupService.getGroupMembers(groupId);
    res.json(members);
  } catch (err) {
    next(err);
  }
}

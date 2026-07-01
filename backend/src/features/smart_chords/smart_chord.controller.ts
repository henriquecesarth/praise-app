import { Request, Response, NextFunction } from 'express';
import * as smartChordService from './smart_chord.service';
import {
  createSmartChordSchema,
  updateSmartChordSchema,
  smartChordsQuerySchema,
} from './smart_chord.types';

// Helper to extract x-user-id header with a fallback dev user
function getUserId(req: Request): string {
  const userId = req.headers['x-user-id'];
  if (!userId) {
    // Default development user fallback
    return 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
  }
  return String(userId);
}

export async function listSmartChords(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getUserId(req);
    const query = smartChordsQuerySchema.parse(req.query);

    const result = await smartChordService.getSmartChords(userId, {
      search: query.search,
      page: query.page ? parseInt(query.page) : undefined,
      limit: query.limit ? parseInt(query.limit) : undefined,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function getSmartChord(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getUserId(req);
    const { id } = req.params;

    const result = await smartChordService.getSmartChordById(id, userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function createSmartChord(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getUserId(req);
    const body = createSmartChordSchema.parse(req.body);

    const result = await smartChordService.createSmartChord(userId, body);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function updateSmartChord(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getUserId(req);
    const { id } = req.params;
    const body = updateSmartChordSchema.parse(req.body);

    const result = await smartChordService.updateSmartChord(id, userId, body);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function deleteSmartChord(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getUserId(req);
    const { id } = req.params;

    await smartChordService.deleteSmartChord(id, userId);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

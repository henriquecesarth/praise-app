import { Request, Response, NextFunction } from 'express';
import { BaseController } from '../../controllers/BaseController';
import { AppError } from '../../middleware/error-handler';
import * as service from './repertoire.service';

function getUserId(req: Request): string {
  const anyReq = req as any;
  if (!anyReq.user?.id) {
    throw new AppError(401, 'Usuário não autenticado.');
  }
  return anyReq.user.id;
}

function getTargetGroupId(req: Request): string {
  const params = req.params as Record<string, string>;
  const groupId = params.groupId || params.ministryId;
  if (!groupId || groupId === 'undefined') {
    throw new AppError(400, 'ID do grupo não informado.');
  }
  return groupId;
}

export class RepertoireController extends BaseController {
  listSongs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const groupId = getTargetGroupId(req);
      const userId = getUserId(req);
      const result = await service.getSongs(groupId, userId, req.query as any);
      this.handleSuccess(res, result);
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  getSong = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const groupId = getTargetGroupId(req);
      const { songId } = req.params as Record<string, string>;
      const userId = getUserId(req);
      const song = await service.getSongById(groupId, songId, userId);
      this.handleSuccess(res, { data: song });
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  createSong = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const groupId = getTargetGroupId(req);
      const userId = getUserId(req);
      const song = await service.createSong(groupId, userId, req.body);
      this.handleCreated(res, { data: song });
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  updateSong = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const groupId = getTargetGroupId(req);
      const { songId } = req.params as Record<string, string>;
      const userId = getUserId(req);
      const song = await service.updateSong(groupId, songId, userId, req.body);
      this.handleSuccess(res, { data: song });
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  deleteSong = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const groupId = getTargetGroupId(req);
      const { songId } = req.params as Record<string, string>;
      const userId = getUserId(req);
      await service.deleteSong(groupId, songId, userId);
      this.handleNoContent(res);
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  getCounts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const groupId = getTargetGroupId(req);
      const counts = await service.getCounts(groupId);
      this.handleSuccess(res, { data: counts });
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  listArtists = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const groupId = getTargetGroupId(req);
      const { search } = req.query as { search?: string };
      const artists = await service.getArtists(groupId, search);
      this.handleSuccess(res, { data: artists });
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  createArtist = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const groupId = getTargetGroupId(req);
      const { name } = req.body;
      const artist = await service.createArtist(groupId, name);
      this.handleCreated(res, { data: artist });
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  updateArtist = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const groupId = getTargetGroupId(req);
      const { artistId } = req.params as Record<string, string>;
      const { name } = req.body;
      const artist = await service.updateArtist(groupId, artistId, name);
      this.handleSuccess(res, { data: artist });
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  deleteArtist = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const groupId = getTargetGroupId(req);
      const { artistId } = req.params as Record<string, string>;
      await service.deleteArtist(groupId, artistId);
      this.handleNoContent(res);
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  listClassifications = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const groupId = getTargetGroupId(req);
      const classifications = await service.getClassifications(groupId);
      this.handleSuccess(res, { data: classifications });
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  createClassification = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const groupId = getTargetGroupId(req);
      const classification = await service.createClassification(groupId, req.body);
      this.handleCreated(res, { data: classification });
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  updateClassification = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const groupId = getTargetGroupId(req);
      const { classificationId } = req.params as Record<string, string>;
      const classification = await service.updateClassification(groupId, classificationId, req.body);
      this.handleSuccess(res, { data: classification });
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  deleteClassification = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const groupId = getTargetGroupId(req);
      const { classificationId } = req.params as Record<string, string>;
      await service.deleteClassification(groupId, classificationId);
      this.handleNoContent(res);
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  listFolders = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const groupId = getTargetGroupId(req);
      const folders = await service.getFolders(groupId);
      this.handleSuccess(res, { data: folders });
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  getFolder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const groupId = getTargetGroupId(req);
      const { folderId } = req.params as Record<string, string>;
      const folder = await service.getFolderById(groupId, folderId);
      this.handleSuccess(res, { data: folder });
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  createFolder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const groupId = getTargetGroupId(req);
      const { name, description } = req.body;
      const folder = await service.createFolder(groupId, name, description);
      this.handleCreated(res, { data: folder });
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  updateFolder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const groupId = getTargetGroupId(req);
      const { folderId } = req.params as Record<string, string>;
      const folder = await service.updateFolder(groupId, folderId, req.body);
      this.handleSuccess(res, { data: folder });
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  deleteFolder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const groupId = getTargetGroupId(req);
      const { folderId } = req.params as Record<string, string>;
      await service.deleteFolder(groupId, folderId);
      this.handleNoContent(res);
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  addSongToFolder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const groupId = getTargetGroupId(req);
      const { folderId } = req.params as Record<string, string>;
      const { song_id } = req.body;
      await service.addSongToFolder(groupId, folderId, song_id);
      this.handleCreated(res, { message: 'Música adicionada à pasta com sucesso.' });
    } catch (error) {
      this.handleError(error, res, next);
    }
  };

  removeSongFromFolder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const groupId = getTargetGroupId(req);
      const { folderId, songId } = req.params as Record<string, string>;
      await service.removeSongFromFolder(groupId, folderId, songId);
      this.handleNoContent(res);
    } catch (error) {
      this.handleError(error, res, next);
    }
  };
}

const repInstance = new RepertoireController();

export const listSongs = repInstance.listSongs;
export const getSong = repInstance.getSong;
export const createSong = repInstance.createSong;
export const updateSong = repInstance.updateSong;
export const deleteSong = repInstance.deleteSong;
export const getCounts = repInstance.getCounts;
export const listArtists = repInstance.listArtists;
export const createArtist = repInstance.createArtist;
export const updateArtist = repInstance.updateArtist;
export const deleteArtist = repInstance.deleteArtist;
export const listClassifications = repInstance.listClassifications;
export const createClassification = repInstance.createClassification;
export const updateClassification = repInstance.updateClassification;
export const deleteClassification = repInstance.deleteClassification;
export const listFolders = repInstance.listFolders;
export const getFolder = repInstance.getFolder;
export const createFolder = repInstance.createFolder;
export const updateFolder = repInstance.updateFolder;
export const deleteFolder = repInstance.deleteFolder;
export const addSongToFolder = repInstance.addSongToFolder;
export const removeSongFromFolder = repInstance.removeSongFromFolder;

import { Request, Response, NextFunction } from 'express';
import * as service from './repertoire.service';

// ============================================================
// SONGS
// ============================================================

export async function listSongs(req: Request, res: Response, next: NextFunction) {
  try {
    const { ministryId } = req.params;
    const result = await service.getSongs(ministryId, req.query as any);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function getSong(req: Request, res: Response, next: NextFunction) {
  try {
    const { ministryId, songId } = req.params;
    const song = await service.getSongById(ministryId, songId);
    res.json({ data: song });
  } catch (error) {
    next(error);
  }
}

export async function createSong(req: Request, res: Response, next: NextFunction) {
  try {
    const { ministryId } = req.params;
    const song = await service.createSong(ministryId, req.body);
    res.status(201).json({ data: song });
  } catch (error) {
    next(error);
  }
}

export async function updateSong(req: Request, res: Response, next: NextFunction) {
  try {
    const { ministryId, songId } = req.params;
    const song = await service.updateSong(ministryId, songId, req.body);
    res.json({ data: song });
  } catch (error) {
    next(error);
  }
}

export async function deleteSong(req: Request, res: Response, next: NextFunction) {
  try {
    const { ministryId, songId } = req.params;
    await service.deleteSong(ministryId, songId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

// ============================================================
// ARTISTS
// ============================================================

export async function listArtists(req: Request, res: Response, next: NextFunction) {
  try {
    const { ministryId } = req.params;
    const search = req.query.search as string | undefined;
    const artists = await service.getArtists(ministryId, search);
    res.json({ data: artists });
  } catch (error) {
    next(error);
  }
}

export async function createArtist(req: Request, res: Response, next: NextFunction) {
  try {
    const { ministryId } = req.params;
    const artist = await service.createArtist(ministryId, req.body);
    res.status(201).json({ data: artist });
  } catch (error) {
    next(error);
  }
}

export async function updateArtist(req: Request, res: Response, next: NextFunction) {
  try {
    const { ministryId, artistId } = req.params;
    const artist = await service.updateArtist(ministryId, artistId, req.body);
    res.json({ data: artist });
  } catch (error) {
    next(error);
  }
}

export async function deleteArtist(req: Request, res: Response, next: NextFunction) {
  try {
    const { ministryId, artistId } = req.params;
    await service.deleteArtist(ministryId, artistId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

// ============================================================
// CLASSIFICATIONS
// ============================================================

export async function listClassifications(req: Request, res: Response, next: NextFunction) {
  try {
    const { ministryId } = req.params;
    const classifications = await service.getClassifications(ministryId);
    res.json({ data: classifications });
  } catch (error) {
    next(error);
  }
}

export async function createClassification(req: Request, res: Response, next: NextFunction) {
  try {
    const { ministryId } = req.params;
    const classification = await service.createClassification(ministryId, req.body);
    res.status(201).json({ data: classification });
  } catch (error) {
    next(error);
  }
}

export async function updateClassification(req: Request, res: Response, next: NextFunction) {
  try {
    const { ministryId, classificationId } = req.params;
    const classification = await service.updateClassification(ministryId, classificationId, req.body);
    res.json({ data: classification });
  } catch (error) {
    next(error);
  }
}

export async function deleteClassification(req: Request, res: Response, next: NextFunction) {
  try {
    const { ministryId, classificationId } = req.params;
    await service.deleteClassification(ministryId, classificationId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

// ============================================================
// FOLDERS
// ============================================================

export async function listFolders(req: Request, res: Response, next: NextFunction) {
  try {
    const { ministryId } = req.params;
    const folders = await service.getFolders(ministryId);
    res.json({ data: folders });
  } catch (error) {
    next(error);
  }
}

export async function getFolder(req: Request, res: Response, next: NextFunction) {
  try {
    const { ministryId, folderId } = req.params;
    const folder = await service.getFolderById(ministryId, folderId);
    res.json({ data: folder });
  } catch (error) {
    next(error);
  }
}

export async function createFolder(req: Request, res: Response, next: NextFunction) {
  try {
    const { ministryId } = req.params;
    const folder = await service.createFolder(ministryId, req.body);
    res.status(201).json({ data: folder });
  } catch (error) {
    next(error);
  }
}

export async function updateFolder(req: Request, res: Response, next: NextFunction) {
  try {
    const { ministryId, folderId } = req.params;
    const folder = await service.updateFolder(ministryId, folderId, req.body);
    res.json({ data: folder });
  } catch (error) {
    next(error);
  }
}

export async function deleteFolder(req: Request, res: Response, next: NextFunction) {
  try {
    const { ministryId, folderId } = req.params;
    await service.deleteFolder(ministryId, folderId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function addSongToFolder(req: Request, res: Response, next: NextFunction) {
  try {
    const { folderId } = req.params;
    const { song_id, position } = req.body;
    await service.addSongToFolder(folderId, song_id, position);
    res.status(201).json({ message: 'Música adicionada à pasta.' });
  } catch (error) {
    next(error);
  }
}

export async function removeSongFromFolder(req: Request, res: Response, next: NextFunction) {
  try {
    const { folderId, songId } = req.params;
    await service.removeSongFromFolder(folderId, songId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

// ============================================================
// COUNTS
// ============================================================

export async function getCounts(req: Request, res: Response, next: NextFunction) {
  try {
    const { ministryId } = req.params;
    const counts = await service.getRepertoireCounts(ministryId);
    res.json({ data: counts });
  } catch (error) {
    next(error);
  }
}

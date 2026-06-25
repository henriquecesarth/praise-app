import { Router } from 'express';
import * as controller from './repertoire.controller';
import { validate } from '../../middleware/validate';
import {
  createSongSchema,
  updateSongSchema,
  createArtistSchema,
  updateArtistSchema,
  createFolderSchema,
  updateFolderSchema,
  addSongToFolderSchema,
  createClassificationSchema,
  updateClassificationSchema,
  songsQuerySchema,
} from './repertoire.types';

const router = Router({ mergeParams: true });

// ─── Counts ──────────────────────────────────────────────────
router.get('/counts', controller.getCounts);

// ─── Songs ───────────────────────────────────────────────────
router.get('/songs', validate(songsQuerySchema, 'query'), controller.listSongs);
router.get('/songs/:songId', controller.getSong);
router.post('/songs', validate(createSongSchema), controller.createSong);
router.put('/songs/:songId', validate(updateSongSchema), controller.updateSong);
router.delete('/songs/:songId', controller.deleteSong);

// ─── Artists ─────────────────────────────────────────────────
router.get('/artists', controller.listArtists);
router.post('/artists', validate(createArtistSchema), controller.createArtist);
router.put('/artists/:artistId', validate(updateArtistSchema), controller.updateArtist);
router.delete('/artists/:artistId', controller.deleteArtist);

// ─── Classifications ────────────────────────────────────────
router.get('/classifications', controller.listClassifications);
router.post('/classifications', validate(createClassificationSchema), controller.createClassification);
router.put('/classifications/:classificationId', validate(updateClassificationSchema), controller.updateClassification);
router.delete('/classifications/:classificationId', controller.deleteClassification);

// ─── Folders ─────────────────────────────────────────────────
router.get('/folders', controller.listFolders);
router.get('/folders/:folderId', controller.getFolder);
router.post('/folders', validate(createFolderSchema), controller.createFolder);
router.put('/folders/:folderId', validate(updateFolderSchema), controller.updateFolder);
router.delete('/folders/:folderId', controller.deleteFolder);
router.post('/folders/:folderId/songs', validate(addSongToFolderSchema), controller.addSongToFolder);
router.delete('/folders/:folderId/songs/:songId', controller.removeSongFromFolder);

export default router;

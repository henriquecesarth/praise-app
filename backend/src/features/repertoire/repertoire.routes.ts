import { Router } from 'express';
import * as controller from './repertoire.controller';
import { validate } from '../../middleware/validate';
import { authenticate } from '../../middleware/auth';
import { requireGroupRole, requireActiveSubscription } from '../../middleware/rbac';
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

// Aplicar autenticação em todas as rotas do repertório
router.use(authenticate);

// ─── Counts ──────────────────────────────────────────────────
router.get('/counts', requireGroupRole('member'), controller.getCounts);

// ─── Songs ───────────────────────────────────────────────────
router.get('/songs', requireGroupRole('member'), validate(songsQuerySchema, 'query'), controller.listSongs);
router.get('/songs/:songId', requireGroupRole('member'), controller.getSong);
router.post('/songs', requireGroupRole('admin'), requireActiveSubscription, validate(createSongSchema), controller.createSong);
router.put('/songs/:songId', requireGroupRole('admin'), requireActiveSubscription, validate(updateSongSchema), controller.updateSong);
router.delete('/songs/:songId', requireGroupRole('admin'), requireActiveSubscription, controller.deleteSong);

// ─── Artists ─────────────────────────────────────────────────
router.get('/artists', requireGroupRole('member'), controller.listArtists);
router.post('/artists', requireGroupRole('admin'), requireActiveSubscription, validate(createArtistSchema), controller.createArtist);
router.put('/artists/:artistId', requireGroupRole('admin'), requireActiveSubscription, validate(updateArtistSchema), controller.updateArtist);
router.delete('/artists/:artistId', requireGroupRole('admin'), requireActiveSubscription, controller.deleteArtist);

// ─── Classifications ────────────────────────────────────────
router.get('/classifications', requireGroupRole('member'), controller.listClassifications);
router.post('/classifications', requireGroupRole('admin'), requireActiveSubscription, validate(createClassificationSchema), controller.createClassification);
router.put('/classifications/:classificationId', requireGroupRole('admin'), requireActiveSubscription, validate(updateClassificationSchema), controller.updateClassification);
router.delete('/classifications/:classificationId', requireGroupRole('admin'), requireActiveSubscription, controller.deleteClassification);

// ─── Folders ─────────────────────────────────────────────────
router.get('/folders', requireGroupRole('member'), controller.listFolders);
router.get('/folders/:folderId', requireGroupRole('member'), controller.getFolder);
router.post('/folders', requireGroupRole('admin'), requireActiveSubscription, validate(createFolderSchema), controller.createFolder);
router.put('/folders/:folderId', requireGroupRole('admin'), requireActiveSubscription, validate(updateFolderSchema), controller.updateFolder);
router.delete('/folders/:folderId', requireGroupRole('admin'), requireActiveSubscription, controller.deleteFolder);
router.post('/folders/:folderId/songs', requireGroupRole('admin'), requireActiveSubscription, validate(addSongToFolderSchema), controller.addSongToFolder);
router.delete('/folders/:folderId/songs/:songId', requireGroupRole('admin'), requireActiveSubscription, controller.removeSongFromFolder);

export default router;

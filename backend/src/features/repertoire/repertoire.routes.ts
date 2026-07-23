import { Router } from 'express';
import * as controller from './repertoire.controller';
import { validate } from '../../middleware/validate';
import { authenticate } from '../../middleware/auth';
import { requireMinistryRole, requireActiveSubscription } from '../../middleware/rbac';
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
router.get('/counts', requireMinistryRole('member'), controller.getCounts);

// ─── Songs ───────────────────────────────────────────────────
router.get('/songs', requireMinistryRole('member'), validate(songsQuerySchema, 'query'), controller.listSongs);
router.get('/songs/:songId', requireMinistryRole('member'), controller.getSong);
router.post('/songs', requireMinistryRole('admin'), requireActiveSubscription, validate(createSongSchema), controller.createSong);
router.put('/songs/:songId', requireMinistryRole('admin'), requireActiveSubscription, validate(updateSongSchema), controller.updateSong);
router.delete('/songs/:songId', requireMinistryRole('admin'), requireActiveSubscription, controller.deleteSong);

// ─── Artists ─────────────────────────────────────────────────
router.get('/artists', requireMinistryRole('member'), controller.listArtists);
router.post('/artists', requireMinistryRole('admin'), requireActiveSubscription, validate(createArtistSchema), controller.createArtist);
router.put('/artists/:artistId', requireMinistryRole('admin'), requireActiveSubscription, validate(updateArtistSchema), controller.updateArtist);
router.delete('/artists/:artistId', requireMinistryRole('admin'), requireActiveSubscription, controller.deleteArtist);

// ─── Classifications ────────────────────────────────────────
router.get('/classifications', requireMinistryRole('member'), controller.listClassifications);
router.post('/classifications', requireMinistryRole('admin'), requireActiveSubscription, validate(createClassificationSchema), controller.createClassification);
router.put('/classifications/:classificationId', requireMinistryRole('admin'), requireActiveSubscription, validate(updateClassificationSchema), controller.updateClassification);
router.delete('/classifications/:classificationId', requireMinistryRole('admin'), requireActiveSubscription, controller.deleteClassification);

// ─── Folders ─────────────────────────────────────────────────
router.get('/folders', requireMinistryRole('member'), controller.listFolders);
router.get('/folders/:folderId', requireMinistryRole('member'), controller.getFolder);
router.post('/folders', requireMinistryRole('admin'), requireActiveSubscription, validate(createFolderSchema), controller.createFolder);
router.put('/folders/:folderId', requireMinistryRole('admin'), requireActiveSubscription, validate(updateFolderSchema), controller.updateFolder);
router.delete('/folders/:folderId', requireMinistryRole('admin'), requireActiveSubscription, controller.deleteFolder);
router.post('/folders/:folderId/songs', requireMinistryRole('admin'), requireActiveSubscription, validate(addSongToFolderSchema), controller.addSongToFolder);
router.delete('/folders/:folderId/songs/:songId', requireMinistryRole('admin'), requireActiveSubscription, controller.removeSongFromFolder);

export default router;

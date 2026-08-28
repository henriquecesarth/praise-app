import { Router } from 'express';
import * as controller from './repertoire.controller';
import { validate } from '../../middleware/validate';
import { authenticate } from '../../middleware/auth';
import { requireMinistryRole } from '../../middleware/rbac';
import { enforceOperationalAccess } from '../../middleware/quota-enforcement';
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
router.post('/songs', requireMinistryRole('admin'), enforceOperationalAccess, validate(createSongSchema), controller.createSong);
router.put('/songs/:songId', requireMinistryRole('admin'), enforceOperationalAccess, validate(updateSongSchema), controller.updateSong);
router.delete('/songs/:songId', requireMinistryRole('admin'), enforceOperationalAccess.remediation, controller.deleteSong);

// ─── Artists ─────────────────────────────────────────────────
router.get('/artists', requireMinistryRole('member'), controller.listArtists);
router.post('/artists', requireMinistryRole('admin'), enforceOperationalAccess, validate(createArtistSchema), controller.createArtist);
router.put('/artists/:artistId', requireMinistryRole('admin'), enforceOperationalAccess, validate(updateArtistSchema), controller.updateArtist);
router.delete('/artists/:artistId', requireMinistryRole('admin'), enforceOperationalAccess, controller.deleteArtist);

// ─── Classifications ────────────────────────────────────────
router.get('/classifications', requireMinistryRole('member'), controller.listClassifications);
router.post('/classifications', requireMinistryRole('admin'), enforceOperationalAccess, validate(createClassificationSchema), controller.createClassification);
router.put('/classifications/:classificationId', requireMinistryRole('admin'), enforceOperationalAccess, validate(updateClassificationSchema), controller.updateClassification);
router.delete('/classifications/:classificationId', requireMinistryRole('admin'), enforceOperationalAccess, controller.deleteClassification);

// ─── Folders ─────────────────────────────────────────────────
router.get('/folders', requireMinistryRole('member'), controller.listFolders);
router.get('/folders/:folderId', requireMinistryRole('member'), controller.getFolder);
router.post('/folders', requireMinistryRole('admin'), enforceOperationalAccess, validate(createFolderSchema), controller.createFolder);
router.put('/folders/:folderId', requireMinistryRole('admin'), enforceOperationalAccess, validate(updateFolderSchema), controller.updateFolder);
router.delete('/folders/:folderId', requireMinistryRole('admin'), enforceOperationalAccess, controller.deleteFolder);
router.post('/folders/:folderId/songs', requireMinistryRole('admin'), enforceOperationalAccess, validate(addSongToFolderSchema), controller.addSongToFolder);
router.delete('/folders/:folderId/songs/:songId', requireMinistryRole('admin'), enforceOperationalAccess, controller.removeSongFromFolder);

export default router;

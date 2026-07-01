import { Router } from 'express';
import * as smartChordController from './smart_chord.controller';

const router = Router();

router.get('/', smartChordController.listSmartChords);
router.get('/:id', smartChordController.getSmartChord);
router.post('/', smartChordController.createSmartChord);
router.put('/:id', smartChordController.updateSmartChord);
router.delete('/:id', smartChordController.deleteSmartChord);

export default router;

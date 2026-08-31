import { Router } from 'express';
import * as smartChordController from './smart_chord.controller';
import { authenticate } from '../../middleware/auth';

const router = Router();

// Todas as rotas de cifras inteligentes requerem autenticação
router.use(authenticate);

router.get('/', smartChordController.listSmartChords);
router.get('/:id', smartChordController.getSmartChord);
router.post('/', smartChordController.createSmartChord);
router.put('/:id', smartChordController.updateSmartChord);
router.delete('/:id', smartChordController.deleteSmartChord);

export default router;


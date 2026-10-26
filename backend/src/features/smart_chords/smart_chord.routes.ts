import { Router } from 'express';
import express from 'express';
import multer from 'multer';
import * as smartChordController from './smart_chord.controller';
import { authenticate } from '../../middleware/auth';
import { AppError } from '../../middleware/error-handler';

const router = Router();

// Todas as rotas de cifras inteligentes requerem autenticação
router.use(authenticate);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 3 * 1024 * 1024, // 3 MiB
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new AppError(400, 'Formato inválido. Apenas arquivos PDF são aceitos.'));
    }
  },
});

const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MiB
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.originalname.match(/\.(png|jpe?g|webp)$/i)) {
      cb(null, true);
    } else {
      cb(new AppError(400, 'Formato inválido. Apenas imagens (PNG, JPEG, WEBP) são aceitas.'));
    }
  },
});

router.post(
  '/import/pdf',
  express.raw({ type: 'application/pdf', limit: '3mb' }),
  (req, res, next) => {
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('multipart/form-data')) {
      return upload.single('file')(req, res, (err) => {
        if (err) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return next(new AppError(400, 'Arquivo PDF excede o limite máximo permitido de 3 MB.'));
          }
          return next(err);
        }
        smartChordController.importPdfDraft(req, res, next);
      });
    }
    smartChordController.importPdfDraft(req, res, next);
  }
);

router.post('/import/text', smartChordController.importTextDraft);

router.post('/import/url', smartChordController.importUrlDraft);

const parseRawImage = express.raw({ type: 'image/*', limit: '5mb' });

router.post(
  '/import/image',
  (req, res, next) => {
    parseRawImage(req, res, (error) => {
      if (error && (error as any).type === 'entity.too.large') {
        return next(new AppError(400, 'Arquivo de imagem excede o limite máximo permitido de 5 MB.'));
      }
      if (error) return next(error);
      next();
    });
  },
  (req, res, next) => {
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('multipart/form-data')) {
      return uploadImage.single('file')(req, res, (err) => {
        if (err) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return next(new AppError(400, 'Arquivo de imagem excede o limite máximo permitido de 5 MB.'));
          }
          return next(err);
        }
        smartChordController.importImageDraft(req, res, next);
      });
    }
    smartChordController.importImageDraft(req, res, next);
  }
);

router.get('/', smartChordController.listSmartChords);
router.get('/song/:songId', smartChordController.getSmartChordsBySong);
router.get('/:id', smartChordController.getSmartChord);
router.post('/', smartChordController.createSmartChord);
router.put('/:id', smartChordController.updateSmartChord);
router.delete('/:id', smartChordController.deleteSmartChord);

export default router;

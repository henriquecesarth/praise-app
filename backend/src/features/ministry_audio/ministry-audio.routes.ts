import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { MinistryAudioController } from './ministry-audio.controller';
import { MinistryAudioService } from './ministry-audio.service';
import type { StemStorage } from './storage';

export function createMinistryAudioRouter(options: {
  storage: StemStorage;
  now?: () => number;
  ticketSecret?: Buffer;
}): Router {
  const router = Router({ mergeParams: true });
  const controller = new MinistryAudioController(new MinistryAudioService(options.storage, options.now, options.ticketSecret));

  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  router.use(authenticate);
  router.get('/', controller.list);
  router.post('/uploads', controller.reserve);
  router.post('/uploads/cleanup', controller.cleanup);
  router.get('/uploads/:id', controller.uploadStatus);
  router.put('/uploads/:id/stems/:stemId', controller.upload);
  router.post('/uploads/:id/finalize', controller.finalize);
  router.patch('/:id', controller.edit);
  router.post('/:id/archive', controller.archive);
  router.get('/:id/playback', controller.playback);
  router.get('/:id/stems/:stemId', controller.download);
  return router;
}

export function ministryAudioSimulatorEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.MINISTRY_AUDIO_EMULATOR === '1' && env.LOUVAIO_LOCAL_EMULATORS === '1' &&
    env.NODE_ENV === 'test' && !env.VERCEL && !env.VERCEL_ENV &&
    /^demo-[a-z0-9-]+$/.test(env.FIREBASE_PROJECT_ID ?? '') &&
    /^127\.0\.0\.1:\d+$/.test(env.FIRESTORE_EMULATOR_HOST ?? '') &&
    /^127\.0\.0\.1:\d+$/.test(env.FIREBASE_AUTH_EMULATOR_HOST ?? '');
}

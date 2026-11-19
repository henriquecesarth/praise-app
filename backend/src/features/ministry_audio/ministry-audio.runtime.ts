import type { Express } from 'express';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DirectStemStorage } from './direct-storage';
import { createMinistryAudioRouter, ministryAudioSimulatorEnabled } from './ministry-audio.routes';
import { R2StemStorage } from './r2-storage';
import { getR2DevelopmentConfig } from './r2-development-config';
import { SimulatedDirectStemStorage, simulatedDirectObjectPath } from './simulated-direct-storage';
import { SimulatedStemStorage } from './storage';

export function configureMinistryAudio(app: Express, env: NodeJS.ProcessEnv) {
  if (!ministryAudioSimulatorEnabled(env)) return undefined;

  const simulatorEnabled = env.MINISTRY_AUDIO_DIRECT_SIMULATOR === '1';
  const r2Enabled = env.MINISTRY_AUDIO_R2_DEV === '1';
  if (simulatorEnabled && r2Enabled) throw new Error('Select one development audio storage provider.');

  let directStorage: DirectStemStorage | undefined;
  if (simulatorEnabled) {
    const origin = env.MINISTRY_AUDIO_DIRECT_SIMULATOR_ORIGIN;
    if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) {
      throw new Error('A loopback HTTP origin is required for simulated audio objects.');
    }
    const simulator = new SimulatedDirectStemStorage(origin);
    app.use(simulatedDirectObjectPath, simulator.router);
    directStorage = simulator;
  } else if (r2Enabled) {
    directStorage = new R2StemStorage(getR2DevelopmentConfig(env));
  }

  const directory = env.MINISTRY_AUDIO_SIMULATOR_DIR || join(tmpdir(), 'louvaio-ministry-audio', env.FIREBASE_PROJECT_ID ?? 'demo-louvaio');
  return createMinistryAudioRouter({ storage: new SimulatedStemStorage(directory), directStorage });
}

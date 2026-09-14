import { initializeApp, cert, getApps, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { getAuth, Auth } from 'firebase-admin/auth';
import { config } from '../config/unifiedConfig';

export function assertTestIsolationGuard(options?: {
  nodeEnv?: string;
  projectId?: string;
  emulatorHost?: string;
}): void {
  const nodeEnv = options?.nodeEnv ?? process.env.NODE_ENV;
  const projectId = options?.projectId ?? (config?.firebase?.projectId || process.env.FIREBASE_PROJECT_ID);
  const emulatorHost = (options && 'emulatorHost' in options) ? options.emulatorHost : process.env.FIRESTORE_EMULATOR_HOST;

  if (nodeEnv === 'test') {
    if (!emulatorHost || (typeof emulatorHost === 'string' && !emulatorHost.trim())) {
      throw new Error(
        `TEST_ISOLATION_ERROR: Automated tests must NEVER target live Firestore project (${projectId || 'unknown'}) without FIRESTORE_EMULATOR_HOST. Set FIRESTORE_EMULATOR_HOST or use isolated mocks.`
      );
    }
  }
}

// Enforce test isolation guard before any Firebase initialization
assertTestIsolationGuard();

let firebaseApp: App;

if (getApps().length === 0) {
  if (process.env.NODE_ENV === 'test') {
    // In test mode: never pass live service account credentials. Connect strictly via emulator.
    firebaseApp = initializeApp({
      projectId: config.firebase.projectId || 'praise-app-test',
    });
    console.log(`🧪 Firebase Admin SDK inicializado em modo de teste isolado (Emulator: ${process.env.FIRESTORE_EMULATOR_HOST}).`);
  } else if (
    config.firebase.projectId &&
    config.firebase.clientEmail &&
    config.firebase.privateKey
  ) {
    firebaseApp = initializeApp({
      credential: cert({
        projectId: config.firebase.projectId,
        clientEmail: config.firebase.clientEmail,
        privateKey: config.firebase.privateKey,
      }),
      databaseURL: config.firebase.databaseURL,
    });
    console.log('🔥 Firebase Admin SDK inicializado com sucesso via Service Account.');
  } else {
    console.warn(
      '⚠️ Credenciais do Firebase não encontradas no .env. Inicializando em modo dev local (praise-app-dev).'
    );
    firebaseApp = initializeApp({
      projectId: config.firebase.projectId || 'praise-app-dev',
    });
  }
} else {
  firebaseApp = getApps()[0];
}

export const db: Firestore = getFirestore(firebaseApp);
export const authAdmin: Auth = getAuth(firebaseApp);

try {
  db.settings({ ignoreUndefinedProperties: true });
} catch {
  // Ignorar erro se já configurado
}

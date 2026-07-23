import { initializeApp, cert, getApps, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { getAuth, Auth } from 'firebase-admin/auth';
import { config } from '../config/unifiedConfig';

let firebaseApp: App;

if (getApps().length === 0) {
  if (
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

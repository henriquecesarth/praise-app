import { verifyFirestoreEmulatorReachable } from './src/lib/firestore-emulator-preflight';

export default async function setupIntegrationSuite(): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  await verifyFirestoreEmulatorReachable(host);
}

import { describe,it,expect } from 'vitest';
import { resolveFirebaseEnvironment as resolve } from './firebase-environment';
const preview={JWT_SECRET:'fixture-session-key-only',VERCEL_ENV:'preview',NODE_ENV:'production',FIREBASE_STAGING_PROJECT_ID:'louvaio-staging',FIREBASE_STAGING_CLIENT_EMAIL:'fixture@louvaio-staging.iam.gserviceaccount.com',FIREBASE_STAGING_PRIVATE_KEY:'test-only-not-a-real-key',FIREBASE_STAGING_WEB_API_KEY:'test-only-public-key'};
describe('R14 environment isolation',()=>{
 it('selects only staging values despite generic production variables',()=>{expect(resolve({...preview,FIREBASE_PROJECT_ID:'production-other'}).projectId).toBe('louvaio-staging');});
 it.each(['FIREBASE_STAGING_PROJECT_ID','FIREBASE_STAGING_CLIENT_EMAIL','FIREBASE_STAGING_PRIVATE_KEY','FIREBASE_STAGING_WEB_API_KEY'])('rejects missing %s',key=>{expect(()=>resolve({...preview,[key]:undefined})).toThrow();});
 it('rejects mismatched staging identity',()=>expect(()=>resolve({...preview,FIREBASE_STAGING_PROJECT_ID:'production-other'})).toThrow());
 it('rejects credential email for another project',()=>expect(()=>resolve({...preview,FIREBASE_STAGING_CLIENT_EMAIL:'fixture@production-other.iam.gserviceaccount.com'})).toThrow());
 it.each(['FIREBASE_AUTH_EMULATOR_HOST','FIRESTORE_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST','STORAGE_EMULATOR_HOST'])('rejects published %s',key=>{for(const VERCEL_ENV of ['preview','production'])expect(()=>resolve({...preview,VERCEL_ENV,[key]:'127.0.0.1:9196'})).toThrow();});
 it('rejects Preview test mode even with demo identity',()=>expect(()=>resolve({...preview,NODE_ENV:'test',FIREBASE_PROJECT_ID:'demo-test'})).toThrow());
 it('rejects ambiguous Vercel context',()=>expect(()=>resolve({VERCEL:'1'})).toThrow());
 it('allows explicitly isolated local emulator context',()=>expect(resolve({NODE_ENV:'test',LOUVAIO_LOCAL_EMULATORS:'1',FIREBASE_PROJECT_ID:'demo-local',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8186',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9196'}).projectId).toBe('demo-local'));
 it('rejects implicit emulator initialization',()=>expect(()=>resolve({NODE_ENV:'test',FIREBASE_PROJECT_ID:'demo-local',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8186'})).toThrow());
it('allows complete Production identity without test settings',()=>expect(resolve({JWT_SECRET:'fixture-session-key-only',VERCEL_ENV:'production',NODE_ENV:'production',FIREBASE_PROJECT_ID:'production-fixture',FIREBASE_CLIENT_EMAIL:'fixture@production-fixture.iam.gserviceaccount.com',FIREBASE_PRIVATE_KEY:'fixture-only',FIREBASE_WEB_API_KEY:'fixture-only'}).projectId).toBe('production-fixture'));
it('rejects Production identity fallback to Staging',()=>expect(()=>resolve({...preview,VERCEL_ENV:'production',FIREBASE_PROJECT_ID:'louvaio-staging'})).toThrow());
});

type Env = Record<string, string | undefined>;
export function resolveFirebaseEnvironment(env: Env) {
 const published = env.VERCEL_ENV === 'preview' || env.VERCEL_ENV === 'production';
 if (env.VERCEL && !published) throw new Error('Unverified Vercel environment');
 if (published || env.NODE_ENV === 'production') {
  if (env.NODE_ENV === 'test' || Object.entries(env).some(([k,v]) => /EMULATOR/.test(k) && Boolean(v))) throw new Error('Emulators and test mode forbidden in published runtime');
 }
 if (published && (env.NODE_ENV !== 'production' || !env.JWT_SECRET?.trim())) throw new Error('Published authentication configuration required');
 if (env.VERCEL_ENV === 'preview') {
  const projectId = env.FIREBASE_STAGING_PROJECT_ID;
  const clientEmail = env.FIREBASE_STAGING_CLIENT_EMAIL;
  const privateKey = env.FIREBASE_STAGING_PRIVATE_KEY;
  const apiKey = env.FIREBASE_STAGING_WEB_API_KEY;
  if (projectId !== 'louvaio-staging' || !clientEmail?.endsWith('@louvaio-staging.iam.gserviceaccount.com') || !privateKey?.trim() || !apiKey?.trim()) throw new Error('Invalid or missing Staging Firebase identity');
  return { projectId, clientEmail, privateKey, apiKey, databaseURL: env.FIREBASE_STAGING_DATABASE_URL };
 }
 if (env.NODE_ENV === 'test' && (env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST)) {
  if (env.LOUVAIO_LOCAL_EMULATORS !== '1' || !env.FIREBASE_PROJECT_ID?.startsWith('demo-') || !/^127\.0\.0\.1:[0-9]+$/.test(env.FIRESTORE_EMULATOR_HOST || '') || !/^127\.0\.0\.1:[0-9]+$/.test(env.FIREBASE_AUTH_EMULATOR_HOST || '')) throw new Error('Local emulator isolation required');
 }
 if (env.VERCEL_ENV === 'production' && (!env.FIREBASE_PROJECT_ID || env.FIREBASE_PROJECT_ID.startsWith('demo-') || env.FIREBASE_PROJECT_ID === 'louvaio-staging' || !env.FIREBASE_CLIENT_EMAIL?.endsWith('@'+env.FIREBASE_PROJECT_ID+'.iam.gserviceaccount.com') || !env.FIREBASE_PRIVATE_KEY?.trim() || !env.FIREBASE_WEB_API_KEY?.trim())) throw new Error('Invalid Production Firebase identity');
 return {projectId:env.FIREBASE_PROJECT_ID,clientEmail:env.FIREBASE_CLIENT_EMAIL,privateKey:env.FIREBASE_PRIVATE_KEY,apiKey:env.FIREBASE_WEB_API_KEY,databaseURL:env.FIREBASE_DATABASE_URL};
}

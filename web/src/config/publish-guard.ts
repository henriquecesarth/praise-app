export function validatePublishEnvironment(env: Record<string,string|undefined>, command: string, mode: string) {
 const published = env.VERCEL_ENV === 'preview' || env.VERCEL_ENV === 'production';
 if (!published && (env.VERCEL || (command === 'build' && mode !== 'test'))) throw new Error('Verified publish environment required');
 if (!published) return;
 const integrated = env.LOUVAIO_STAGING_INTEGRATION;
 if (integrated && (integrated !== 'm20-c14' || env.VERCEL_ENV !== 'preview')) throw new Error('Invalid integrated Staging build context');
 if (mode === 'test' || env.NODE_ENV === 'test' || Object.entries(env).some(([k,v])=>/EMULATOR|MOCK_AUTH|AUTH_BYPASS/.test(k)&&Boolean(v))) throw new Error('Test authentication forbidden in public build');
 if (!env.VITE_API_URL || !env.VITE_FIREBASE_PROJECT_ID || !env.VITE_FIREBASE_API_KEY || !env.VITE_PUBLIC_SUPPORT_EMAIL || !env.VITE_CONTROLLER_DISPLAY_NAME) throw new Error('Required public build configuration missing');
 if (env.VERCEL_ENV === 'preview') {
  if (env.FIREBASE_STAGING_PROJECT_ID !== 'louvaio-staging' || !env.FIREBASE_STAGING_WEB_API_KEY || env.VITE_FIREBASE_API_KEY !== env.FIREBASE_STAGING_WEB_API_KEY) throw new Error('Preview public Firebase config lacks trusted build identity');
  const expectedApi = integrated === 'm20-c14'
   ? 'https://louvaio-m20-c14-api-staging.vercel.app/api/v1'
   : 'https://praise-qvjml6wfi-henriquecesarths-projects.vercel.app/api/v1';
  if (env.VITE_FIREBASE_PROJECT_ID !== 'louvaio-staging' || env.VITE_API_URL !== expectedApi) throw new Error('Preview API/Firebase destination mismatch');
 } else {
  let api: URL;
  try { api = new URL(env.VITE_API_URL); } catch { throw new Error('Production destination mismatch'); }
  if (api.protocol !== 'https:' || api.username || api.password ||
      env.VITE_API_URL !== 'https://praise-app-gray.vercel.app/api/v1' ||
      env.VITE_FIREBASE_PROJECT_ID !== 'praise-app-7a362') throw new Error('Production destination mismatch');
 }
}

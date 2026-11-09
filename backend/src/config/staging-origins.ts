export const INTEGRATED_STAGING_WEB_ORIGIN = 'https://louvaio-m20-c14-web-staging.vercel.app';
export const LEGACY_STAGING_WEB_ORIGIN = 'https://praise-app-m7tn-git-feat-m20-p-904232-henriquecesarths-projects.vercel.app';
export const R17_STAGING_WEB_ORIGIN = 'https://louvaio-r17-web-staging.vercel.app';

/** Deployment-specific opt-in; never changes the shared Preview CORS_ORIGIN. */
export function resolveStagingCorsOrigin(env: Record<string, string | undefined>): string | undefined {
  const mode = env.LOUVAIO_STAGING_INTEGRATION;
  if (!mode) return env.CORS_ORIGIN;
  if (env.VERCEL_ENV !== 'preview') {
    throw new Error('Integrated Staging CORS requires explicit Preview context');
  }
  if (mode === 'm20-c14') {
    return [LEGACY_STAGING_WEB_ORIGIN, INTEGRATED_STAGING_WEB_ORIGIN].join(',');
  }
  if (mode === 'r17') {
    return [R17_STAGING_WEB_ORIGIN, LEGACY_STAGING_WEB_ORIGIN, INTEGRATED_STAGING_WEB_ORIGIN].join(',');
  }
  throw new Error('Integrated Staging CORS requires explicit Preview context');
}

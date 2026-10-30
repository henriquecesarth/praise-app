export function isVercelPreview(): boolean {
  return (globalThis as typeof globalThis & { __LOUVAIO_VERCEL_ENV__?: string })
    .__LOUVAIO_VERCEL_ENV__ === 'preview';
}

export const VERCEL_PREVIEW_API_URL =
  'https://praise-87tmrr3kj-henriquecesarths-projects.vercel.app/api/v1';

export function normalizeApiUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/+$/, '') : undefined;
}

export function validatePreviewBuildConfig(env: Record<string, string | undefined>): void {
  if (env.VERCEL_ENV !== 'preview') return;

  const configuredApiUrl = normalizeApiUrl(env.VITE_API_URL);
  if (configuredApiUrl !== VERCEL_PREVIEW_API_URL) {
    throw new Error(
      `[PreviewConfig] VITE_API_URL must be exactly ${VERCEL_PREVIEW_API_URL} for Vercel preview builds.`
    );
  }

  const required = [
    'VITE_PUBLIC_SUPPORT_EMAIL',
    'VITE_CONTROLLER_DISPLAY_NAME',
  ];
  const missing = required.filter((key) => !env[key]?.trim());
  if (missing.length) {
    throw new Error(
      `[PreviewConfig] Missing mandatory preview compliance configuration: ${missing.join(', ')}.`
    );
  }
}

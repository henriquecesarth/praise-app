import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { validatePreviewBuildConfig, VERCEL_PREVIEW_API_URL } from './preview.config';

describe('preview build configuration', () => {
  const metadata = {
    VERCEL_ENV: 'preview',
    VITE_PUBLIC_SUPPORT_EMAIL: 'preview-support@example.test',
    VITE_CONTROLLER_DISPLAY_NAME: 'Preview Controller',
  };

  it('fails closed when VITE_API_URL is missing', () => {
    expect(() => validatePreviewBuildConfig(metadata)).toThrowError(/VITE_API_URL/);
  });

  it('fails closed when VITE_API_URL points somewhere else', () => {
    expect(() =>
      validatePreviewBuildConfig({ ...metadata, VITE_API_URL: 'https://api.example.test/api/v1' })
    ).toThrowError(/VITE_API_URL/);
  });

  it('accepts only the configured preview API URL, with an optional trailing slash', () => {
    expect(() =>
      validatePreviewBuildConfig({ ...metadata, VITE_API_URL: VERCEL_PREVIEW_API_URL })
    ).not.toThrow();
    expect(() =>
      validatePreviewBuildConfig({ ...metadata, VITE_API_URL: `${VERCEL_PREVIEW_API_URL}/` })
    ).not.toThrow();
  });

  it('requires public support and controller metadata on preview builds', () => {
    expect(() =>
      validatePreviewBuildConfig({ VERCEL_ENV: 'preview', VITE_API_URL: VERCEL_PREVIEW_API_URL })
    ).toThrowError(/VITE_PUBLIC_SUPPORT_EMAIL, VITE_CONTROLLER_DISPLAY_NAME/);
  });

  it('does not apply preview build restrictions to non-preview deployments', () => {
    expect(() => validatePreviewBuildConfig({ VERCEL_ENV: 'production' })).not.toThrow();
  });

  it('substitutes the actual compliance module marker for preview independently of NODE_ENV', () => {
    const script = [
      'const fs = require("node:fs");',
      'const { transformSync } = require("esbuild");',
      'const source = fs.readFileSync("src/config/compliance.config.ts", "utf8");',
      'const result = transformSync(source, { loader: "ts", define: {',
      '  "import.meta.env": JSON.stringify({}),',
      '  "globalThis.__LOUVAIO_VERCEL_ENV__": JSON.stringify(process.env.VERCEL_ENV),',
      '} });',
      'process.stdout.write(result.code);',
    ].join('\n');
    const transformed = execFileSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      env: { ...process.env, VERCEL_ENV: 'preview', NODE_ENV: 'production' },
    });

    expect(transformed).toMatch(/options\?\.vercelEnv \?\? ["']preview["']/);
    expect(transformed).not.toContain('__LOUVAIO_VERCEL_ENV__');
  });
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { validatePreviewBuildConfig } from './src/config/preview.config';

const vercelEnv = process.env.VERCEL_ENV;
validatePreviewBuildConfig(process.env);

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    'globalThis.__LOUVAIO_VERCEL_ENV__': JSON.stringify(vercelEnv ?? ''),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      manifest: {
        name: 'LouvAIO - Gestão de Louvor',
        short_name: 'LouvAIO',
        description: 'Aplicativo de música e conteúdo cristão.',
        lang: 'pt-BR',
        theme_color: '#0F2A1F',
        background_color: '#F5EFE6',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/branding/pwa/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/branding/pwa/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/branding/pwa/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        cacheId: 'louvaio-app-shell-v1',
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,jpg}'],
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkOnly',
            options: {
              precacheFallback: {
                fallbackURL: '/offline.html',
              },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
  },
});

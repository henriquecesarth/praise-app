import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'virtual:pwa-register': path.resolve(__dirname, 'src/test/pwa-register-stub.ts'),
    },
  },
  define: {
    // Vite resolves direct VITE_* reads statically; vi.stubEnv does not reach src/api.ts.
    'import.meta.env.VITE_MINISTRY_AUDIO_R2_ORIGIN': JSON.stringify(`https://${'a'.repeat(32)}.r2.cloudflarestorage.com`),
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
    clearMocks: true,
  },
});

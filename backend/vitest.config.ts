import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    testTimeout: 30000,
    env: {
      FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080',
    },
  },
});

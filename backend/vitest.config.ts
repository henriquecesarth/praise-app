import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    fileParallelism: false,
    include: ['src/**/*.test.ts'],
    env: {
      FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080',
      ZERNIO_WEBHOOK_SECRET: 'test_webhook_secret_deterministic_d5_d6_key_1234567890',
    },
  },
});

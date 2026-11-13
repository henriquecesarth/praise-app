import { defineConfig } from 'vitest/config';
import { sharedTestConfig } from './vitest.shared';

export default defineConfig({
  test: {
    ...sharedTestConfig,
    include: ['src/**/*.integration.test.ts'],
    globalSetup: ['./vitest.integration.setup.ts'],
  },
});

import { defineConfig } from 'vitest/config';
import { sharedTestConfig } from './vitest.shared';

export default defineConfig({
  test: {
    ...sharedTestConfig,
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts'],
  },
});

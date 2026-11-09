import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

export default defineConfig({
  ...baseConfig,
  projects: [{
    name: 'd2b-real-api',
    use: { viewport: { width: 1440, height: 900 }, colorScheme: 'light' },
  }],
});

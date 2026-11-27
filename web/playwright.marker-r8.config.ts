import { defineConfig } from '@playwright/test';
import base from './playwright.gate3.config';
export default defineConfig({ ...base, testMatch: 'smart-chord-marker-r8.spec.ts' });

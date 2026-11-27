import { defineConfig } from '@playwright/test';
import base from './playwright.gate3.config';
export default defineConfig({ ...base, testMatch: ['smart-chord-gate2.spec.ts', 'smart-chord-gate3.spec.ts', 'smart-chord-gate5.spec.ts'] });

import { defineConfig } from '@playwright/test';
import base from './playwright.gate3.config';
export default defineConfig({ ...base, testMatch: 'smart-chord-validation-r9.spec.ts' });

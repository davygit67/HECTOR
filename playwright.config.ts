import { defineConfig } from '@playwright/test';

// Electron qualification runs serially: one app instance at a time keeps timing and display behavior comparable.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  outputDir: 'test-results',
  globalSetup: './e2e/global-setup.ts',
  projects: [
    { name: 'qualification', testIgnore: '**/pacing.e2e.ts' },
    // Long timing runs; started explicitly with `npm run measure`.
    { name: 'pacing', testMatch: '**/pacing.e2e.ts', timeout: 900_000 }
  ]
});

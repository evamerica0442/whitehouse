import { defineConfig } from 'vitest/config';

/**
 * Logic tests only (no DOM). Component tests for apps/web are a follow-up —
 * they need a jsdom project, which we add when the UI stops being a shell.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'packages/**/src/**/*.test.ts',
      'apps/api/src/**/*.test.ts',
      'apps/web/src/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    reporters: ['default'],
  },
});

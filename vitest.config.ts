import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const webSrc = fileURLToPath(new URL('./apps/web/src', import.meta.url));

/**
 * Logic tests plus a render smoke test for the web app (no DOM library needed —
 * apps/web/src/App.smoke.test.tsx walks the real component tree).
 */
export default defineConfig({
  resolve: {
    // Mirrors the '@' alias in apps/web/vite.config.ts and tsconfig.json.
    alias: { '@': webSrc },
  },
  test: {
    environment: 'node',
    include: [
      'packages/**/src/**/*.test.ts',
      'apps/api/src/**/*.test.ts',
      'apps/web/src/**/*.test.{ts,tsx}',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    reporters: ['default'],
  },
});


import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

/** The workspace root, where the single .env lives. */
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/**
 * The API base URL is injected at build time so the same bundle works against
 * localhost, Render, or a future ECS service with no code change — the Phase 1/2
 * requirement that nothing be hardcoded to a host.
 *
 * `envDir` matters: Vite only reads env files from its own root (apps/web) by
 * default, so a VITE_ variable set in the repo-root .env was previously ignored
 * entirely. Pointing envDir at the repo root keeps one .env as the single source of
 * configuration, which is what the deployment docs promise.
 */
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, repoRoot, '');
  const configuredApiUrl = (env.VITE_API_BASE_URL ?? '').trim();
  /** Where `/api` is proxied in dev: an absolute VITE_API_BASE_URL wins, else API_BASE_URL. */
  const proxyTarget = configuredApiUrl || env.API_BASE_URL || 'http://localhost:4000';

  if (command === 'build' && !configuredApiUrl) {
    // Not fatal — a same-origin deployment works — but silent misconfiguration here
    // is what produces a bare "Failed to fetch" in the browser later.
    console.warn(
      '[web] VITE_API_BASE_URL is empty, so the built app will call the API on its own origin.\n' +
        '[web] If the API is deployed elsewhere, set VITE_API_BASE_URL and rebuild.',
    );
  }

  /**
   * The shared root .env sets NODE_ENV=development for the API, and `envDir` makes it
   * visible to Vite — which then defines `process.env.NODE_ENV` for the *client* too.
   * React reads that constant to pick its build, so production output ended up
   * bundling React's development build (+260 kB and dev-only warnings). Bind it to the
   * build command instead, still honouring a genuine NODE_ENV from the host.
   */
  const hostNodeEnv = process.env.NODE_ENV;
  const clientNodeEnv =
    hostNodeEnv === 'production' || hostNodeEnv === 'development'
      ? hostNodeEnv
      : command === 'build'
        ? 'production'
        : 'development';

  return {
    plugins: [react(), tailwindcss()],
    envDir: repoRoot,
    define: {
      'process.env.NODE_ENV': JSON.stringify(clientNodeEnv),
    },
    resolve: {
      alias: {
        /**
         * Consume the workspace package's TypeScript source, not its CommonJS build.
         *
         * Vite deliberately does not pre-bundle linked workspace packages, so it served
         * `packages/shared/dist/index.js` (CJS, `exports.`/`require(`) straight to the
         * browser, which parses modules as ESM and failed with:
         *   "does not provide an export named 'apiErrorSchema'"
         * Aliasing to source gives the browser real ESM in dev and in the build, and
         * removes a whole class of CJS-interop guesswork from the bundle. The built
         * dist is still what the Node API imports.
         */
        '@whitehouse/shared': fileURLToPath(
          new URL('../../packages/shared/src/index.ts', import.meta.url),
        ),
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      // Dev-only proxy: keeps the browser on one origin so the session cookie is
      // first-party while developing, without changing any application code.
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      port: 4173,
      // `vite preview` does not inherit server.proxy, so a built bundle that uses
      // same-origin requests would 404 without this.
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: mode !== 'production',
    },
  };
});


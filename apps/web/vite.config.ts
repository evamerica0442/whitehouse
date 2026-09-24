import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The API base URL is injected at build time so the same bundle works against
 * localhost, Render, or a future ECS service with no code change — the Phase 1/2
 * requirement that nothing be hardcoded to a host.
 */
export default defineConfig(({ mode }) => {
  const apiTarget = process.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      // Dev-only proxy: keeps the browser on one origin so the session cookie is
      // first-party while developing, without changing any application code.
      proxy:
        mode === 'development'
          ? {
              '/api': {
                target: apiTarget,
                changeOrigin: true,
              },
            }
          : undefined,
    },
    build: {
      outDir: 'dist',
      sourcemap: mode !== 'production',
    },
  };
});

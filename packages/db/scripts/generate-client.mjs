#!/usr/bin/env node
/**
 * Generates the Prisma client as part of `npm install`.
 *
 * Why this exists: `generated/prisma` is gitignored (it is build output), so a
 * fresh clone has no client. Without it, TypeScript cannot resolve
 * `../generated/prisma`, and every `prisma.<model>` call degrades to `any` —
 * which surfaces as a wall of unrelated-looking errors such as
 * "Parameter 'guardrail' implicitly has an 'any' type" in the seed.
 *
 * Tolerant by design: an install that omits devDependencies (`npm ci --omit=dev`)
 * has no Prisma CLI, and that must not fail the install — the runtime does not need
 * the CLI, only the generated client, which such an install is not the one building.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const cliCandidates = [
  join(process.cwd(), 'node_modules', 'prisma', 'package.json'),
  // Hoisted to the workspace root by npm.
  join(process.cwd(), '..', '..', 'node_modules', 'prisma', 'package.json'),
];

if (!cliCandidates.some((candidate) => existsSync(candidate))) {
  console.warn(
    '[db] Prisma CLI not installed (production-only install?) — skipping client generation.\n' +
      '[db] Run `npm run db:generate` after a full install.',
  );
  process.exit(0);
}

console.log('[db] Generating Prisma client…');

const result = spawnSync('npm', ['exec', '--', 'prisma', 'generate'], {
  stdio: 'inherit',
  cwd: process.cwd(),
  // Windows resolves npm.cmd through the shell.
  shell: process.platform === 'win32',
});

if (result.status !== 0) {
  console.error('[db] Prisma client generation failed — run `npm run db:generate` to see the error.');
  process.exit(result.status ?? 1);
}

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 keeps the datasource URL out of schema.prisma and reads it here.
 *
 * Migrations and `db push` must use the *direct* (unpooled) Neon endpoint —
 * DDL over a PgBouncer transaction pool is unreliable. The running application
 * uses the pooled `DATABASE_URL` through the Neon driver adapter instead.
 *
 * `prisma generate` needs no database at all, so a missing URL must not throw
 * here (that would break CI and fresh clones); it only surfaces when a command
 * actually connects.
 *
 * Local dev keeps a single .env at the repo root, so probe the likely CWDs
 * rather than assuming one.
 */
for (const candidate of [
  join(process.cwd(), '.env'),
  join(process.cwd(), '../../.env'),
  join(process.cwd(), '../../../.env'),
]) {
  if (existsSync(candidate)) {
    loadEnv({ path: candidate, override: false, quiet: true });
  }
}

const directUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? '';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: { url: directUrl },
  migrations: { seed: 'tsx src/seed.ts' },
});


#!/usr/bin/env node
/**
 * Prints what is actually in the database.
 *
 * Answers the two questions that come up first after a fresh deploy — "is the schema
 * applied?" and "which account do I sign in with?" — without needing psql or a Neon
 * console session. Read-only.
 *
 * Run with: npm run db:status
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

// packages/db/scripts/status.mjs -> repo root is two levels up.
const repoRoot = join(process.cwd(), '..', '..');
const distEntry = join(process.cwd(), 'dist', 'index.js');

require('dotenv').config({ path: join(repoRoot, '.env'), quiet: true });

if (!existsSync(distEntry)) {
  console.error('packages/db/dist is missing. Run `npm run build:packages` first.');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const { getPrismaClient } = await import(pathToFileURL(distEntry).href);
const prisma = getPrismaClient({ connectionString: process.env.DATABASE_URL });

const counts = {
  users: () => prisma.user.count(),
  tenants: () => prisma.tenant.count(),
  guardrails: () => prisma.guardrail.count(),
  scpPolicies: () => prisma.scpPolicy.count(),
  catalogTemplates: () => prisma.catalogTemplate.count(),
  sessions: () => prisma.session.count(),
};

try {
  const users = await prisma.user.findMany({
    select: { email: true, role: true, passwordHash: true, isActive: true, lastLoginAt: true },
    orderBy: { email: 'asc' },
  });

  console.log('Admin users:', users.length);
  if (users.length === 0) {
    console.log('  (none — create one with `npm run user:create -w @whitehouse/api -- --email you@example.com --name "Your Name" --role SUPER_ADMIN`)');
  }
  for (const user of users) {
    console.log(
      `  - ${user.email} · ${user.role} · ${user.isActive ? 'active' : 'DISABLED'} · password ${
        user.passwordHash ? 'set' : 'NOT SET (magic link only)'
      } · last login ${user.lastLoginAt ? user.lastLoginAt.toISOString() : 'never'}`,
    );
  }

  console.log('\nData:');
  for (const [label, query] of Object.entries(counts)) {
    console.log(`  ${label}: ${await query()}`);
  }

  const tenants = await prisma.tenant.findMany({
    select: { customerName: true, status: true, awsAccountId: true },
    orderBy: { createdAt: 'asc' },
  });
  for (const tenant of tenants) {
    console.log(`  → ${tenant.customerName} (${tenant.status}${tenant.awsAccountId ? `, ${tenant.awsAccountId}` : ''})`);
  }
} catch (error) {
  const message = String((error && (error.message || error.code)) || error);

  // The most likely first-deploy failure by far: migrations were never applied.
  if (/does not exist|P2021|P1003/i.test(message)) {
    console.error(
      'The schema is not applied to this database (a table is missing).\n' +
        'Run: npm run db:deploy      # applies packages/db/prisma/migrations\n' +
        '     npm run db:seed        # optional demo data',
    );
  } else {
    console.error('Could not query the database:', message.slice(0, 300));
  }
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

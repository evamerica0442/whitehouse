import { PrismaNeon } from '@prisma/adapter-neon';

import { PrismaClient } from '../generated/prisma';

/**
 * Prisma client factory.
 *
 * The Neon serverless driver adapter is used because the API runs on Render's
 * free tier where every instance is short-lived and connects through PgBouncer.
 * Phase 2 (RDS) swaps this one adapter for `@prisma/adapter-pg` — it is a
 * dependency change, not a code change, which is why nothing else in the
 * codebase constructs a PrismaClient.
 */

let singleton: PrismaClient | null = null;

export interface CreatePrismaClientOptions {
  /** Pooled Neon connection string (`DATABASE_URL`). */
  connectionString: string;
  logQueries?: boolean;
}

export function createPrismaClient(options: CreatePrismaClientOptions): PrismaClient {
  const adapter = new PrismaNeon({ connectionString: options.connectionString });

  return new PrismaClient({
    adapter,
    log: options.logQueries ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}

/** Process-wide singleton — call once from the API bootstrap. */
export function getPrismaClient(options: CreatePrismaClientOptions): PrismaClient {
  singleton ??= createPrismaClient(options);
  return singleton;
}

export function hasPrismaClient(): boolean {
  return singleton !== null;
}

export async function disconnectPrisma(): Promise<void> {
  if (!singleton) return;
  await singleton.$disconnect();
  singleton = null;
}

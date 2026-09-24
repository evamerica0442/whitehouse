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

export interface PrismaLogEvent {
  level: 'warn' | 'error';
  message: string;
  target?: string;
}

export interface CreatePrismaClientOptions {
  /** Pooled Neon connection string (`DATABASE_URL`). */
  connectionString: string;
  logQueries?: boolean;
  /**
   * Route Prisma's own warnings/errors into the application logger.
   *
   * Without this, Prisma writes to stdout as `prisma:error undefined` — it cannot
   * format the driver-adapter `ErrorEvent` either — which is both noisy and
   * unstructured in a log aggregator.
   */
  onLog?: (event: PrismaLogEvent) => void;
}

export function createPrismaClient(options: CreatePrismaClientOptions): PrismaClient {
  const adapter = new PrismaNeon({ connectionString: options.connectionString });

  const client = new PrismaClient({
    adapter,
    log: options.onLog
      ? [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }]
      : (options.logQueries ? ['query', 'warn', 'error'] : ['warn', 'error']),
  });

  if (options.onLog) {
    const emit = (level: 'warn' | 'error') => (event: { message: string; target?: string }) =>
      options.onLog?.({ level, message: event.message, ...(event.target ? { target: event.target } : {}) });

    // `$on` exists on the generated client; guarded so a future Prisma release
    // that reshapes the log API degrades to Prisma's own output instead of
    // crashing at boot.
    if (typeof client.$on === 'function') {
      client.$on('warn', emit('warn'));
      client.$on('error', emit('error'));
    }
  }

  return client;
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


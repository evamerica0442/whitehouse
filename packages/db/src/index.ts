export {
  createPrismaClient,
  getPrismaClient,
  hasPrismaClient,
  disconnectPrisma,
} from './client';
export type { CreatePrismaClientOptions } from './client';

// Re-export the generated client surface (PrismaClient, Prisma namespace,
// model types, and the string enums that mirror packages/shared/src/enums.ts)
// so apps depend on @whitehouse/db rather than a relative generated path.
export * from '../generated/prisma';

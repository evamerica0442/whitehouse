import type { CloudProvider } from '@whitehouse/shared';
import type { PrismaClient } from '@whitehouse/db';

import type { SessionContext } from './auth/session-service';
import type { AppConfig } from './config/env';
import type { EmailSender } from './email/email-sender';
import type { JobQueue } from './jobs/queue';
import type { AppLogger } from './services/onboarding-service';

/**
 * Explicit dependency container.
 *
 * The API avoids a DI framework on purpose: one object, assembled at boot, passed
 * to routes through a Fastify decorator. It is trivially mockable in tests, and it
 * makes "what does this process actually depend on?" a single-file answer.
 */
export interface ServiceContainer {
  config: AppConfig;
  prisma: PrismaClient;
  cloud: CloudProvider;
  email: EmailSender;
  queue: JobQueue;
  logger: AppLogger;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: ServiceContainer;
  }
  interface FastifyRequest {
    /** Populated by the auth plugin; null when the request is unauthenticated. */
    session: SessionContext | null;
  }
}

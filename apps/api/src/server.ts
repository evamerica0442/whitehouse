import { disconnectPrisma, getPrismaClient } from '@whitehouse/db';
import pino from 'pino';

import { buildApp } from './app';
import { createCloudProviderFromConfig } from './cloud/provider';
import { loadConfig, loadDotenvFiles } from './config/env';
import { createEmailSender } from './email/email-sender';
import { createJobHandlers } from './jobs/handlers';
import { createJobQueue } from './jobs/queue';

/**
 * Process entrypoint.
 *
 * Deliberately host-agnostic: it reads configuration from the environment, listens
 * on `PORT`, and runs the job worker in-process. That is what lets the same build
 * run on Render today and in ECS later with nothing but environment changes.
 */
async function main(): Promise<void> {
  loadDotenvFiles();

  const config = loadConfig();

  const logger = pino({
    level: config.LOG_LEVEL,
    ...(config.NODE_ENV === 'development'
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
    // Never let a session token or cookie reach the logs.
    redact: {
      paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers.set-cookie'],
      remove: true,
    },
  });

  const prisma = getPrismaClient({
    connectionString: config.DATABASE_URL,
    logQueries: config.LOG_LEVEL === 'debug' || config.LOG_LEVEL === 'trace',
    // Route Prisma's own messages through the structured logger instead of the
    // `prisma:error undefined` line it prints to stdout when the connection fails.
    onLog: (event) => {
      if (event.level === 'error') {
        logger.error({ prisma: true, target: event.target }, event.message);
      } else {
        logger.warn({ prisma: true, target: event.target }, event.message);
      }
    },
  });

  const cloud = createCloudProviderFromConfig(config, logger);
  const email = createEmailSender(config, logger);

  const queue = createJobQueue(
    {
      JOB_DRIVER: config.JOB_DRIVER,
      JOB_CONCURRENCY: config.JOB_CONCURRENCY,
      DATABASE_URL: config.DATABASE_URL,
    },
    { prisma, logger, concurrency: config.JOB_CONCURRENCY },
  );

  const deps = { config, prisma, cloud, email, queue, logger };

  const app = await buildApp(deps, { loggerInstance: logger });

  // A queue failure (for example Postgres unreachable at boot) must not stop the
  // API from serving — the dashboard is still useful, and /readyz reports the DB.
  try {
    await queue.start(createJobHandlers(deps));
  } catch (error) {
    logger.error(
      { err: error },
      'job worker failed to start — HTTP continues, background jobs are unavailable',
    );
  }

  await app.listen({ port: config.PORT, host: config.HOST });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, 'shutting down');
    await app.close().catch(() => undefined);
    await queue.stop().catch(() => undefined);
    await disconnectPrisma().catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  // Configuration errors are fatal and must be legible in the host's log viewer.
  console.error('Fatal startup error:', error instanceof Error ? error.message : error);
  process.exit(1);
});

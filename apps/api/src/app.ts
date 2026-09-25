import { randomUUID } from 'node:crypto';

import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

import type { ServiceContainer } from './container';
import { toErrorResponse } from './lib/errors';
import { sessionPlugin } from './plugins/session';
import { authRoutes } from './routes/auth';
import { catalogRoutes } from './routes/catalog';
import { guardrailRoutes } from './routes/guardrails';
import { healthRoutes } from './routes/health';
import { operationsRoutes } from './routes/operations';
import { tenantRoutes } from './routes/tenants';

export interface BuildAppOptions {
  /** Reuse the process logger created in server.ts instead of building a second one. */
  loggerInstance?: FastifyBaseLogger;
}

const API_PREFIX = '/api/v1';

/**
 * Builds the Fastify instance without listening, so tests can drive it with
 * `app.inject()` and server.ts can own the process lifecycle.
 */
export async function buildApp(
  deps: ServiceContainer,
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    ...(options.loggerInstance
      ? { loggerInstance: options.loggerInstance }
      : { logger: { level: deps.config.LOG_LEVEL } }),
    // Render terminates TLS in front of the service, so request.ip must come from
    // X-Forwarded-For for audit entries to be meaningful.
    trustProxy: true,
    genReqId: () => randomUUID(),
  });

  app.decorate('deps', deps);

  await app.register(helmet, {
    // The API only serves JSON; the web app is a separate origin with its own CSP.
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    origin: deps.config.corsOrigins,
    // Required for the session cookie to be sent cross-site (Vercel -> Render).
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'x-cron-secret'],
  });

  await app.register(rateLimit, {
    global: false,
    max: 120,
    timeWindow: '1 minute',
  });

  await app.register(sessionPlugin);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(422).send({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Request validation failed',
          details: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
          requestId: request.id,
        },
      });
    }

    const mapped = toErrorResponse(error);

    if (mapped.statusCode >= 500) {
      // The response says nothing useful on purpose, so the request id is the only
      // way to find this entry in the host's log stream.
      request.log.error({ err: error }, 'unhandled request error');
    } else if (mapped.statusCode === 429) {
      reply.header('retry-after', '60');
    }

    return reply.code(mapped.statusCode).send({
      error: { ...mapped.body.error, requestId: request.id },
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `No route for ${request.method} ${request.url}`,
      },
    }),
  );

  // Unprefixed: Render's health check and any load balancer probe hit /healthz.
  await app.register(healthRoutes);

  await app.register(
    async (scoped) => {
      await scoped.register(authRoutes);
      await scoped.register(tenantRoutes);
      await scoped.register(guardrailRoutes);
      await scoped.register(catalogRoutes);
      await scoped.register(operationsRoutes);
    },
    { prefix: API_PREFIX },
  );

  return app;
}

export { API_PREFIX };

import type { FastifyPluginAsync } from 'fastify';

import { describeError } from '../lib/errors';

/**
 * Liveness and readiness.
 *
 * `/healthz` is for Render (and any load balancer): it only reports that the
 * process is up. `/readyz` additionally probes Postgres, because a web service that
 * cannot reach Neon is not ready to take traffic — and on the free tier Neon
 * suspends idle computes, so this check is genuinely useful during a cold start.
 */
export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/healthz', async () => ({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    cloudProvider: app.deps.cloud.id,
    jobDriver: app.deps.queue.driver,
    emailDriver: app.deps.email.driver,
    nodeEnv: app.deps.config.NODE_ENV,
    timestamp: new Date().toISOString(),
  }));

  app.get('/readyz', async (request, reply) => {
    const checks: Record<string, { ok: boolean; detail?: string; hint?: string }> = {};

    try {
      await app.deps.prisma.$queryRaw`SELECT 1`;
      checks.database = { ok: true };
    } catch (error) {
      // Log the raw value (the driver throws an ErrorEvent, not an Error) and return
      // a readable chain plus a hint, so a failing deploy is diagnosable from the
      // response alone and not only from the platform log stream.
      request.log.error({ err: error }, 'readiness probe: database unreachable');
      checks.database = {
        ok: false,
        detail: describeError(error),
        hint: 'Check DATABASE_URL, and that the Neon compute is awake — the free tier suspends idle computes after 5 minutes.',
      };
    }

    const ok = Object.values(checks).every((check) => check.ok);
    return reply.code(ok ? 200 : 503).send({
      status: ok ? 'ready' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    });
  });
};
